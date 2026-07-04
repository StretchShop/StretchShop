"use strict";

const { createTestBroker } = require("../../setup/broker");
const ApiService = require("../../../services/api/api.service");

describe("Test 'api' helper methods", () => {
	let broker;
	let serviceApi;

	beforeAll(async () => {
		broker = createTestBroker();
		serviceApi = broker.createService({
			name: "api",
			mixins: [ApiService],
			settings: {
				...ApiService.settings,
				server: false,
			},
		});
		await broker.start();
	});

	afterAll(async () => {
		await broker.stop();
	});

	describe("parseCookies", () => {
		it("should parse cookie header into key-value pairs", () => {
			expect(serviceApi.parseCookies("cart=abc123; token=xyz")).toEqual({
				cart: "abc123",
				token: "xyz",
			});
		});

		it("should return empty object for missing cookie header", () => {
			expect(serviceApi.parseCookies()).toEqual({});
		});
	});

	describe("buildGlobalSearchQuery", () => {
		it("should build regex query for each field and language", () => {
			const query = serviceApi.buildGlobalSearchQuery("shirt", ["en", "sk"]);

			expect(query.limit).toBe(10);
			expect(query.query.$or).toHaveLength(6);
			expect(query.query.$or).toEqual(
				expect.arrayContaining([
					{ "name.en": { $regex: "shirt", $options: "i" } },
					{ "descriptionLong.sk": { $regex: "shirt", $options: "i" } },
				])
			);
		});
	});

	describe("getProductFileNameByType", () => {
		it("should return gallery filename pattern", () => {
			expect(serviceApi.getProductFileNameByType({ type: "gallery" })).toEqual(["p:number"]);
		});

		it("should return editor filename pattern", () => {
			expect(serviceApi.getProductFileNameByType({ type: "editor" })).toEqual(["----WYSIWYGEDITOR----"]);
		});

		it("should return default filename pattern", () => {
			expect(serviceApi.getProductFileNameByType({})).toEqual([":orderCode", "default"]);
		});
	});

	describe("getActiveUploadPath", () => {
		it("should resolve user profile upload path", () => {
			const req = {
				$alias: { path: "user/image" },
				$params: {},
				$ctx: { meta: { user: { _id: "507f1f77bcf86cd799439011", email: "user@example.com" } } },
			};

			const path = serviceApi.getActiveUploadPath(req);

			expect(path).toMatchObject({
				url: "/user/image",
				destination: "users/profile",
				validUserTypes: ["user", "admin"],
				postAction: "users.updateMyProfileImage",
			});
		});

		it("should return null for unknown upload path", () => {
			const req = {
				$alias: { path: "unknown/path" },
				$params: {},
				$ctx: { meta: { user: { email: "user@example.com" } } },
			};

			expect(serviceApi.getActiveUploadPath(req)).toBeNull();
		});
	});

	describe("setCookie", () => {
		it("should store cookie value and options in ctx meta", () => {
			const ctx = { meta: { cookies: {} } };

			serviceApi.setCookie(ctx, "cart", "hash-value", { httpOnly: true });

			expect(ctx.meta.makeCookies.cart).toEqual({
				value: "hash-value",
				options: expect.objectContaining({
					httpOnly: true,
					path: "/",
				}),
			});
			expect(ctx.meta.cookies.cart).toBe("hash-value");
		});
	});

	describe("api.globalSearch action", () => {
		beforeAll(() => {
			broker.createService({
				name: "products",
				actions: {
					find: {
						handler() {
							return [{ orderCode: "PROD-1" }];
						},
					},
				},
			});
			broker.createService({
				name: "pages",
				actions: {
					find: {
						handler() {
							return [{ slug: "about" }];
						},
					},
				},
			});
			broker.createService({
				name: "categories",
				actions: {
					find: {
						handler() {
							return [{ slug: "books" }];
						},
					},
				},
			});
		});

		it("should aggregate search results from products, pages, and categories", async () => {
			const result = await broker.call("api.globalSearch", { query: "test" }, {
				meta: {
					localsDefault: {
						langs: [{ code: "en" }],
					},
				},
			});

			expect(result).toEqual({
				products: [{ orderCode: "PROD-1" }],
				pages: [{ slug: "about" }],
				categories: [{ slug: "books" }],
			});
		});
	});
});
