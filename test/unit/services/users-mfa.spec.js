"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const authMixin = require("../../../services/users/mixins/auth.mixin");
const mfaMethods = require("../../../services/users/methods/mfa.methods");
const coreMethods = require("../../../services/users/methods/core.methods");
const profileMixin = require("../../../services/users/methods/profile.methods");

function createMfaService() {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		settings: { JWT_SECRET: process.env.JWT_SECRET },
		enforceRateLimit: jest.fn().mockResolvedValue(true),
		recordRateLimitHit: jest.fn().mockResolvedValue(true),
		resetRateLimit: jest.fn().mockResolvedValue(true),
		transformDocuments: jest.fn((ctx, params, doc) => Promise.resolve(doc)),
		entityChanged: jest.fn().mockResolvedValue(true),
		adapter: {
			findOne: jest.fn(),
			findById: jest.fn(),
			updateById: jest.fn().mockImplementation((id, update) => Promise.resolve({
				_id: id,
				...(update.$set || {}),
			})),
			collection: { distinct: jest.fn().mockResolvedValue(["user", "admin"]) },
		},
		...coreMethods.methods,
		...mfaMethods.methods,
		...authMixin.methods,
	};
}

function activatedUser(extra = {}) {
	return {
		_id: "u1",
		email: "jane@example.com",
		username: "jane",
		type: "user",
		dates: { dateActivated: new Date(Date.now() - 1000) },
		...extra,
	};
}

function wrongCode(code) {
	return code === "000000" ? "000001" : "000000";
}

describe("admin email MFA", () => {
	const originalDebug = process.env.MFA_DEBUG_RETURN_CODE;

	afterEach(() => {
		if (originalDebug === undefined) {
			delete process.env.MFA_DEBUG_RETURN_CODE;
		} else {
			process.env.MFA_DEBUG_RETURN_CODE = originalDebug;
		}
	});

	it("issues a session for a customer without an email code", async () => {
		const hash = bcrypt.hashSync("secret12", 10);
		const service = createMfaService();
		service.adapter.findOne.mockResolvedValue(activatedUser({ password: hash }));
		const ctx = {
			params: { user: { email: "jane@example.com", password: "secret12" } },
			meta: { remoteAddress: "127.0.0.1", remotePort: "1", cookies: {} },
			call: jest.fn(),
		};
		const result = await authMixin.actions.login.handler.call(service, ctx);
		expect(result.user.email).toBe("jane@example.com");
		expect(result.mfaRequired).toBeUndefined();
		expect(ctx.meta.makeCookies.token.value).toEqual(expect.any(String));
		expect(service.resetRateLimit).toHaveBeenCalled();
		expect(ctx.call).not.toHaveBeenCalled();
	});

	it("does not issue a session for an admin until the emailed code is accepted", async () => {
		const hash = bcrypt.hashSync("secret12", 10);
		const service = createMfaService();
		service.adapter.findOne.mockResolvedValue(activatedUser({
			_id: "admin-1",
			type: "admin",
			email: "admin@example.com",
			username: "boss",
			password: hash,
			settings: { language: "en" },
			security: { tokenVersion: 2 },
		}));
		let mailed;
		const ctx = {
			params: { user: { email: "admin@example.com", password: "secret12" }, remember: true },
			meta: { remoteAddress: "127.0.0.1", remotePort: "1", cookies: {} },
			call: jest.fn((action, payload) => {
				mailed = payload;
				return Promise.resolve(true);
			}),
		};
		const result = await authMixin.actions.login.handler.call(service, ctx);
		expect(result).toEqual({
			mfaRequired: true,
			challengeId: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(ctx.meta.token).toBeUndefined();
		expect(ctx.meta.makeCookies).toBeUndefined();
		expect(service.resetRateLimit).not.toHaveBeenCalled();
		expect(mailed.template).toBe("auth/mfacode");
		expect(mailed.data.code).toMatch(/^\d{6}$/);
		expect(mailed.settings.to).toBe("admin@example.com");
		const stored = service.adapter.updateById.mock.calls[0][1].$set["security.mfa"];
		expect(stored.codeHash).not.toBe(mailed.data.code);
		expect(stored.remember).toBe(true);
		expect(stored.codeHash).toBe(
			crypto.createHmac("sha256", process.env.JWT_SECRET)
				.update(`${stored.challengeId}:${mailed.data.code}`)
				.digest("hex")
		);
	});

	it("drops the challenge when the sign-in email cannot be sent", async () => {
		const hash = bcrypt.hashSync("secret12", 10);
		const service = createMfaService();
		service.adapter.findOne.mockResolvedValue(activatedUser({
			_id: "admin-1",
			type: "admin",
			email: "admin@example.com",
			password: hash,
		}));
		const ctx = {
			params: { user: { email: "admin@example.com", password: "secret12" } },
			meta: { remoteAddress: "127.0.0.1", remotePort: "1", cookies: {} },
			call: jest.fn().mockRejectedValue(new Error("smtp down")),
		};
		await expect(authMixin.actions.login.handler.call(service, ctx)).rejects.toMatchObject({
			code: 422,
			data: [{ field: "email", message: "mfa send failed" }],
		});
		expect(service.adapter.updateById.mock.calls.at(-1)[1]).toEqual({ $unset: { "security.mfa": "" } });
		expect(ctx.meta.makeCookies).toBeUndefined();
	});

	it("issues a 60-day session when the code matches a remembered admin login", async () => {
		const service = createMfaService();
		const { code, mfa } = service.createMfaChallenge(true);
		const user = activatedUser({
			_id: "admin-1",
			type: "admin",
			email: "admin@example.com",
			username: "boss",
			security: { tokenVersion: 3, mfa },
		});
		service.adapter.findOne.mockResolvedValue(user);
		const ctx = {
			params: { challengeId: mfa.challengeId, code },
			meta: { remoteAddress: "127.0.0.1", remotePort: "1", cookies: {} },
		};
		const result = await authMixin.actions.loginMfa.handler.call(service, ctx);
		expect(result.user.email).toBe("admin@example.com");
		expect(ctx.meta.makeCookies.token.value).toEqual(expect.any(String));
		const days = (ctx.meta.makeCookies.token.options.expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
		expect(days).toBeGreaterThan(59);
		expect(days).toBeLessThan(62);
		const saved = service.adapter.updateById.mock.calls[0][1].$set;
		expect(saved.security.mfa).toBeUndefined();
		expect(new Date(saved.dates.dateLastLogin).getTime()).toBeGreaterThan(Date.now() - 5000);
		expect(service.resetRateLimit).toHaveBeenCalledWith(
			ctx,
			"login",
			expect.objectContaining({ keyExtra: "admin@example.com" })
		);
	});

	it("rejects a wrong code without issuing a session", async () => {
		const service = createMfaService();
		const { code, mfa } = service.createMfaChallenge(false);
		service.adapter.findOne.mockResolvedValue(activatedUser({
			_id: "admin-1",
			type: "admin",
			security: { mfa },
		}));
		const ctx = {
			params: { challengeId: mfa.challengeId, code: wrongCode(code) },
			meta: { remoteAddress: "127.0.0.1", remotePort: "1", cookies: {} },
		};
		await expect(authMixin.actions.loginMfa.handler.call(service, ctx)).rejects.toMatchObject({
			code: 422,
			data: [{ message: "invalid or expired" }],
		});
		expect(service.adapter.updateById).toHaveBeenCalledWith("admin-1", { $inc: { "security.mfa.attempts": 1 } });
		expect(ctx.meta.makeCookies).toBeUndefined();
	});

	it("clears the challenge on the fifth wrong code and when the code has expired", async () => {
		const service = createMfaService();
		const { code, mfa } = service.createMfaChallenge(false);
		mfa.attempts = 4;
		service.adapter.findOne.mockResolvedValue(activatedUser({
			_id: "admin-1",
			type: "admin",
			security: { mfa },
		}));
		const ctx = {
			params: { challengeId: mfa.challengeId, code: wrongCode(code) },
			meta: { cookies: {} },
		};
		await expect(authMixin.actions.loginMfa.handler.call(service, ctx)).rejects.toMatchObject({ code: 422 });
		expect(service.adapter.updateById).toHaveBeenCalledWith("admin-1", { $unset: { "security.mfa": "" } });
		expect(ctx.meta.makeCookies).toBeUndefined();

		service.adapter.updateById.mockClear();
		const expired = service.createMfaChallenge(false);
		expired.mfa.expiresAt = new Date(Date.now() - 1000);
		service.adapter.findOne.mockResolvedValue(activatedUser({
			_id: "admin-1",
			type: "admin",
			security: { mfa: expired.mfa },
		}));
		await expect(authMixin.actions.loginMfa.handler.call(service, {
			params: { challengeId: expired.mfa.challengeId, code: expired.code },
			meta: { cookies: {} },
		})).rejects.toMatchObject({ code: 422 });
		expect(service.adapter.updateById).toHaveBeenCalledWith("admin-1", { $unset: { "security.mfa": "" } });
	});

	it("rejects a resend inside the cooldown", async () => {
		const service = createMfaService();
		const { mfa } = service.createMfaChallenge(false);
		service.adapter.findOne.mockResolvedValue(activatedUser({
			_id: "admin-1",
			type: "admin",
			security: { mfa },
		}));
		await expect(authMixin.actions.loginMfaResend.handler.call(service, {
			params: { challengeId: mfa.challengeId },
			meta: { cookies: {} },
			call: jest.fn(),
		})).rejects.toMatchObject({
			code: 422,
			data: [{ message: "resend cooldown" }],
		});
		expect(service.adapter.updateById).not.toHaveBeenCalled();
	});

	it("returns debugCode only when the non-production flag is set", async () => {
		const hash = bcrypt.hashSync("secret12", 10);
		const service = createMfaService();
		service.adapter.findOne.mockResolvedValue(activatedUser({
			_id: "admin-1",
			type: "admin",
			email: "admin@example.com",
			password: hash,
		}));
		process.env.MFA_DEBUG_RETURN_CODE = "1";
		const ctx = {
			params: { user: { email: "admin@example.com", password: "secret12" } },
			meta: { remoteAddress: "127.0.0.1", remotePort: "1", cookies: {} },
			call: jest.fn().mockResolvedValue(true),
		};
		const result = await authMixin.actions.login.handler.call(service, ctx);
		expect(result.debugCode).toMatch(/^\d{6}$/);
	});
});

describe("admin email change", () => {
	function createProfileService() {
		return createMfaService();
	}

	it("rejects an admin email change without the current password", async () => {
		const service = createProfileService();
		service.adapter.findOne.mockResolvedValue(null);
		service.adapter.findById.mockResolvedValue({
			_id: "admin-1",
			type: "admin",
			email: "old@example.com",
			username: "boss",
			password: bcrypt.hashSync("secret12", 10),
			security: { tokenVersion: 1, mfa: { challengeId: "abc" } },
			dates: {},
		});
		await expect(profileMixin.actions.updateUser.handler.call(service, {
			meta: { user: { _id: "admin-1", type: "admin" } },
			params: { user: { email: "new@example.com" } },
			call: jest.fn(),
		})).rejects.toMatchObject({
			code: 422,
			data: [{ field: "currentPassword", message: "is empty" }],
		});
		expect(service.adapter.updateById).not.toHaveBeenCalled();
	});

	it("updates an admin email after the current password and notifies both addresses", async () => {
		const service = createProfileService();
		service.adapter.findOne.mockResolvedValue(null);
		service.adapter.findById.mockResolvedValue({
			_id: "admin-1",
			type: "admin",
			email: "old@example.com",
			username: "boss",
			password: bcrypt.hashSync("secret12", 10),
			security: { tokenVersion: 1, mfa: { challengeId: "abc" } },
			dates: {},
		});
		const ctx = {
			meta: { user: { _id: "admin-1", type: "admin" }, cookies: {} },
			params: { user: { email: "new@example.com" }, currentPassword: "secret12" },
			call: jest.fn().mockResolvedValue(true),
		};
		const result = await profileMixin.actions.updateUser.handler.call(service, ctx);
		expect(result.user.email).toBe("new@example.com");
		const saved = service.adapter.updateById.mock.calls[0][1].$set;
		expect(saved.email).toBe("new@example.com");
		expect(saved.security.mfa).toBeUndefined();
		expect(saved.security.tokenVersion).toBe(1);
		const recipients = ctx.call.mock.calls.map((call) => call[1].settings.to).sort();
		expect(recipients).toEqual(["new@example.com", "old@example.com"]);
		expect(ctx.call.mock.calls[0][1].template).toBe("auth/emailchanged");
	});

	it("ignores a client-supplied security object", async () => {
		const service = createProfileService();
		service.adapter.findById.mockResolvedValue({
			_id: "admin-1",
			type: "admin",
			email: "boss@example.com",
			username: "boss",
			security: { tokenVersion: 4, mfa: { challengeId: "keep" } },
			dates: {},
		});
		const ctx = {
			meta: { user: { _id: "admin-1", type: "admin" }, cookies: {} },
			params: {
				user: {
					bio: "hi",
					security: { tokenVersion: 0, mfa: null },
				},
			},
		};
		await profileMixin.actions.updateUser.handler.call(service, ctx);
		expect(ctx.params.user.security).toBeUndefined();
		const saved = service.adapter.updateById.mock.calls[0][1].$set;
		expect(saved.security).toEqual({ tokenVersion: 4, mfa: { challengeId: "keep" } });
		expect(saved.bio).toBe("hi");
	});

	it("lets a customer change email without a current password", async () => {
		const service = createProfileService();
		service.adapter.findOne.mockResolvedValue(null);
		service.adapter.findById.mockResolvedValue({
			_id: "u1",
			type: "user",
			email: "old@example.com",
			username: "jane",
			dates: {},
		});
		const ctx = {
			meta: { user: { _id: "u1", type: "user" }, cookies: {} },
			params: { user: { email: "new@example.com" } },
			call: jest.fn(),
		};
		const result = await profileMixin.actions.updateUser.handler.call(service, ctx);
		expect(result.user.email).toBe("new@example.com");
		expect(ctx.call).not.toHaveBeenCalled();
	});
});
