"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const pageCore = require("../../../services/pages/methods/core.methods");
const productCore = require("../../../services/products/methods/core.methods");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");
const FileHelpers = require("../../../mixins/file.helpers.mixin");
const SettingsMixin = require("../../../mixins/settings.mixin");

function baseService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		Promise,
		unJsString: HelpersMixin.methods.unJsString,
		removeJavascriptTag: HelpersMixin.methods.removeJavascriptTag,
		getRequestData: HelpersMixin.methods.getRequestData,
		makeProductPriceLevels: priceLevels.methods.makeProductPriceLevels,
		isValidUsertype: priceLevels.methods.isValidUsertype,
		calculatePriceForUsertype: priceLevels.methods.calculatePriceForUsertype,
		priceByUser: priceLevels.methods.priceByUser,
		getCorrectFile: FileHelpers.methods.getCorrectFile,
		readFile: FileHelpers.methods.readFile,
		validateEntity: jest.fn((entity) => Promise.resolve(entity)),
		transformDocuments: jest.fn((ctx, params, doc) => doc),
		entityChanged: jest.fn().mockResolvedValue(true),
		adapter: {
			updateById: jest.fn().mockResolvedValue({ _id: "id-1" }),
			insert: jest.fn((entity) => Promise.resolve({ _id: "id-2", ...entity })),
		},
		...extra,
	};
}

describe("pages core import and detail", () => {
	it("updates an existing page", async () => {
		const service = baseService({ ...pageCore.methods });
		const ctx = { meta: { afterCallAction: null }, call: jest.fn() };
		const result = await service.importPageAction(ctx, {
			id: "p1",
			data: { blocks: { en: "<p>Hi</p>" } },
			dates: { dateCreated: "2024-01-01T00:00:00.000Z" },
			activity: { start: "2024-01-02T00:00:00.000Z" },
		}, { _id: "p1" });
		expect(service.adapter.updateById).toHaveBeenCalled();
		expect(result._id).toBe("id-1");
	});

	it("creates a new page with a generated slug", async () => {
		const service = baseService({ ...pageCore.methods });
		const ctx = {
			meta: { user: { email: "ed@example.com" }, localsDefault: { lang: { code: "en" } } },
			call: jest.fn().mockResolvedValue([]),
		};
		const result = await service.importPageAction(ctx, {
			name: { en: "About Us" },
			slug: "",
			data: { blocks: { en: "<p>Hi</p>" } },
		}, null);
		expect(result.slug).toBe("about-us");
		expect(ctx.meta.afterCallAction.name).toBe("page insert");
	});

	it("loads page detail and processes WYSIWYG placeholders", async () => {
		const service = baseService({
			...pageCore.methods,
			getCorrectFile: jest.fn().mockResolvedValue("<html><!-- {{editor_WYSIWYG}} //--></html>"),
			readFile: jest.fn().mockResolvedValue(JSON.stringify({ title: "About" })),
			processPageWysiwygContent: jest.fn().mockResolvedValue({ body: "rendered" }),
		});
		const result = await service.getPageDetail({ meta: {} }, {
			filepath: "/tmp/about-en.html",
			parentDir: "/tmp/",
			pageName: "about",
		});
		expect(service.processPageWysiwygContent).toHaveBeenCalled();
		expect(result).toEqual({ body: "rendered" });
	});

	it("rejects required-product pages without matching user content", async () => {
		const service = baseService({
			...pageCore.methods,
			getCorrectFile: jest.fn().mockResolvedValue("<html></html>"),
			readFile: jest.fn().mockResolvedValue(JSON.stringify({
				data: { requirements: { userdata: { products: ["P-1"] } } },
			})),
		});
		await expect(service.getPageDetail({ meta: {} }, {
			filepath: "/tmp/x.html",
			parentDir: "/tmp/",
			pageName: "x",
		})).resolves.toBeUndefined();
	});
});

describe("products core import and detail extras", () => {
	it("updates and creates products", async () => {
		const service = baseService({ ...productCore.methods });
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			priceLevels: { validTypes: { userTypes: ["user.gold"] }, discounts: { "user.gold": { type: "percent", value: -10 } } },
			taxData: { global: { taxDecimal: 0.2 } },
		});
		const ctx = {
			meta: { user: { email: "ed@example.com" }, localsDefault: { lang: { code: "en" } } },
			call: jest.fn().mockResolvedValue([]),
		};
		await service.importProductAction(ctx, {
			id: "prod-1",
			descriptionLong: { en: "<p>Hi</p>" },
			dates: { dateCreated: "2024-01-01T00:00:00.000Z" },
			activity: { start: "2024-01-02T00:00:00.000Z" },
			price: 100,
		}, { _id: "prod-1" });
		expect(service.adapter.updateById).toHaveBeenCalled();

		const created = await service.importProductActionCreateNew(ctx, {
			name: { en: "Gadget" },
			slug: "",
			descriptionLong: { en: "<p>Hi</p>" },
			price: 50,
		});
		expect(created.slug).toBe("gadget");
		SettingsMixin.getSiteSettings.mockRestore();
	});

	it("adds parent category data and rejects inactive products", async () => {
		const service = baseService({ ...productCore.methods });
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			taxData: { global: { taxDecimal: 0.2 } },
			priceLevels: { validTypes: { userTypes: [] } },
		});
		const ctx = {
			meta: { user: { type: "user", email: "a@b.c" } },
			call: jest.fn().mockResolvedValue({ pathSlug: "electronics" }),
		};
		const found = await service.detailActionAddBasicData(ctx, {
			publisher: "other@example.com",
			price: 10,
			categories: ["electronics"],
		}, false);
		expect(found.parentCategoryDetail.pathSlug).toBe("electronics");

		await expect(service.detailActionAddBasicData(ctx, {
			publisher: "other@example.com",
			activity: { start: "2099-01-01" },
			categories: [],
			price: 10,
		}, false)).rejects.toBeInstanceOf(MoleculerClientError);
		SettingsMixin.getSiteSettings.mockRestore();
	});
});
