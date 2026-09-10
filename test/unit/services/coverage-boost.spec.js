"use strict";

const profileMixin = require("../../../services/users/methods/profile.methods");
const mutationMixin = require("../../../services/products/mixins/products.actions.mutation.mixin");
const lifecycle = require("../../../services/orders/mixins/order-actions.lifecycle.mixin");
const setupMethods = require("../../../services/orders/mixins/payments.stripe.subscription.setup.methods");
const stripeHelpers = require("../../../services/orders/mixins/payments.stripe.helpers.mixin");
const suspendMixin = require("../../../services/subscriptions/mixins/subscriptions.actions.suspend.mixin");
const paymentMethods = require("../../../services/orders/methods/order-payment.methods");
const HelpersMixin = require("../../../mixins/helpers.mixin");

describe("users.updateUser", () => {
	it("updates allowlisted fields for a regular user", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			userCanUpdate: () => true,
			prepareForUpdate: (object) => {
				const copy = { ...object };
				delete copy._id;
				return { $set: copy };
			},
			transformDocuments: jest.fn((ctx, params, doc) => Promise.resolve(doc)),
			transformEntity: jest.fn((user) => Promise.resolve({ user })),
			entityChanged: jest.fn().mockResolvedValue(true),
			adapter: {
				findOne: jest.fn().mockResolvedValue(null),
				findById: jest.fn().mockResolvedValue({ _id: "u1", username: "jane", bio: "" }),
				updateById: jest.fn().mockResolvedValue({ _id: "u1", username: "jane", type: "user", bio: "hi" }),
				collection: { distinct: jest.fn().mockResolvedValue(["user"]) },
			},
		};
		const result = await profileMixin.actions.updateUser.handler.call(service, {
			params: { user: { bio: "hi", type: "admin" } },
			meta: { user: { _id: "u1", type: "user" } },
		});
		expect(result.user.bio).toBe("hi");
		expect(service.adapter.updateById).toHaveBeenCalled();
	});
});

describe("products mutation import/delete", () => {
	it("imports products for admins", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			importProductAction: jest.fn().mockResolvedValue({ slug: "gadget" }),
			adapter: { findById: jest.fn().mockResolvedValue(null) },
		};
		const result = await mutationMixin.actions.import.handler.call(service, {
			meta: { user: { type: "admin" } },
			params: { products: [{ id: "p1" }] },
		});
		expect(result[0].slug).toBe("gadget");
	});

	it("deletes products for admins", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			stringChunk: HelpersMixin.methods.stringChunk,
			getRequestData: jest.fn().mockReturnValue("/p"),
			settings: { paths: { assets: "/tmp" } },
			adapter: { findById: jest.fn().mockResolvedValue({ _id: "p1", orderCode: "ABC" }) },
		};
		const ctx = {
			meta: { user: { type: "admin" }, afterCallAction: null },
			params: { products: [{ id: "p1" }] },
			call: jest.fn().mockResolvedValue(1),
		};
		const result = await mutationMixin.actions.delete.handler.call(service, ctx);
		expect(result).toHaveLength(1);
	});
});

describe("order lifecycle extras", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		fixStringToId: (id) => id,
		transformDocuments: jest.fn((ctx, params, doc) => doc),
		entityChanged: jest.fn().mockResolvedValue(true),
		getOrderPaymentStatus: paymentMethods.methods.getOrderPaymentStatus,
		adapter: {
			findById: jest.fn(),
			updateById: jest.fn().mockResolvedValue({ _id: "ord-1", status: "canceled" }),
			find: jest.fn().mockResolvedValue([{ _id: "ord-1", status: "paid" }]),
			count: jest.fn().mockResolvedValue(1),
		},
	};

	it("cancels an owned order", async () => {
		service.adapter.findById.mockResolvedValue({
			_id: "ord-1",
			user: { id: "u1" },
			dates: {},
			data: {},
		});
		const result = await lifecycle.actions.cancel.handler.call(service, {
			params: { orderId: "ord-1" },
			meta: { user: { _id: "u1", type: "user" } },
		});
		expect(result.success).toBe(true);
	});

	it("lists orders for a logged-in user", async () => {
		const ctx = {
			params: { query: { status: "paid" }, limit: 10 },
			meta: { user: { _id: "u1", type: "user" } },
			call: jest.fn((action) => {
				if (action === "orders.find") {
					return Promise.resolve([{ _id: "ord-1", status: "paid" }]);
				}
				if (action === "orders.count") {
					return Promise.resolve(1);
				}
				return Promise.resolve([]);
			}),
		};
		const result = await lifecycle.actions.listOrders.handler.call(service, ctx);
		expect(result.total).toBe(1);
		expect(result.results).toHaveLength(1);
	});
});

describe("stripe setup helpers and subscription suspend action", () => {
	it("returns an existing stripe product", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			getOrderLang: stripeHelpers.methods.getOrderLang,
			stripeCreateProduct: jest.fn(),
			...setupMethods.methods,
		};
		const related = {
			order: { lang: { code: "en" } },
			product: { data: { stripe: { productId: "prod_1" } } },
		};
		const product = await service.checkProduct({}, related);
		expect(product.data.stripe.productId).toBe("prod_1");
	});

	it("suspends a subscription that already has a stripe id", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			fixStringToId: (id) => id,
			idToString: (id) => String(id),
			newHistoryRecord: (action) => ({ action }),
			isUserInitiatedSubscriptionCancel: () => true,
			notifyUserSubscriptionCancelled: jest.fn().mockResolvedValue(true),
			suspendSubscription: jest.fn().mockResolvedValue({
				success: true,
				message: "suspend sent",
				data: { subscription: { _id: "s1" } },
			}),
		};
		const ctx = {
			params: { subscriptionId: "s1", altUser: "user", altMessage: "bye" },
			meta: { user: { _id: "u1", type: "user" } },
			call: jest.fn().mockResolvedValue([{
				_id: "s1",
				dates: {},
				history: [],
				data: { stripe: { id: "sub_1" }, agreementId: null },
				user: { id: "u1" },
			}]),
		};
		const result = await suspendMixin.actions.suspend.handler.call(service, ctx);
		expect(result.success).toBe(true);
		expect(service.notifyUserSubscriptionCancelled).toHaveBeenCalled();
	});
});

describe("pages getProductsById", () => {
	it("returns empty product boxes when nothing matches", async () => {
		const pageCore = require("../../../services/pages/methods/core.methods");
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			priceByUser: (product) => product,
			...pageCore.methods,
		};
		const result = await service.getProductsById({
			meta: { user: { type: "user" } },
			call: jest.fn().mockResolvedValue([]),
		}, ["MISSING"]);
		expect(result).toEqual({ name: "getProductsById", data: [], template: "ProductBox" });
	});
});

describe("service schemas and category detail", () => {
	it("exports pages and openapi service definitions", () => {
		const pages = require("../../../services/pages/pages.service");
		const openapi = require("../../../services/openapi/openapi.service");
		expect(pages.name).toBe("pages");
		expect(openapi.name).toBe("openapi");
		expect(typeof openapi.created).toBe("function");
		expect(typeof openapi.started).toBe("function");
		expect(typeof openapi.actions.ui.handler).toBe("function");
	});

	it("loads a category detail with products count and min/max price", async () => {
		const mixin = require("../../../services/categories/mixins/categories.actions.detail.mixin");
		const service = {
			Promise,
			extractParentCategoriesByArrayOrder: () => [],
			extractChildCategoriesByArrayOrder: () => [],
			getAllPathSlugs: () => ["electronics/phones"],
		};
		const ctx = {
			params: { categoryPath: "electronics" },
			call: jest.fn()
				.mockResolvedValueOnce([{
					slug: "electronics",
					pathSlug: "electronics",
					parentPath: [],
					type: "products",
				}])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce(3)
				.mockResolvedValueOnce([{ min: 1, max: 9, _id: "agg" }]),
		};
		const found = await mixin.actions.detail.handler.call(service, ctx);
		expect(found.count).toBe(3);
		expect(found.minMaxPrice).toEqual({ min: 1, max: 9 });
	});
});
