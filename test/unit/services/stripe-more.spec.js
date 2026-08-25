"use strict";

jest.mock("stripe", () => {
	const mock = {
		customers: { create: jest.fn().mockResolvedValue({ id: "cus_1", email: "j@e.c" }) },
		subscriptions: {
			create: jest.fn().mockResolvedValue({
				id: "sub_stripe",
				status: "incomplete",
				created: 1700000000,
				latest_invoice: { confirmation_secret: { client_secret: "cs_sub" } },
			}),
			cancel: jest.fn().mockResolvedValue({ id: "sub_stripe", status: "canceled" }),
			retrieve: jest.fn().mockResolvedValue({ id: "sub_stripe", status: "active" }),
			update: jest.fn().mockResolvedValue({ id: "sub_stripe", pause_collection: { behavior: "void" } }),
		},
		paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
		webhooks: { constructEvent: jest.fn() },
	};
	const Stripe = jest.fn(() => mock);
	Stripe.__mock = mock;
	return Stripe;
});

const Stripe = require("stripe");
const createMethods = require("../../../services/orders/mixins/payments.stripe.subscription.create.methods");
const setupMethods = require("../../../services/orders/mixins/payments.stripe.subscription.setup.methods");
const stripeHelpers = require("../../../services/orders/mixins/payments.stripe.helpers.mixin");
const checkoutMixin = require("../../../services/orders/mixins/payments.stripe.checkout.mixin");
const webhookMixin = require("../../../services/orders/mixins/payments.stripe.webhook.mixin");

function createService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		fixStringToId: (id) => id,
		getOrderLang: stripeHelpers.methods.getOrderLang,
		getStripePriceAmount: stripeHelpers.methods.getStripePriceAmount,
		getStripePriceAmountCode: stripeHelpers.methods.getStripePriceAmountCode,
		getStripeSubProdPriceIdByAmountCode: stripeHelpers.methods.getStripeSubProdPriceIdByAmountCode,
		getStripeSubscriptionClientSecret: stripeHelpers.methods.getStripeSubscriptionClientSecret,
		getStripeSubscriptionExpandFields: stripeHelpers.methods.getStripeSubscriptionExpandFields,
		...createMethods.methods,
		...setupMethods.methods,
		...extra,
	};
}

describe("stripe subscription create and setup", () => {
	beforeEach(() => {
		Stripe.__mock.customers.create.mockClear();
		Stripe.__mock.subscriptions.create.mockClear();
	});

	it("returns an existing stripe customer", async () => {
		const service = createService();
		const result = await service.checkCustomer({
			meta: {
				user: {
					email: "j@e.c",
					bio: "hi",
					data: { stripe: { id: "cus_existing" } },
					addresses: [{ type: "invoice", nameFirst: "Jane", nameLast: "Doe" }],
				},
			},
		}, { order: { lang: { code: "en" } } });
		expect(result.id).toBe("cus_existing");
		expect(Stripe.__mock.customers.create).not.toHaveBeenCalled();
	});

	it("creates a stripe customer when missing", async () => {
		const service = createService();
		const ctx = {
			meta: { user: { email: "j@e.c", bio: "hi", data: {} } },
			call: jest.fn().mockResolvedValue({ _id: "u1" }),
		};
		const customer = await service.stripeCreateCustomer(ctx, {
			customer: { email: "j@e.c", name: "Jane" },
		});
		expect(customer.id).toBe("cus_1");
		expect(ctx.call).toHaveBeenCalledWith("users.updateUser", expect.any(Object));
	});

	it("creates a stripe subscription and updates local records", async () => {
		const service = createService();
		const related = {
			customer: { id: "cus_1" },
			subscription: {
				_id: "sub-1",
				cycles: 12,
				dates: { dateEnd: new Date(Date.now() + 86400000 * 400) },
				data: { product: { price: 10, data: { subscription: { cyclesTrial: 0 } } } },
			},
			order: {
				_id: "ord-1",
				data: { subscription: { ids: [{ subscription: "sub-1" }] } },
			},
			product: { data: { stripe: { prices: { sp_1000: "price_1" } } } },
		};
		const ctx = {
			call: jest.fn((action) => {
				if (action === "subscriptions.save") {
					return Promise.resolve({ _id: "sub-1" });
				}
				if (action === "orders.updateOrder") {
					return Promise.resolve({ _id: "ord-1" });
				}
				return Promise.resolve({});
			}),
		};
		const result = await service.stripeCreateSubscription(ctx, related);
		expect(Stripe.__mock.subscriptions.create).toHaveBeenCalled();
		expect(result.clientSecret).toBe("cs_sub");
		expect(result.existing).toBe(false);
	});

	it("loads unpaid order subscriptions and products", async () => {
		const service = createService();
		const ctx = {
			call: jest.fn((action) => {
				if (action === "subscriptions.find") {
					return Promise.resolve([{ _id: "sub-1" }]);
				}
				if (action === "products.find") {
					return Promise.resolve([{ _id: "prod-1" }]);
				}
				return Promise.resolve([]);
			}),
		};
		const subs = await service.getOrderSubscriptions(ctx, {
			ids: true,
			order: { data: { subscription: { ids: [{ subscription: "sub-1", agreed: "" }] } } },
		});
		expect(subs).toEqual([{ _id: "sub-1" }]);
		const products = await service.getOrderSubscriptionProducts(ctx, {
			orderPaymentStatus: { subscriptions: { next: { use: { product: "prod-1" } } } },
		});
		expect(products).toEqual([{ _id: "prod-1" }]);
	});

	it("agrees a stripe subscription on the order", async () => {
		const service = createService();
		const ctx = {
			call: jest.fn((action) => {
				if (action === "subscriptions.find") {
					return Promise.resolve([{ _id: "sub-1", dates: {}, data: {} }]);
				}
				if (action === "orders.updateOrder") {
					return Promise.resolve({ _id: "ord-1" });
				}
				if (action === "subscriptions.save") {
					return Promise.resolve({ _id: "sub-1", status: "agreed" });
				}
				return Promise.resolve({});
			}),
		};
		const result = await service.agreeOrderSubscription(ctx, "sub_stripe", {
			data: { subscription: { ids: [{ subscription: "sub-1" }] } },
		});
		expect(result.message).toBe("agreed");
	});
});

describe("stripe checkout suspend/pause and webhook extras", () => {
	it("cancels and pauses stripe billing agreements", async () => {
		const service = { logger: { info() {}, warn() {}, error() {} }, Promise };
		const canceled = await checkoutMixin.actions.stripeSuspendBillingAgreement.handler.call(service, {
			params: { billingRelatedId: "sub_stripe" },
		});
		expect(canceled.status).toBe("canceled");

		const paused = await checkoutMixin.actions.stripePauseBillingAgreement.handler.call(service, {
			params: { billingRelatedId: "sub_stripe" },
		});
		expect(paused.id).toBe("sub_stripe");
	});

	it("notifies an existing order payment status", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			getOrderPaymentStatus: jest.fn().mockReturnValue({ order: { status: "prepared" } }),
			adapter: { findById: jest.fn().mockResolvedValue({ _id: "ord-1" }) },
		};
		const result = await checkoutMixin.actions.stripeOrderNotification.handler.call(service, {
			params: { orderId: "ord-1", data: { lastPrepared: "products" } },
		});
		expect(result.success).toBe(true);
	});

	it("handles invoice.payment_succeeded webhook events for subscriptions", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			fixStringToId: (id) => id,
			orderPaymentReceived: jest.fn().mockResolvedValue({ paid: true }),
			subscriptionPaymentReceived: jest.fn().mockResolvedValue({ paid: true }),
			handleStripeWebhookEvent: webhookMixin.methods.handleStripeWebhookEvent,
		};
		const ctx = {
			call: jest.fn().mockResolvedValue([{
				_id: "sub-1",
				history: [],
				data: { order: { data: { paymentData: { lastResponseResult: [] } } } },
			}]),
		};
		service.handleStripeWebhookEvent(
			ctx,
			{ type: "invoice.payment_succeeded", data: { object: { id: "in_1" } } },
			{ _id: "ord-1" },
			{ metadata: { subscriptionId: "sub-1" } }
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(ctx.call).toHaveBeenCalledWith("subscriptions.find", expect.objectContaining({
			query: { _id: "sub-1" },
		}));
	});
});
