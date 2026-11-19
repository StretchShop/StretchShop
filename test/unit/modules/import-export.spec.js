"use strict";

const fs = require("fs");
const path = require("path");
const { listProviders, getProvider } = require("../../../modules/import-export");
const { createZip, extractZip } = require("../../../modules/import-export/zip");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const ImportExportService = require("../../../services/import-export/import-export.service");

const fixtures = path.join(__dirname, "../../fixtures/import-export");

describe("modules/import-export registry", () => {
	it("lists stretchshop, shoptet, and woocommerce", () => {
		const list = listProviders();
		expect(list.map((p) => p.id).sort()).toEqual(["shoptet", "stretchshop", "woocommerce"]);
		expect(getProvider("shoptet").entities.pages).toBe(false);
	});

	it("throws on unknown provider", () => {
		expect(() => getProvider("magento")).toThrow(/Unknown/);
	});
});

describe("stretchshop provider", () => {
	it("round-trips JSON fixture", () => {
		const provider = getProvider("stretchshop");
		const buf = fs.readFileSync(path.join(fixtures, "stretchshop-export.json"));
		const parsed = provider.import.parse(buf);
		expect(parsed.products).toHaveLength(1);
		expect(parsed.categories).toHaveLength(1);
		expect(parsed.pages).toHaveLength(1);

		const out = provider.export.serialize(parsed, {
			entities: ["products", "categories", "pages"]
		});
		expect(out.filename).toBe("stretchshop-export.json");
		const again = JSON.parse(out.buffer.toString("utf8"));
		expect(again.products[0].externalId).toBe("SS-1");
	});
});

describe("shoptet provider", () => {
	it("parses products XML and builds categories", () => {
		const provider = getProvider("shoptet");
		const buf = fs.readFileSync(path.join(fixtures, "shoptet-products.xml"));
		const parsed = provider.import.parse(buf, {
			defaultLang: "en",
			entities: ["products", "categories"]
		});
		expect(parsed.products[0].externalId).toBe("ABC123");
		expect(parsed.products[0].name.en).toBe("Test Shirt");
		expect(parsed.products[0].price).toBeCloseTo(19.9);
		expect(parsed.categories.length).toBeGreaterThanOrEqual(1);

		const xmlOut = provider.export.serialize(
			{ products: parsed.products },
			{ entities: ["products"], defaultLang: "en" }
		);
		expect(xmlOut.contentType).toBe("application/xml");
		expect(xmlOut.buffer.toString("utf8")).toContain("ABC123");
	});

	it("rejects pages entity", () => {
		const provider = getProvider("shoptet");
		expect(() =>
			provider.import.parse(Buffer.from("<SHOP/>"), {
				entities: ["pages"]
			})
		).toThrow(/Pages are not supported/);
	});
});

describe("woocommerce provider", () => {
	it("parses products CSV", () => {
		const provider = getProvider("woocommerce");
		const buf = fs.readFileSync(path.join(fixtures, "woocommerce-products.csv"));
		const parsed = provider.import.parse(buf, {
			filename: "woocommerce-products.csv",
			defaultLang: "en",
			entities: ["products", "categories"]
		});
		expect(parsed.products[0].externalId).toBe("WOO-1");
		expect(parsed.products[0].name.en).toBe("Woo Hat");
		expect(parsed.categories.length).toBeGreaterThanOrEqual(1);
	});

	it("parses WXR pages", () => {
		const provider = getProvider("woocommerce");
		const buf = fs.readFileSync(path.join(fixtures, "woocommerce-pages.xml"));
		const parsed = provider.import.parse(buf, {
			filename: "woocommerce-pages.xml",
			defaultLang: "en",
			entities: ["pages"]
		});
		expect(parsed.pages).toHaveLength(1);
		expect(parsed.pages[0].slug).toBe("about-us");
	});

	it("exports products+pages as zip", () => {
		const provider = getProvider("woocommerce");
		const out = provider.export.serialize(
			{
				products: [{
					externalId: "WOO-1",
					orderCode: "WOO-1",
					name: { en: "Hat" },
					price: 10,
					categories: ["hats"]
				}],
				pages: [{
					externalId: "woo-page-1",
					slug: "about",
					name: { en: "About" },
					descriptionLong: { en: "Hi" }
				}]
			},
			{ entities: ["products", "pages"], defaultLang: "en" }
		);
		expect(out.contentType).toBe("application/zip");
		const files = extractZip(out.buffer);
		expect(Object.keys(files)).toEqual(expect.arrayContaining(["products.csv", "pages.xml"]));
	});
});

describe("zip helper", () => {
	it("round-trips stored files", () => {
		const zip = createZip({ "a.txt": Buffer.from("hello") });
		const files = extractZip(zip);
		expect(files["a.txt"].toString("utf8")).toBe("hello");
	});
});

describe("resolveImportEntity", () => {
	it("finds by id or externalId", async () => {
		const service = {
			adapter: {
				findById: jest.fn().mockResolvedValue({ _id: "1", externalId: "X" }),
				find: jest.fn().mockResolvedValue([{ _id: "2", externalId: "EXT" }])
			},
			...HelpersMixin.methods
		};
		const byId = await service.resolveImportEntity({ id: "1" });
		expect(byId._id).toBe("1");
		const byExt = await service.resolveImportEntity({ externalId: "EXT" });
		expect(byExt._id).toBe("2");
		const miss = await service.resolveImportEntity({});
		expect(miss).toBeNull();
	});
});

describe("import-export service", () => {
	function buildService() {
		return {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			requireAdmin: HelpersMixin.methods.requireAdmin,
			getDefaultLang: ImportExportService.methods.getDefaultLang,
			normalizeEntities: ImportExportService.methods.normalizeEntities,
			runImport: ImportExportService.methods.runImport,
			runExport: ImportExportService.methods.runExport,
			importEntities: ImportExportService.methods.importEntities,
			loadAll: ImportExportService.methods.loadAll
		};
	}

	it("providers action rejects non-admin", async () => {
		const service = buildService();
		const denied = service.requireAdmin({ meta: { user: { type: "user" } } });
		await expect(denied).rejects.toMatchObject({ code: 403 });
	});

	it("normalizes entities and rejects unsupported pages for shoptet", () => {
		const service = buildService();
		const provider = getProvider("shoptet");
		expect(() => service.normalizeEntities(["pages"], provider)).toThrow(/not supported/);
		expect(service.normalizeEntities(["products"], provider)).toEqual(["products"]);
	});

	it("runImport maps file and calls catalog imports", async () => {
		const service = buildService();
		const calls = [];
		const ctx = {
			meta: {
				user: { type: "admin", email: "admin@example.com" },
				localsDefault: { lang: { code: "en" } }
			},
			params: {
				provider: "shoptet",
				entities: ["products", "categories"],
				filename: "shoptet-products.xml",
				_fileBuffer: fs.readFileSync(path.join(fixtures, "shoptet-products.xml"))
			},
			call: jest.fn(async (action, params) => {
				calls.push({ action, params });
				const key = Object.keys(params)[0];
				return (params[key] || []).map((e) => ({
					...e,
					_id: "new-" + e.externalId,
					dates: { dateCreated: new Date("2026-01-01"), dateUpdated: new Date("2026-01-01") }
				}));
			})
		};

		const summary = await service.runImport(ctx);
		expect(calls.map((c) => c.action)).toEqual(["categories.import", "products.import"]);
		expect(summary.created.categories).toBeGreaterThanOrEqual(1);
		expect(summary.created.products).toBe(1);
		expect(summary.errors).toEqual([]);
	});

	it("runExport returns base64 payload", async () => {
		const service = buildService();
		const ctx = {
			meta: {
				user: { type: "admin", email: "admin@example.com" },
				localsDefault: { lang: "en" }
			},
			params: {
				provider: "stretchshop",
				entities: ["products"]
			},
			call: jest.fn(async (action) => {
				if (action === "products.find") {
					return [{
						externalId: "P1",
						name: { en: "P" },
						price: 1,
						type: "product"
					}];
				}
				return [];
			})
		};
		const result = await service.runExport(ctx);
		expect(result.filename).toBe("stretchshop-export.json");
		expect(result.contentType).toBe("application/json");
		const decoded = JSON.parse(Buffer.from(result.contentBase64, "base64").toString("utf8"));
		expect(decoded.products).toHaveLength(1);
	});
});
