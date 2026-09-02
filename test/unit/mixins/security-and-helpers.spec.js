"use strict";

const path = require("path");
const os = require("os");
const fs = require("fs");
const { MoleculerClientError } = require("moleculer").Errors;
const { resolveSafePath, sanitizeUploadFilename } = require("../../../mixins/path.security");
const {
	escapeRegex,
	sanitizeMongoQuery,
	allowlistQueryFields,
} = require("../../../mixins/mongo.security");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const FileHelpers = require("../../../mixins/file.helpers.mixin");
const validateAddress = require("../../../mixins/validate.address.mixin");
const { isOpenApiEnabled } = require("../../../mixins/openapi.enabled");
const {
	jsonForHtmlScript,
	resolveOpenApiUiSpecUrl,
	renderOpenApiUiHtml,
	openApiUiCsp,
} = require("../../../mixins/openapi.ui-url");
const subproject = require("../../../mixins/subproject.helper");
const dbMixinFactory = require("../../../mixins/db.mixin");

function createHelpersService() {
	return {
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		Promise,
		...HelpersMixin.methods,
	};
}

describe("path.security", () => {
	it("resolves a safe basename under the root", () => {
		const root = os.tmpdir();
		const resolved = resolveSafePath(root, "photo.jpg");
		expect(resolved).toBe(path.resolve(root, "photo.jpg"));
	});

	it("rejects unsafe names and empty files", () => {
		expect(() => resolveSafePath("/tmp", "bad name.jpg")).toThrow(MoleculerClientError);
		expect(() => resolveSafePath("/tmp", "")).toThrow(MoleculerClientError);
		expect(() => resolveSafePath("/tmp", "payload.exe")).not.toThrow();
		expect(() => sanitizeUploadFilename("../etc/passwd.jpg")).not.toThrow();
	});

	it("sanitizes upload filenames and rejects unknown extensions", () => {
		expect(sanitizeUploadFilename("My Photo!.PNG")).toEqual({ base: "My_Photo_.png", ext: "png" });
		expect(() => sanitizeUploadFilename("payload.exe")).toThrow(MoleculerClientError);
		expect(() => sanitizeUploadFilename("noext")).toThrow(MoleculerClientError);
	});
});

describe("mongo.security", () => {
	it("escapes regex metacharacters", () => {
		expect(escapeRegex("a.b*c")).toBe("a\\.b\\*c");
		expect(escapeRegex(null)).toBe("");
	});

	it("strips forbidden operators and prototype keys", () => {
		const cleaned = sanitizeMongoQuery({
			name: "shirt",
			$where: "1==1",
			__proto__: { polluted: true },
			constructor: { prototype: {} },
			nested: { $gt: { $ne: 1 } },
		}, { allowedOperators: ["$gt"] });

		expect(cleaned.name).toBe("shirt");
		expect(cleaned.$where).toBeUndefined();
		expect(cleaned.nested).toBeUndefined();
	});

	it("keeps allowlisted operators with safe values", () => {
		const cleaned = sanitizeMongoQuery({
			price: { $gte: 10, $lte: 50 },
			tags: { $in: ["a", "b", { nested: true }] },
			active: { $exists: true },
			name: { $regex: "sh.rt" },
			$or: [{ sku: "A" }, { sku: "B" }, "skip-me"],
		}, { allowedOperators: ["$gte", "$lte", "$in", "$exists", "$regex", "$or"] });

		expect(cleaned.price.$gte).toBe(10);
		expect(cleaned.tags.$in).toEqual(["a", "b"]);
		expect(cleaned.active.$exists).toBe(true);
		expect(cleaned.name.$regex).toBeInstanceOf(RegExp);
		expect(cleaned.$or).toHaveLength(2);
	});

	it("allowlists query fields", () => {
		const query = allowlistQueryFields(
			{ name: "x", secret: "nope", $or: [{ name: "y" }] },
			["name"],
			{ allowedOperators: ["$or"] }
		);
		expect(query).toEqual({ name: "x" });
	});
});

describe("helpers.mixin", () => {
	const service = createHelpersService();

	it("chunks strings and replaces params", () => {
		expect(service.stringChunk("abcdef", 2, "/")).toBe("ab/cd/ef");
		expect(service.stringChunk("", 2, "/")).toBe("");
		expect(service.stringReplaceParams("/:lang/page/:slug", { lang: "en", slug: "about" })).toBe("/en/page/about");
		expect(service.arrayReplaceParams(["/:lang", "/static"], { lang: "sk" })).toEqual(["/sk", "/static"]);
		expect(service.arrayReplaceParams([], { lang: "sk" })).toEqual([]);
	});

	it("rounds and formats prices", () => {
		expect(service.roundNumber(1.234)).toBeCloseTo(1.23);
		expect(service.roundNumber(1.235, 2)).toBeCloseTo(1.24);
		expect(service.roundNumber(10)).toBe(10);
		expect(service.formatPrice(1.239)).toBe(1.24);
	});

	it("picks values, sorts objects, and reads addresses", () => {
		expect(service.getValueByCode([{ code: "en", name: "English" }, { code: "sk" }], "sk")).toEqual({ code: "sk" });
		expect(service.sortObject({ b: 2, a: { d: 1, c: 0 } })).toEqual({ a: { c: 0, d: 1 }, b: 2 });
		const user = {
			addresses: [
				{ type: "invoice", city: "Bratislava" },
				{ type: "delivery", city: "Kosice" },
			],
		};
		expect(service.getUserAddress(user, "delivery").city).toBe("Kosice");
		expect(service.getUserAddress(user).city).toBe("Bratislava");
		expect(service.getUserAddress({})).toBeNull();
	});

	it("computes VAT and IT tax data", () => {
		const vat = service.getProductTaxData({ price: 100 }, { global: { taxDecimal: 0.2 }, taxType: "VAT" });
		expect(vat.taxData.priceWithTax).toBe(100);
		expect(vat.taxData.priceWithoutTax).toBe(80);

		const it = service.getProductTaxData({ price: 100, tax: 0.1 }, { global: { taxDecimal: 0.2 }, taxType: "IT" });
		expect(it.taxData.priceWithoutTax).toBe(100);
		expect(it.taxData.priceWithTax).toBe(110);
	});

	it("reads request data, strips diacritics, and merges objects", () => {
		const ctx = {
			options: {
				parentCtx: {
					params: {
						req: {
							parsedUrl: "/en/products",
							query: { q: "shirt" },
							headers: { host: "example.com" },
						},
					},
				},
			},
		};
		expect(service.getRequestData(ctx)).toMatchObject({
			url: { string: "/en/products", array: ["", "en", "products"] },
			query: { q: "shirt" },
			headers: { host: "example.com" },
		});
		expect(service.removeDiacritics("čučoriedka")).toBe("cucoriedka");
		expect(service.updateObject({ a: 1, nested: { b: 2 } }, { nested: { c: 3 }, d: 4, constructor: { x: 1 } }))
			.toEqual({ a: 1, nested: { b: 2, c: 3 }, d: 4 });
		expect(service.updateObject(null, { a: 1 })).toBeUndefined();
	});

	it("strips javascript from strings, objects, and arrays", () => {
		expect(service.removeJavascriptTag(null)).toBeNull();
		expect(service.unJsString("<script>alert(1)</script>safe")).not.toMatch(/script/i);
		expect(service.unJsString({ html: "<script>x</script>ok" }).html).toContain("ok");
		expect(service.unJsString(["<script>x</script>ok"])[0]).toContain("ok");
	});

	it("adds months and days and merges content-dependency codes", () => {
		const jan31 = new Date(2024, 0, 31);
		expect(service.addMonths(jan31, 1).getMonth()).toBe(1);
		expect(service.addDays(new Date("2024-01-01T00:00:00Z"), 2).getUTCDate()).toBe(3);
		expect(service.mergeContentDependencyCodes(["a"], ["a", "b"])).toEqual(["a", "b"]);
		expect(service.mergeContentDependencyCodes(null, "nope")).toEqual([]);
	});

	it("extracts and restores subscription content dependencies", async () => {
		expect(service.getContentDependencyRemovalParamsFromSubscription({})).toBeNull();
		const subscription = {
			userId: "user-1",
			data: { product: { contentDependency: true, orderCode: "P-1" } },
		};
		expect(service.getContentDependencyRemovalParamsFromSubscription(subscription)).toEqual({
			userId: "user-1",
			productCodes: ["P-1"],
		});

		const ctx = { call: jest.fn().mockResolvedValue(true) };
		await expect(service.removeSubscriptionContentDependencies(ctx, {})).resolves.toBeNull();
		await service.restoreSubscriptionContentDependencies(ctx, subscription);
		expect(ctx.call).toHaveBeenCalledWith("users.addContentDependencies", {
			userId: "user-1",
			productCodes: ["P-1"],
		});
	});

	it("rejects non-admins", async () => {
		await expect(service.requireAdmin({ meta: { user: { type: "user" } } })).rejects.toMatchObject({ code: 403 });
		expect(service.requireAdmin({ meta: { user: { type: "admin" } } })).toBeNull();
	});
});

describe("file.helpers.mixin", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-file-helpers-"));
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		...FileHelpers.methods,
	};

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("splits paths and reads files with language fallback", async () => {
		expect(service.splitPath("/pages/about-en.html")).toMatchObject({
			name: "about",
			lang: "en",
			ext: "html",
		});
		expect(service.getExtension("cover.jpg")).toBe("jpg");
		expect(service.removeParentTraversing("../resources/pages")).toBe("resources/pages");

		const withLang = path.join(tmpDir, "page-en.html");
		fs.writeFileSync(withLang, "hello-en");
		await expect(service.getCorrectFile(withLang)).resolves.toBe("hello-en");
		await expect(service.fileExists(withLang)).resolves.toBe(true);

		const missingLang = path.join(tmpDir, "fallback-sk.html");
		const noLang = path.join(tmpDir, "fallback.html");
		fs.writeFileSync(noLang, "hello");
		await expect(service.getCorrectFile(missingLang)).resolves.toBe("hello");
		expect(service.getCorrectFile(path.join(tmpDir, "missing-en.html"))).toBeNull();
	});
});

describe("validate.address.mixin", () => {
	it("reports empty required fields", () => {
		const result = validateAddress({
			nameFirst: "Jane",
			nameLast: "",
			street: "Main",
			zip: "123",
			city: "Town",
			country: "SK",
			phone: "123",
			street2: "",
		});
		expect(result.result).toBe(false);
		expect(result.errors).toEqual([{ name: "nameLast", action: "is empty" }]);
	});
});

describe("openapi.enabled", () => {
	const original = { ...process.env };

	afterEach(() => {
		process.env.NODE_ENV = original.NODE_ENV;
		if (original.OPENAPI_ENABLED === undefined) {
			delete process.env.OPENAPI_ENABLED;
		} else {
			process.env.OPENAPI_ENABLED = original.OPENAPI_ENABLED;
		}
		if (original.SITE_URL === undefined) {
			delete process.env.SITE_URL;
		} else {
			process.env.SITE_URL = original.SITE_URL;
		}
	});

	it("follows explicit flags, env, and demo host", () => {
		process.env.OPENAPI_ENABLED = "true";
		expect(isOpenApiEnabled()).toBe(true);
		process.env.OPENAPI_ENABLED = "false";
		expect(isOpenApiEnabled()).toBe(false);
		delete process.env.OPENAPI_ENABLED;
		process.env.NODE_ENV = "production";
		process.env.SITE_URL = "https://demo.stretchshop.app";
		expect(isOpenApiEnabled()).toBe(true);
		process.env.SITE_URL = "https://shop.example.com";
		expect(isOpenApiEnabled()).toBe(false);
	});
});

describe("openapi.ui-url", () => {
	const xssUrl = "</script><script>alert(1)</script>";

	it("accepts missing or local schema url and rejects anything else", () => {
		expect(resolveOpenApiUiSpecUrl(undefined).url).toBe("/openapi/openapi.json");
		expect(resolveOpenApiUiSpecUrl("").url).toBe("/openapi/openapi.json");
		expect(resolveOpenApiUiSpecUrl("/openapi/openapi.json").url).toBe("/openapi/openapi.json");
		expect(resolveOpenApiUiSpecUrl(xssUrl).ok).toBe(false);
		expect(resolveOpenApiUiSpecUrl("javascript:alert(1)").ok).toBe(false);
		expect(resolveOpenApiUiSpecUrl("https://evil.example/openapi.json").ok).toBe(false);
		expect(resolveOpenApiUiSpecUrl("//evil.example/openapi/openapi.json").ok).toBe(false);
	});

	it("encodes script-breakout sequences in JSON embedded in HTML", () => {
		const encoded = jsonForHtmlScript({ url: xssUrl });
		expect(encoded).not.toMatch(/<\/script>/i);
		expect(encoded).toContain("\\u003c/script\\u003e");
	});

	it("renders UI HTML that cannot close the settings script with a hostile url", () => {
		const html = renderOpenApiUiHtml({
			specUrl: xssUrl,
			assetsPath: "/openapi/assets",
			oauth2RedirectUrl: "/openapi/oauth2-redirect",
			nonce: "test-nonce",
		});
		expect(html).not.toContain(xssUrl);
		expect(html).toContain("\\u003c/script\\u003e");
		expect(html).toContain('nonce="test-nonce"');
		expect(openApiUiCsp("test-nonce")).toContain("script-src 'nonce-test-nonce' 'self'");
	});
});

describe("openapi.ui action", () => {
	const openapi = require("../../../services/openapi/openapi.service");
	const xssUrl = "</script><script>alert(1)</script>";
	const service = {
		getOpenApiPaths: async () => ({
			schemaPath: "/openapi/openapi.json",
			assetsPath: "/openapi/assets",
			oauth2RedirectPath: "/openapi/oauth2-redirect",
		}),
		settings: {},
	};

	it("rejects a script-breakout url query", async () => {
		const ctx = { params: { url: xssUrl }, meta: {} };
		await expect(openapi.actions.ui.handler.call(service, ctx)).rejects.toMatchObject({
			code: 400,
			type: "INVALID_OPENAPI_URL",
		});
	});

	it("serves the local spec when url is omitted", async () => {
		const ctx = { params: {}, meta: {} };
		const html = await openapi.actions.ui.handler.call(service, ctx);
		expect(html).toContain("/openapi/openapi.json");
		expect(html).not.toContain(xssUrl);
		expect(ctx.meta.$responseHeaders["Content-Security-Policy"]).toMatch(/nonce-/);
	});
});

describe("subproject.helper", () => {
	it("merges missing aliases protectively", () => {
		const merged = subproject.mergePropertiesProtective(
			{ keep: 1, aliases: { a: 1 } },
			{ keep: 9, extra: 2 }
		);
		expect(merged).toEqual({ keep: 1, aliases: { a: 1 }, extra: 2 });
		expect(subproject.subprojectPathFix(__dirname, "/does-not-exist.js")).toContain("does-not-exist.js");
	});
});

describe("db.mixin methods", () => {
	const originalMongoUri = process.env.MONGO_URI;
	process.env.MONGO_URI = "mongodb://localhost:27017/coverage-test";
	const mixin = dbMixinFactory("coverage-collection");
	if (originalMongoUri === undefined) {
		delete process.env.MONGO_URI;
	} else {
		process.env.MONGO_URI = originalMongoUri;
	}
	const service = {
		...mixin.methods,
		adapter: {
			stringToObjectID: (id) => ({ oid: id }),
		},
	};

	it("normalizes ids and sanitizes updates", () => {
		expect(service.idToString(null)).toBeNull();
		expect(service.idToString("abc")).toBe("abc");
		expect(service.idToString(["nested"])).toBe("nested");
		expect(service.idToString({ $oid: "oid-1" })).toBe("oid-1");
		expect(service.idToString({ toHexString: () => "hex" })).toBe("hex");
		expect(service.sanitizeForMongoUpdate(10n)).toBe(10);
		expect(service.sanitizeForMongoUpdate({ a: new Date("2024-01-01"), b: [1, 2] })).toMatchObject({
			b: [1, 2],
		});
		const request = { query: { _id: "507f1f77bcf86cd799439011" } };
		service.fixRequestIds(request);
		expect(request.query._id).toEqual({ oid: "507f1f77bcf86cd799439011" });
	});
});
