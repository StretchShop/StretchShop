"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const helpers = require("../../../services/products/methods/helpers.methods");
const queryMixin = require("../../../services/products/mixins/products.actions.query.mixin");
const mutationMixin = require("../../../services/products/mixins/products.actions.mutation.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const SettingsMixin = require("../../../mixins/settings.mixin");

function createService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		Promise,
		fixRequestIds: (filter) => filter,
		getPriceVariable: priceLevels.methods.getPriceVariable,
		priceByUser: priceLevels.methods.priceByUser,
		makeProductPriceLevels: priceLevels.methods.makeProductPriceLevels,
		isValidUsertype: priceLevels.methods.isValidUsertype,
		calculatePriceForUsertype: priceLevels.methods.calculatePriceForUsertype,
		getProductTaxData: HelpersMixin.methods.getProductTaxData,
		adapter: {
			find: jest.fn(),
			updateById: jest.fn().mockResolvedValue(true),
			findById: jest.fn(),
		},
		...helpers.methods,
		...extra,
	};
}

describe("products helpers", () => {
	const service = createService();

	it("filters inactive products except for admins", () => {
		expect(service.filterOnlyActiveProducts({ $and: [] }, { type: "admin" }).$and).toHaveLength(0);
		expect(service.filterOnlyActiveProducts({ $and: [] }, { type: "user" }).$and).toHaveLength(3);
	});

	it("sorts by user-specific price", () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			sorting: { products: { default: "name" } },
			priceLevels: { validTypes: { userTypes: ["user.gold"] } },
		});
		const filter = service.getFilterSort({}, { params: { sort: "-price" }, meta: { user: { type: "user", subtype: "gold" } } });
		expect(filter.sort).toBe("-priceLevels.user.gold");
		SettingsMixin.getSiteSettings.mockRestore();
	});

	it("rebuilds price-level chunks", () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			priceLevels: {
				validTypes: { userTypes: ["user.gold"] },
				discounts: { "user.gold": { type: "percent", value: -10 } },
			},
		});
		const result = service.rebuildProductChunks([{ _id: "p1", price: 100 }]);
		expect(result[0].id).toBe("p1");
		expect(service.adapter.updateById).toHaveBeenCalled();
		SettingsMixin.getSiteSettings.mockRestore();
	});

	it("merges product properties and variable types", () => {
		const merged = service.processCategoryProductsProperties([
			{ color: { name: { en: "Color" }, value: { en: "Blue" } } },
			{ color: { name: { en: "Colour" }, value: { en: "Red" } } },
			{ size: "M" },
		]);
		expect(merged.color.name.en).toEqual(["Color", "Colour"]);
		expect(merged.size).toBe("M");

		expect(service.variableTypeMerge(null, "new")).toBe("new");
		expect(service.variableTypeMerge("old", null)).toBe("old");
		expect(service.variableTypeMerge(["a"], ["b"])).toEqual(["a", "b"]);
		expect(service.variableTypeMerge(["a"], "b")).toEqual(["a", "b"]);
		expect(service.variableTypeMerge("a", "b")).toEqual(["a", "b"]);
		expect(service.variableTypeMerge("a", "a")).toEqual(["a"]);
		expect(service.simpleTypes()).toEqual(["string", "number", "boolean"]);
	});
});

describe("products.query actions", () => {
	it("finds products and applies price/tax", async () => {
		const service = createService();
		service.adapter.find.mockResolvedValue([{ price: 100, tax: 0.2 }]);
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			taxData: { global: { taxDecimal: 0.2 }, taxType: "VAT" },
			priceLevels: { validTypes: { userTypes: [] } },
		});
		const results = await queryMixin.actions.find.handler.call(service, {
			params: { query: { $and: [{ type: "product" }] }, limit: 500 },
			meta: { user: { type: "user" } },
		});
		expect(results[0].taxData.priceWithTax).toBe(100);
		expect(service.adapter.find.mock.calls[0][0].limit).toBe(100);
		SettingsMixin.getSiteSettings.mockRestore();
	});

	it("rejects findAdmin for non-admins and delegates for admins", async () => {
		const service = createService();
		await expect(queryMixin.actions.findAdmin.handler.call(service, {
			meta: { user: { type: "user" } },
			params: {},
		})).rejects.toMatchObject({ code: 403 });

		const ctx = { meta: { user: { type: "admin" } }, params: { query: {} }, call: jest.fn().mockResolvedValue([]) };
		await queryMixin.actions.findAdmin.handler.call(service, ctx);
		expect(ctx.call).toHaveBeenCalledWith("products.find", { query: {} });
	});

	it("maps GET list params onto productsList", async () => {
		const service = createService();
		const ctx = {
			params: { category: "electronics", limit: "12" },
			call: jest.fn().mockResolvedValue({ results: [] }),
		};
		await queryMixin.actions.productsListGet.handler.call(service, ctx);
		expect(ctx.call).toHaveBeenCalledWith("products.productsList", {
			category: "electronics",
			filter: { limit: "12" },
		});
	});

	it("lists products for a category", async () => {
		const service = createService({
			filterOnlyActiveProducts: helpers.methods.filterOnlyActiveProducts,
			getFilterSort: (filter) => {
				filter.sort = "name";
				return filter;
			},
		});
		const ctx = {
			params: { category: "electronics", filter: { query: { type: "product" }, limit: 10 } },
			meta: { user: { type: "user" } },
			call: jest.fn((action) => {
				if (action === "categories.detail") {
					return Promise.resolve({
						pathSlug: "electronics",
						subsSlugs: ["electronics/phones"],
					});
				}
				if (action === "products.find") {
					return Promise.resolve([{ slug: "phone" }]);
				}
				if (action === "categories.findActive") {
					return Promise.resolve([]);
				}
				if (action === "products.count") {
					return Promise.resolve(1);
				}
				if (action === "products.getCategoryProductsProperties") {
					return Promise.resolve({ color: ["blue"] });
				}
				return Promise.resolve([]);
			}),
		};
		const result = await queryMixin.actions.productsList.handler.call(service, ctx);
		expect(result.results).toEqual([{ slug: "phone" }]);
	});
});

describe("products.mutation actions", () => {
	it("forbids import and delete for non-admins", async () => {
		const service = createService();
		const ctx = { meta: { user: { type: "user" } }, params: {} };
		await expect(mutationMixin.actions.import.handler.call(service, ctx)).rejects.toMatchObject({ code: 403 });
		await expect(mutationMixin.actions.delete.handler.call(service, ctx)).rejects.toMatchObject({ code: 403 });
	});

	it("returns empty import/delete results for admins with no entities", async () => {
		const service = createService();
		const ctx = { meta: { user: { type: "admin" } }, params: {} };
		await expect(mutationMixin.actions.import.handler.call(service, ctx)).resolves.toEqual([]);
		await expect(mutationMixin.actions.delete.handler.call(service, ctx)).resolves.toEqual([]);
	});
});
