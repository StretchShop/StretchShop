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
		expect(ctx.meta.cookies.session).toEqual(expect.any(String));
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
		service.processUpload(req, createRes());
		await Promise.resolve();
		expect(service.parseUploadedFile).toHaveBeenCalled();
	});

	it("logs afterCallAction payloads", () => {
		const service = createService();
		expect(service.afterCallAction({ name: "render" })).toBeUndefined();
	});
});
