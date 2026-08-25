"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const queryMixin = require("../../../services/products/mixins/products.actions.query.mixin");
const helpers = require("../../../services/products/methods/helpers.methods");
const priceLevels = require("../../../mixins/price.levels.mixin");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const pageCore = require("../../../services/pages/methods/core.methods");
const adminMixin = require("../../../services/categories/mixins/categories.actions.admin.mixin");
const categoryHelpers = require("../../../services/categories/methods/helpers.methods");
const suspendMethods = require("../../../services/subscriptions/methods/suspend.methods");
const SettingsMixin = require("../../../mixins/settings.mixin");

function productService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		Promise,
		fixRequestIds: (filter) => filter,
		fixStringToId: (id) => id,
		filterOnlyActiveProducts: helpers.methods.filterOnlyActiveProducts,
		getFilterSort: (filter) => filter,
		priceByUser: priceLevels.methods.priceByUser,
		getProductTaxData: HelpersMixin.methods.getProductTaxData,
		detailActionAddBasicData: jest.fn((ctx, found) => Promise.resolve(found)),
		adapter: {
			find: jest.fn(),
			findById: jest.fn(),
			collection: {
				aggregate: jest.fn(() => ({
					toArray: jest.fn().mockResolvedValue([{ min: 1, max: 50 }]),
				})),
			},
		},
		...extra,
	};
}

describe("products query extras", () => {
	afterEach(() => jest.restoreAllMocks());

	it("finds with count, ids, detail, and min/max", async () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			taxData: { global: { taxDecimal: 0.2 } },
			priceLevels: { validTypes: { userTypes: [] } },
		});
		const service = productService();
		const ctx = {
			params: { query: { categories: { $in: ["electronics"] } }, limit: 200 },
			meta: { user: { type: "user" } },
			call: jest.fn((action) => {
				if (action === "products.find") {
					return Promise.resolve([{ price: 10 }]);
				}
				if (action === "products.getMinMaxPrice") {
					return Promise.resolve([{ min: 1, max: 40 }]);
				}
				if (action === "products.count") {
					return Promise.resolve(3);
				}
				return Promise.resolve([]);
			}),
		};
		const counted = await queryMixin.actions.findWithCount.handler.call(service, ctx);
		expect(counted.filteredProductsCount).toBe(3);
		expect(counted.filter.minMaxPrice.max).toBe(40);

		service.adapter.find.mockResolvedValue([{ price: 9 }]);
		const withId = await queryMixin.actions.findWithId.handler.call(service, {
			params: { query: { _id: "prod-1" } },
			meta: { user: { type: "user" } },
		});
		expect(withId).toHaveLength(1);

		service.adapter.findById.mockResolvedValue({ _id: "prod-1", slug: "phone" });
		const detail = await queryMixin.actions.detail.handler.call(service, {
			params: { product: "prod-1" },
			meta: { user: { type: "user" } },
		});
		expect(detail.slug).toBe("phone");

		const minMax = await queryMixin.actions.getMinMaxPrice.handler.call(service, {
			params: { categories: ["electronics"] },
		});
		expect(minMax[0].max).toBe(50);
	});
});

describe("pages wysiwyg detail processing", () => {
	it("injects WYSIWYG blocks and related metadata", async () => {
		const pageHelpers = require("../../../services/pages/methods/helpers.methods");
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			checkAndRunPageFunctions: jest.fn().mockReturnValue([]),
			pageGlobalResultHelper_ParentCat: pageHelpers.methods.pageGlobalResultHelper_ParentCat,
			adapter: {
				find: jest.fn().mockResolvedValue([{
					publisher: "ed@example.com",
					data: { blocks: [{ en: "<p>Hi</p>" }], pages: ["about", ":news", "https://x"], categories: ["docs"] },
				}]),
			},
			...pageCore.methods,
		};
		const result = await service.processPageWysiwygContent({
			params: { page: "about", lang: "en" },
			meta: { user: { type: "admin", email: "ed@example.com" } },
			call: jest.fn().mockResolvedValue({ slug: "docs" }),
		}, {
			body: "<html><!-- {{editor_WYSIWYG}} //--></html>",
			staticData: { categories: ["docs"], pages: ["home"] },
		});
		expect(result.body).toContain("Hi");
		expect(result.data.functions).toEqual([]);
	});
});

describe("categories admin import", () => {
	it("creates a missing category during import", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			fixEntityDates: categoryHelpers.methods.fixEntityDates,
			validateEntity: jest.fn((entity) => Promise.resolve(entity)),
			transformDocuments: jest.fn((ctx, params, doc) => doc),
			entityChanged: jest.fn().mockResolvedValue(true),
			getRequestData: jest.fn().mockReturnValue("/categories/news"),
			adapter: {
				findById: jest.fn().mockResolvedValue(null),
				insert: jest.fn((entity) => Promise.resolve({ _id: "c1", ...entity })),
				updateById: jest.fn(),
			},
		};
		const ctx = {
			meta: { user: { type: "admin", email: "ed@example.com" }, localsDefault: { lang: { code: "en" } } },
			params: {
				categories: [{
					id: "c1",
					name: { en: "News" },
					slug: "",
					parentPath: ["root"],
					parentPathSlug: "",
				}],
			},
			call: jest.fn().mockResolvedValue([]),
		};
		const result = await adminMixin.actions.import.handler.call(service, ctx);
		expect(result[0].slug).toBe("news");
		expect(ctx.meta.afterCallAction.name).toBe("category insert");
	});
});

describe("subscription suspend helpers", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		idToString: (id) => String(id),
		fixStringToId: (id) => id,
		sendSubscriptionEmail: jest.fn().mockResolvedValue(true),
		newHistoryRecord: (action) => ({ action }),
		removeSubscriptionContentDependencies: jest.fn().mockResolvedValue({}),
		...suspendMethods.methods,
	};

	it("resolves billing ids and notifies users", async () => {
		expect(service.isUserInitiatedSubscriptionCancel("user")).toBe(true);
		expect(service.getSubscriptionBillingRelatedId({ data: { stripe: { id: "sub_1" } } })).toBe("sub_1");
		expect(service.getSubscriptionPaymentSupplier({ data: { order: { data: { paymentData: { codename: "online_stripe" } } } } })).toBe("stripe");
		await service.notifyUserSubscriptionCancelled({ meta: { siteSettings: { name: "Shop" } } }, { _id: "s1" });
		await service.notifyUserSubscriptionPaused({ meta: {} }, { _id: "s1" });
		await service.notifyUserSubscriptionReactivated({ meta: {} }, { _id: "s1" });
		expect(service.sendSubscriptionEmail).toHaveBeenCalledTimes(3);

		const ctx = {
			call: jest.fn().mockResolvedValue([{
				data: { subscription: { ids: [{ subscription: "s1", supplier: { id: "sub_from_order" } }] } },
			}]),
		};
		await expect(service.findBillingRelatedIdInOriginOrder(ctx, {
			_id: "s1",
			orderOriginId: "ord-1",
		})).resolves.toBe("sub_from_order");
	});

	it("suspends a subscription after payment confirmation", async () => {
		const ctx = {
			params: { altUser: "user", altMessage: "bye" },
			call: jest.fn((action) => {
				if (action === "orders.paymentSuspend") {
					return Promise.resolve({ id: "sub_1" });
				}
				if (action === "subscriptions.save") {
					return Promise.resolve({ _id: "s1", history: [] });
				}
				return Promise.resolve({});
			}),
		};
		const result = await service.suspendSubscription(ctx, {
			_id: "s1",
			history: [],
			data: { order: { data: { paymentData: { codename: "online_stripe" } } } },
		}, "sub_1");
		expect(result.success).toBe(true);
		expect(service.removeSubscriptionContentDependencies).toHaveBeenCalled();
	});
});
