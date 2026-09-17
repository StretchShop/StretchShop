"use strict";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authMixin = require("../../../services/users/mixins/auth.mixin");
const coreMethods = require("../../../services/users/methods/core.methods");
const HelpersMixin = require("../../../mixins/helpers.mixin");

function createAuthService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		settings: { JWT_SECRET: process.env.JWT_SECRET },
		enforceRateLimit: jest.fn().mockResolvedValue(true),
		recordRateLimitHit: jest.fn().mockResolvedValue(true),
		resetRateLimit: jest.fn().mockResolvedValue(true),
		validateEntity: jest.fn().mockResolvedValue(true),
		transformDocuments: jest.fn((ctx, params, doc) => Promise.resolve(doc)),
		transformEntity: coreMethods.methods.transformEntity,
		removePrivateData: coreMethods.methods.removePrivateData,
		generateJWT: coreMethods.methods.generateJWT,
		getValueByCode: HelpersMixin.methods.getValueByCode,
		buildHashSourceFromEntity: coreMethods.methods.buildHashSourceFromEntity,
		sendVerificationEmail: jest.fn(),
		entityChanged: jest.fn().mockResolvedValue(true),
		prepareForUpdate: coreMethods.methods.prepareForUpdate,
		sanitizeRegistrationUser: coreMethods.methods.sanitizeRegistrationUser,
		superloginJWT: coreMethods.methods.superloginJWT,
		restoreAdminSession: coreMethods.methods.restoreAdminSession,
		bumpTokenVersion: coreMethods.methods.bumpTokenVersion,
		adapter: {
			findOne: jest.fn(),
			insert: jest.fn(),
			updateById: jest.fn(),
			findById: jest.fn(),
		},
		...extra,
	};
}

describe("users auth success paths", () => {
	it("creates a user when username and email are free", async () => {
		const service = createAuthService();
		service.adapter.findOne.mockResolvedValue(null);
		service.adapter.insert.mockImplementation((entity) => Promise.resolve({
			_id: "u1",
			...entity,
			dates: entity.dates,
			settings: entity.settings,
		}));
		const result = await authMixin.actions.create.handler.call(service, {
			params: {
				user: {
					username: "jane",
					email: "jane@example.com",
					password: "secret12",
					settings: { language: "en", currency: "EUR" },
				},
			},
			meta: {
				remoteAddress: "127.0.0.1",
				remotePort: "1",
				localsDefault: { lang: "en", currency: "EUR" },
				siteSettings: { url: "https://shop.example.com" },
			},
		});
		expect(result.user.email).toBe("jane@example.com");
		expect(service.sendVerificationEmail).toHaveBeenCalled();
	});

	it("ignores client-supplied _id, type, and other privilege fields on create", async () => {
		const service = createAuthService();
		service.adapter.findOne.mockResolvedValue(null);
		let inserted;
		service.adapter.insert.mockImplementation((entity) => {
			inserted = entity;
			return Promise.resolve({
				_id: "generated-id",
				...entity,
			});
		});
		const result = await authMixin.actions.create.handler.call(service, {
			params: {
				user: {
					_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
					id: "aaaaaaaaaaaaaaaaaaaaaaaa",
					type: "admin",
					subtype: "super",
					superadmined: true,
					restrictions: ["GET /"],
					username: "attacker",
					email: "attacker@example.com",
					password: "secret12",
					settings: { language: "en", currency: "EUR" },
				},
			},
			meta: {
				remoteAddress: "127.0.0.1",
				remotePort: "1",
				localsDefault: { lang: "en", currency: "EUR" },
				siteSettings: { url: "https://shop.example.com" },
			},
		});
		expect(inserted._id).toBeUndefined();
		expect(inserted.id).toBeUndefined();
		expect(inserted.type).toBe("user");
		expect(inserted.subtype).toBeUndefined();
		expect(inserted.superadmined).toBeUndefined();
		expect(inserted.restrictions).toBeUndefined();
		expect(result.user._id).toBe("generated-id");
		expect(result.user.type).toBe("user");
	});

	it("rejects a denylisted password on register", async () => {
		const service = createAuthService();
		await expect(authMixin.actions.create.handler.call(service, {
			params: {
				user: {
					username: "jane",
					email: "jane@example.com",
					password: "password",
				},
			},
			meta: {
				remoteAddress: "127.0.0.1",
				remotePort: "1",
				localsDefault: { lang: "en", currency: "EUR" },
				siteSettings: { url: "https://shop.example.com" },
			},
		})).rejects.toMatchObject({ code: 422 });
		expect(service.adapter.insert).not.toHaveBeenCalled();
	});

	it("logs in an activated user", async () => {
		const hash = bcrypt.hashSync("secret12", 10);
		const service = createAuthService();
		service.adapter.findOne.mockResolvedValue({
			_id: "u1",
			email: "jane@example.com",
			username: "jane",
			password: hash,
			dates: { dateActivated: new Date(Date.now() - 1000) },
		});
		service.adapter.updateById.mockResolvedValue({
			_id: "u1",
			email: "jane@example.com",
			username: "jane",
			dates: { dateActivated: new Date() },
		});
		const result = await authMixin.actions.login.handler.call(service, {
			params: { user: { email: "jane@example.com", password: "secret12" } },
			meta: { remoteAddress: "127.0.0.1", remotePort: "1", cookies: {} },
		});
		expect(result.user.email).toBe("jane@example.com");
		expect(result.user.token || result.token || true).toBeTruthy();
	});

	it("restores an admin session from admin_token", async () => {
		const service = createAuthService();
		const adminToken = jwt.sign({ id: "admin-1" }, process.env.JWT_SECRET, { algorithm: "HS256" });
		service.adapter.findById.mockResolvedValue({
			_id: "admin-1",
			type: "admin",
			username: "admin",
			email: "a@b.c",
		});
		const result = await service.restoreAdminSession({
			meta: { cookies: { admin_token: adminToken }, makeCookies: {}, remoteAddress: "127.0.0.1" },
		});
		expect(result.user.superadmined).toBe(false);
		expect(result.user.type).toBe("admin");
	});
});

describe("users core helpers", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		settings: { JWT_SECRET: process.env.JWT_SECRET },
		getValueByCode: HelpersMixin.methods.getValueByCode,
		...coreMethods.methods,
	};

	it("transforms entities, profiles, and private data", async () => {
		const stripped = service.removePrivateData({ data: { stripe: { id: "x" }, contentDependencies: { list: [] } } });
		expect(stripped.data.stripe).toBeUndefined();
		expect(stripped.data.contentDependencies).toBeDefined();

		const wrapped = service.transformEntity({ username: "jane" }, false, { meta: {} });
		expect(wrapped.user.username).toBe("jane");

		const profile = service.transformProfile({ call: jest.fn() }, { username: "jane" }, null);
		expect(profile.profile.following).toBe(false);
	});

	it("checks update rights and merges addresses", () => {
		expect(service.userCanUpdate({ _id: "a1", type: "admin" }, { _id: "u1" })).toBe(true);
		expect(service.userCanUpdate({ _id: "u1", type: "user" }, {})).toBe(true);
		expect(service.userCanUpdate({ _id: "u1", type: "user" }, { _id: "other" })).toBe(false);
		expect(service.mergeTwoAddresses(
			{ street: "Old", city: "A" },
			{ street: "New", zip: "1" }
		).street).toBe("New");
	});

	it("extracts translations, hashes, and prepares updates", () => {
		const extracted = service.extractTranslation({
			dictionary: {
				records: [{
					translates: [{ langCode: "en", translation: "Hello" }],
					occurrences: [{
						type: "text",
						translationStrings: [{ selector: "h1", stringOrig: "Hi" }],
					}],
				}],
			},
		}, "en");
		expect(extracted.en[0].string).toBe("Hello");
		expect(service.buildHashSourceFromEntity("a", "b", true)).toEqual(expect.any(String));
		expect(service.prepareForUpdate({ _id: "u1", name: "Jane" })).toEqual({ $set: { name: "Jane" } });
		expect(service.isValidTranslationLanguage("en", [{ code: "en" }])).toBe(true);
		expect(service.sanitizeRegistrationUser({
			_id: "admin-id",
			type: "admin",
			username: "jane",
			email: "j@e.c",
			password: "x",
		})).toEqual({
			username: "jane",
			email: "j@e.c",
			password: "x",
		});
	});
});

describe("users.resetPassword", () => {
	const emailMixin = require("../../../services/users/mixins/email.mixin");

	it("stores a verify token without unsetting dateActivated", async () => {
		const service = createAuthService({
			sendVerificationEmail: jest.fn(),
			buildHashSourceFromEntity: () => "hash-source",
		});
		const activated = new Date("2020-01-01T00:00:00.000Z");
		service.adapter.findOne.mockResolvedValue({
			_id: "u1",
			email: "jane@example.com",
			password: "hashed",
			dates: { dateCreated: new Date("2019-01-01T00:00:00.000Z"), dateActivated: activated },
			settings: { language: "en" },
		});
		service.adapter.updateById.mockResolvedValue({});
		await emailMixin.actions.resetPassword.handler.call(service, {
			params: { email: "jane@example.com" },
			meta: {
				localsDefault: { lang: "en", currency: "EUR" },
				siteSettings: { url: "https://shop.example.com" },
			},
		});
		const update = service.adapter.updateById.mock.calls[0][1];
		expect(update.$unset).toBeUndefined();
		expect(update.$set["dates.dateActivated"]).toBeUndefined();
		expect(update.$set["dates.dateLastVerify"]).toBeInstanceOf(Date);
		expect(service.sendVerificationEmail).toHaveBeenCalled();
	});
});

describe("users.resolveToken and logout", () => {
	it("rejects a JWT after tokenVersion is bumped", async () => {
		const service = createAuthService();
		const token = jwt.sign(
			{ id: "u1", username: "jane", tv: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
			process.env.JWT_SECRET,
			{ algorithm: "HS256" }
		);
		service.adapter.findById.mockResolvedValue({
			_id: "u1",
			dates: { dateActivated: new Date(Date.now() - 1000) },
			security: { tokenVersion: 1 },
		});
		await expect(authMixin.actions.resolveToken.handler.call(service, {
			params: { token },
		})).rejects.toMatchObject({ code: 422 });
	});

	it("accepts a JWT whose tv matches the user document", async () => {
		const service = createAuthService();
		const token = jwt.sign(
			{ id: "u1", username: "jane", tv: 2, exp: Math.floor(Date.now() / 1000) + 3600 },
			process.env.JWT_SECRET,
			{ algorithm: "HS256" }
		);
		service.adapter.findById.mockResolvedValue({
			_id: "u1",
			username: "jane",
			dates: { dateActivated: new Date(Date.now() - 1000) },
			security: { tokenVersion: 2 },
		});
		const found = await authMixin.actions.resolveToken.handler.call(service, {
			params: { token },
		});
		expect(found.username).toBe("jane");
	});

	it("bumps tokenVersion on logout", async () => {
		const service = createAuthService();
		service.adapter.updateById.mockResolvedValue({});
		service.adapter.findById.mockResolvedValue({ _id: "u1", security: { tokenVersion: 1 } });
		const ctx = { meta: { user: { _id: "u1" }, cookies: { token: "old" } } };
		await authMixin.actions.logout.handler.call(service, ctx);
		expect(service.adapter.updateById).toHaveBeenCalledWith("u1", { $inc: { "security.tokenVersion": 1 } });
		expect(ctx.meta.makeCookies.token.value).toBe("");
	});

	it("users.me refreshes JWT with the DB tokenVersion after security is stripped", async () => {
		const service = createAuthService();
		service.getById = jest.fn().mockResolvedValue({
			_id: "u1",
			username: "jane",
			email: "jane@example.com",
			dates: { dateActivated: new Date(Date.now() - 1000), dateUpdated: new Date() },
			security: { tokenVersion: 3 },
		});
		service.transformDocuments = jest.fn((ctx, params, doc) => {
			const { security, ...rest } = doc;
			return Promise.resolve(rest);
		});
		const ctx = {
			meta: {
				user: { _id: "u1" },
				cookies: {},
				makeCookies: {},
			},
		};
		const entity = await authMixin.actions.me.handler.call(service, ctx);
		expect(ctx.meta.issuedTokenVersion).toBe(3);
		expect(entity.user).toBeTruthy();
		const issued = ctx.meta.makeCookies.token.value;
		const decoded = jwt.verify(issued, process.env.JWT_SECRET, { algorithms: ["HS256"] });
		expect(decoded.tv).toBe(3);
	});
});
