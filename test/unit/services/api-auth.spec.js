"use strict";

jest.mock("cookies", () => {
	return jest.fn().mockImplementation(() => ({
		set: jest.fn(),
		get: jest.fn(),
	}));
});

const jwt = require("jsonwebtoken");
const SettingsMixin = require("../../../mixins/settings.mixin");
const helperMethods = require("../../../services/api/methods/helpers.methods");
const coreMethods = require("../../../services/api/methods/core.methods");

function createService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		settings: { JWT_SECRET: process.env.JWT_SECRET },
		parseCookies: helperMethods.methods.parseCookies,
		getActiveUploadPath: helperMethods.methods.getActiveUploadPath,
		moveFile: jest.fn().mockResolvedValue(true),
		...coreMethods.methods,
		...extra,
	};
}

function createRes() {
	return {
		getHeader() {},
		setHeader: jest.fn(),
		getHeaders: () => ({}),
		writeHead: jest.fn(),
		end: jest.fn(),
	};
}

describe("api cookies and authenticate", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("creates cart and session cookies when missing", () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			invoiceData: { company: { name: "StretchShop" } },
		});
		const service = createService();
		const ctx = { meta: { remoteAddress: "127.0.0.1", cookies: {} } };
		const req = { headers: { cookie: "", host: "localhost" }, connection: { encrypted: false } };
		const res = createRes();

		service.cookiesManagement(ctx, {}, req, res);
		expect(ctx.meta.cookies.cart).toEqual(expect.any(String));
		expect(ctx.meta.cookies.cart).toMatch(/^[a-f0-9]{64}$/);
		expect(ctx.meta.cookies.session).toEqual(expect.any(String));
		expect(ctx.meta.cookies.csrf).toEqual(expect.any(String));
	});

	it("does not derive the cart cookie from IP and time", () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			invoiceData: { company: { name: "StretchShop" } },
		});
		const service = createService();
		const ctx = { meta: { remoteAddress: "10.0.0.8", cookies: {} } };
		const req = { headers: { cookie: "" }, connection: { encrypted: false } };
		const res = createRes();
		const before = new Date().toISOString();
		service.cookiesManagement(ctx, {}, req, res);
		const after = new Date().toISOString();
		const crypto = require("node:crypto");
		const hashedBefore = crypto.createHash("sha256").update("10.0.0.8--" + before).digest("hex");
		const hashedAfter = crypto.createHash("sha256").update("10.0.0.8--" + after).digest("hex");
		expect(ctx.meta.cookies.cart).not.toBe(hashedBefore);
		expect(ctx.meta.cookies.cart).not.toBe(hashedAfter);
	});

	it("issues distinct cart cookies for sequential guests", () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			invoiceData: { company: { name: "StretchShop" } },
		});
		const service = createService();
		const req = { headers: { cookie: "" }, connection: { encrypted: false } };
		const ctxA = { meta: { remoteAddress: "10.0.0.8", cookies: {} } };
		const ctxB = { meta: { remoteAddress: "10.0.0.8", cookies: {} } };
		service.cookiesManagement(ctxA, {}, req, createRes());
		service.cookiesManagement(ctxB, {}, req, createRes());
		expect(ctxA.meta.cookies.cart).not.toBe(ctxB.meta.cookies.cart);
	});

	it("sets session HttpOnly and csrf readable when cookies are secure", () => {
		const originalSecure = process.env.COOKIES_SECURE;
		const originalSameSite = process.env.COOKIES_SAME_SITE;
		process.env.COOKIES_SECURE = "true";
		process.env.COOKIES_SAME_SITE = "lax";
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			invoiceData: { company: { name: "StretchShop" } },
		});
		const service = createService();
		const ctx = { meta: { remoteAddress: "127.0.0.1", cookies: {}, makeCookies: {} } };
		const req = { headers: { cookie: "" }, connection: { encrypted: true } };
		service.cookiesManagement(ctx, {}, req, createRes());
		expect(ctx.meta.makeCookies.session.options.httpOnly).toBe(true);
		expect(ctx.meta.makeCookies.csrf.options.httpOnly).toBe(false);
		expect(ctx.meta.cookies.csrf).toEqual(expect.any(String));
		if (originalSecure === undefined) {
			delete process.env.COOKIES_SECURE;
		} else {
			process.env.COOKIES_SECURE = originalSecure;
		}
		if (originalSameSite === undefined) {
			delete process.env.COOKIES_SAME_SITE;
		} else {
			process.env.COOKIES_SAME_SITE = originalSameSite;
		}
	});

	it("honors COOKIES_SAME_SITE instead of forcing None when cookies are secure", () => {
		const originalSecure = process.env.COOKIES_SECURE;
		const originalSameSite = process.env.COOKIES_SAME_SITE;
		process.env.COOKIES_SECURE = "true";
		process.env.COOKIES_SAME_SITE = "lax";
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			invoiceData: { company: { name: "StretchShop" } },
		});
		const service = createService();
		const ctx = { meta: { remoteAddress: "127.0.0.1", cookies: {}, makeCookies: {} } };
		service.setCookie(ctx, "session", "abc", { signed: true, secure: true, httpOnly: false });
		expect(ctx.meta.makeCookies.session.options.sameSite).toBe("lax");
		if (originalSecure === undefined) {
			delete process.env.COOKIES_SECURE;
		} else {
			process.env.COOKIES_SECURE = originalSecure;
		}
		if (originalSameSite === undefined) {
			delete process.env.COOKIES_SAME_SITE;
		} else {
			process.env.COOKIES_SAME_SITE = originalSameSite;
		}
	});

	it("authenticates GET requests without a user token", async () => {
		const service = createService({
			cookiesManagement: jest.fn(),
			checkCsrfToken: jest.fn().mockReturnValue(false),
		});
		const ctx = { meta: { remoteAddress: "127.0.0.1", cookies: {}, headers: {} } };
		const req = {
			method: "GET",
			headers: { cookie: "" },
			$action: {},
			parsedUrl: "/api/v1/products",
		};
		const user = await service.authenticate(ctx, {}, req, createRes());
		expect(user).toBeUndefined();
	});

	it("rejects mutating requests that need CSRF", async () => {
		const service = createService({
			cookiesManagement: jest.fn(),
			checkCsrfToken: jest.fn().mockReturnValue(false),
		});
		const ctx = { meta: { remoteAddress: "127.0.0.1", cookies: { token: "abc" }, headers: {} } };
		const req = {
			method: "POST",
			headers: { cookie: "token=abc" },
			$action: { auth: "required" },
			$alias: { path: "orders/update" },
			parsedUrl: "/api/v1/orders/update",
		};
		await expect(service.authenticate(ctx, {}, req, createRes())).rejects.toMatchObject({
			code: 401,
		});
	});

	it("resolves a cookie user and blocks restricted paths", async () => {
		const service = createService({
			cookiesManagement: jest.fn((ctx) => {
				ctx.meta.cookies = { token: "user-token", cart: "abc", session: "sess" };
			}),
			checkCsrfToken: jest.fn().mockReturnValue(false),
		});
		const ctx = {
			meta: { remoteAddress: "127.0.0.1", cookies: {}, headers: {} },
			call: jest.fn().mockResolvedValue([{
				_id: "u1",
				username: "jane",
				email: "j@e.c",
				type: "user",
				restrictions: ["POST /orders"],
			}]),
		};
		const req = {
			method: "GET",
			headers: { cookie: "token=user-token; cart=abc; session=sess" },
			$action: {},
			parsedUrl: "/api/v1/products",
		};
		const user = await service.authenticate(ctx, {}, req, createRes());
		expect(user.username).toBe("jane");

		req.method = "POST";
		req.$alias = { path: "orders/create" };
		req.parsedUrl = "/orders/create";
		req.$action = {};
		ctx.meta.cookies = { token: "user-token", cart: "abc", session: "sess" };
		ctx.meta.headers = {};
		await expect(service.authenticate(ctx, {}, req, createRes())).rejects.toBeDefined();
	});

	it("applies PUT /products restrictions to PUT /api/v1/PRODUCTS", async () => {
		const service = createService({
			cookiesManagement: jest.fn((ctx) => {
				ctx.meta.cookies = { token: "user-token", cart: "abc", session: "sess" };
			}),
			checkCsrfToken: jest.fn().mockReturnValue(true),
		});
		const ctx = {
			meta: { remoteAddress: "127.0.0.1", cookies: {}, headers: {} },
			call: jest.fn().mockResolvedValue([{
				_id: "u1",
				username: "boss",
				email: "a@b.c",
				type: "admin",
				restrictions: ["PUT /products"],
			}]),
		};
		const req = {
			method: "PUT",
			headers: { cookie: "token=user-token; cart=abc; session=sess" },
			$action: {},
			parsedUrl: "/api/v1/PRODUCTS",
		};
		await expect(service.authenticate(ctx, {}, req, createRes())).rejects.toBeDefined();
	});

	it("accepts csrfCheck authType when the CSRF token is valid", async () => {
		const service = createService();
		const issued = Date.now();
		const tokenHash = "csrf-hash";
		const session = jwt.sign({ ip: "127.0.0.1", issued, token: tokenHash }, process.env.JWT_SECRET);
		const headerToken = jwt.sign({ token: tokenHash }, `127.0.0.1--${issued}`);
		const ctx = {
			meta: {
				remoteAddress: "127.0.0.1",
				headers: { authorization: `Token ${headerToken}` },
			},
		};
		const req = {
			headers: {
				cookie: `session=${session}`,
				authorization: `Token ${headerToken}`,
			},
			$action: { authType: "csrfCheck" },
		};
		await expect(service.authenticate(ctx, {}, req, createRes())).resolves.toBeNull();
	});

	it("processUpload authenticates then parses when the user type matches", async () => {
		const service = createService({
			authenticate: jest.fn().mockResolvedValue({ type: "user" }),
			parseUploadedFile: jest.fn(),
			getActiveUploadPath: jest.fn().mockReturnValue({
				validUserTypes: ["user", "admin"],
			}),
		});
		const req = { $ctx: { meta: { user: { type: "user" } } }, $route: {} };
		await service.processUpload(req, createRes());
		expect(service.parseUploadedFile).toHaveBeenCalled();
	});

	it("processUpload returns an error response when authenticate rejects", async () => {
		const err = Object.assign(new Error("NO_RIGHTS"), { code: 401 });
		const service = createService({
			authenticate: jest.fn().mockRejectedValue(err),
			parseUploadedFile: jest.fn(),
		});
		const res = createRes();
		await service.processUpload({ $ctx: { meta: {} }, $route: {} }, res);
		expect(service.parseUploadedFile).not.toHaveBeenCalled();
		expect(res.writeHead).toHaveBeenCalledWith(401, { "content-type": "application/json" });
		expect(res.end).toHaveBeenCalledWith(JSON.stringify({ success: false, error: "Upload failed" }));
	});

	it("processUpload returns an error when getActiveUploadPath throws", async () => {
		const service = createService({
			authenticate: jest.fn().mockResolvedValue({ type: "user" }),
			parseUploadedFile: jest.fn(),
			getActiveUploadPath: jest.fn(() => {
				throw new TypeError("Cannot read properties of undefined");
			}),
		});
		const res = createRes();
		await service.processUpload({ $ctx: { meta: { user: { type: "user" } } }, $route: {} }, res);
		expect(service.parseUploadedFile).not.toHaveBeenCalled();
		expect(res.writeHead).toHaveBeenCalledWith(400, { "content-type": "application/json" });
	});

	it("empty unauthenticated POST /user/image returns an error and does not reject", async () => {
		const service = createService({
			cookiesManagement: jest.fn((ctx) => {
				ctx.meta.cookies = {};
			}),
			checkCsrfToken: jest.fn().mockReturnValue(false),
			parseUploadedFile: jest.fn(),
		});
		const ctx = { meta: { remoteAddress: "127.0.0.1", cookies: {}, headers: {} } };
		const req = {
			method: "POST",
			headers: { cookie: "" },
			$ctx: ctx,
			$route: {},
			$alias: { path: "user/image" },
			parsedUrl: "/api/v1/user/image",
		};
		const res = createRes();
		await expect(service.processUpload(req, res)).resolves.toBeUndefined();
		expect(service.parseUploadedFile).not.toHaveBeenCalled();
		expect(res.writeHead).toHaveBeenCalledWith(401, { "content-type": "application/json" });
		expect(res.end).toHaveBeenCalledWith(JSON.stringify({ success: false, error: "Upload failed" }));
	});

	it("logs afterCallAction payloads", () => {
		const service = createService();
		expect(service.afterCallAction({ name: "render" })).toBeUndefined();
	});
});
