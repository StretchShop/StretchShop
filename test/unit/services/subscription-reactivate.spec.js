"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const suspendMethods = require("../../../services/subscriptions/methods/suspend.methods");
const billingMethods = require("../../../services/subscriptions/methods/subscription-billing.methods");
const stripeHelpers = require("../../../services/orders/mixins/payments.stripe.helpers.mixin");
const suspendMixin = require("../../../services/subscriptions/mixins/subscriptions.actions.suspend.mixin");

function createService(overrides) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		fixStringToId: (id) => id,
		idToString: (id) => String(id),
		newHistoryRecord: suspendMethods.methods.newHistoryRecord
			|| require("../../../services/subscriptions/methods/subscription-core.methods").methods.newHistoryRecord,
		getSubscriptionBillingRelatedId: suspendMethods.methods.getSubscriptionBillingRelatedId,
		findBillingRelatedIdInOriginOrder: suspendMethods.methods.findBillingRelatedIdInOriginOrder,
		resolveSubscriptionBillingRelatedId: suspendMethods.methods.resolveSubscriptionBillingRelatedId,
		getSubscriptionPaymentSupplier: suspendMethods.methods.getSubscriptionPaymentSupplier,
		notifyUserSubscriptionReactivated: suspendMethods.methods.notifyUserSubscriptionReactivated,
		reactivateSubscription: suspendMethods.methods.reactivateSubscription,
		sendSubscriptionEmail: billingMethods.methods.sendSubscriptionEmail,
		isUserInitiatedSubscriptionCancel: suspendMethods.methods.isUserInitiatedSubscriptionCancel,
		...overrides,
	};
}

describe("subscriptions.reactivate", () => {
	it("resolves Stripe id from agreement, stripe object, or origin order", async () => {
		const service = createService();
		expect(service.getSubscriptionBillingRelatedId({
			data: { agreementId: "sub_agree" },
		})).toBe("sub_agree");
		expect(service.getSubscriptionBillingRelatedId({
			data: { stripe: { id: "sub_stripe" } },
		})).toBe("sub_stripe");

		service.findBillingRelatedIdInOriginOrder = jest.fn().mockResolvedValue("sub_from_order");
		const fromOrder = await service.resolveSubscriptionBillingRelatedId.call(
			service,
			{},
			{ data: {}, orderOriginId: "ord-1" }
		);
		expect(fromOrder).toBe("sub_from_order");
	});

	it("calls orders.paymentReactivate and saves an active subscription", async () => {
		const saved = { _id: "local-1", status: "active", data: { product: { orderCode: "P1" } } };
		const service = createService({
			updateOriginOrderStripeSubscriptionId: jest.fn().mockResolvedValue(null),
			restoreSubscriptionContentDependencies: jest.fn().mockResolvedValue({ _id: "user-1" }),
			addToHistory: jest.fn(),
		});
		const ctx = {
			params: { altUser: "user", altMessage: "" },
			call: jest.fn((action) => {
				if (action === "orders.paymentReactivate") {
					return Promise.resolve({
						recreated: true,
						resumed: false,
						subscription: { id: "sub_new", status: "active" },
					});
				}
				if (action === "subscriptions.save") {
					return Promise.resolve(saved);
				}
				return Promise.resolve(null);
			}),
		};
		const subscription = {
			_id: "local-1",
			history: [],
			dates: {},
			data: { order: { data: { paymentData: { codename: "online_stripe" } } } },
		};

		const result = await service.reactivateSubscription.call(service, ctx, subscription, "sub_old");

		expect(ctx.call).toHaveBeenCalledWith("orders.paymentReactivate", expect.objectContaining({
			supplier: "stripe",
			relatedId: "sub_old",
		}));
		expect(result.success).toBe(true);
		expect(result.message).toBe("reactivate created");
		expect(service.restoreSubscriptionContentDependencies).toHaveBeenCalled();
	});

	it("calls orders.paymentPause and saves a paused subscription", async () => {
		const saved = { _id: "local-1", status: "paused", data: { product: { orderCode: "P1" } } };
		const service = createService({
			pauseSubscription: suspendMethods.methods.pauseSubscription,
			updateOriginOrderStripeSubscriptionId: jest.fn().mockResolvedValue(null),
			addToHistory: jest.fn(),
		});
		const ctx = {
			params: { altUser: "user", altMessage: "" },
			call: jest.fn((action) => {
				if (action === "orders.paymentPause") {
					return Promise.resolve({
						id: "sub_stripe",
						status: "active",
						pause_collection: { behavior: "void" },
					});
				}
				if (action === "subscriptions.save") {
					return Promise.resolve(saved);
				}
				return Promise.resolve(null);
			}),
		};
		const subscription = {
			_id: "local-1",
			history: [],
			dates: {},
			data: { order: { data: { paymentData: { codename: "online_stripe" } } } },
		};

		const result = await service.pauseSubscription.call(service, ctx, subscription, "sub_stripe");

		expect(ctx.call).toHaveBeenCalledWith("orders.paymentPause", expect.objectContaining({
			supplier: "stripe",
			relatedId: "sub_stripe",
		}));
		expect(result.success).toBe(true);
		expect(result.message).toBe("pause sent");
		expect(service.updateOriginOrderStripeSubscriptionId).toHaveBeenCalledWith(
			ctx, saved, "sub_stripe", "paused"
		);
	});

	it("sends subscription/paused mail", async () => {
		const service = createService({
			notifyUserSubscriptionPaused: suspendMethods.methods.notifyUserSubscriptionPaused,
		});
		const sendEmail = jest.fn().mockResolvedValue(true);
		const ctx = {
			meta: { siteSettings: { name: "Test Shop", supportEmail: "support@example.com" } },
			call: sendEmail,
		};
		await service.notifyUserSubscriptionPaused(ctx, {
			_id: "sub-1",
			data: { order: { user: { email: "buyer@example.com", username: "buyer" } } },
		});
		expect(sendEmail).toHaveBeenCalledWith("users.sendEmail", expect.objectContaining({
			template: "subscription/paused",
			settings: expect.objectContaining({
				subject: "Test Shop - Subscription paused",
			}),
		}));
	});

	it("sends subscription/reactivated mail", async () => {
		const service = createService();
		const sendEmail = jest.fn().mockResolvedValue(true);
		const ctx = {
			meta: { siteSettings: { name: "Test Shop", supportEmail: "support@example.com" } },
			call: sendEmail,
		};
		await service.notifyUserSubscriptionReactivated(ctx, {
			_id: "sub-1",
			data: { order: { user: { email: "buyer@example.com", username: "buyer" } } },
		});
		expect(sendEmail).toHaveBeenCalledWith("users.sendEmail", expect.objectContaining({
			template: "subscription/reactivated",
			settings: expect.objectContaining({
				subject: "Test Shop - Subscription reactivated",
			}),
		}));
	});

	it("rejects missing subscriptions from the pause action", async () => {
		const service = createService({ adapter: {} });
		service.logger = { info() {}, error() {} };
		const handler = suspendMixin.actions.pause.handler;
		const ctx = {
			meta: { user: { type: "admin", _id: "admin-1" } },
			params: { subscriptionId: "missing" },
			call: jest.fn().mockResolvedValue([]),
		};
		await expect(handler.call(service, ctx)).rejects.toBeInstanceOf(MoleculerClientError);
	});

	it("rejects missing subscriptions from the action", async () => {
		const service = createService({
			adapter: {},
		});
		service.logger = { info() {}, error() {} };
		const handler = suspendMixin.actions.reactivate.handler;
		const ctx = {
			meta: { user: { type: "admin", _id: "admin-1" } },
			params: { subscriptionId: "missing" },
			call: jest.fn().mockResolvedValue([]),
		};
		await expect(handler.call(service, ctx)).rejects.toBeInstanceOf(MoleculerClientError);
	});
});

describe("Stripe reactivate recreate params", () => {
	const helpers = {
		getStripeSubscriptionExpandFields: stripeHelpers.methods.getStripeSubscriptionExpandFields,
		getStripeCustomerId: stripeHelpers.methods.getStripeCustomerId,
		getStripeDefaultPaymentMethodId: stripeHelpers.methods.getStripeDefaultPaymentMethodId,
		buildStripeSubscriptionRecreateParams: stripeHelpers.methods.buildStripeSubscriptionRecreateParams,
	};

	it("copies customer, price, payment method and local metadata", () => {
		const params = helpers.buildStripeSubscriptionRecreateParams(
			{
				id: "sub_old",
				customer: { id: "cus_1", invoice_settings: {} },
				default_payment_method: "pm_1",
				items: { data: [{ price: { id: "price_1" } }] },
				metadata: {},
			},
			{
				_id: "local-1",
				orderOriginId: "ord-1",
				data: { product: { _id: "prod-1" } },
			}
		);

		expect(params.customer).toBe("cus_1");
		expect(params.items).toEqual([{ price: "price_1" }]);
		expect(params.default_payment_method).toBe("pm_1");
		expect(params.metadata).toMatchObject({
			subscriptionId: "local-1",
			orderId: "ord-1",
			productId: "prod-1",
			reactivatedFrom: "sub_old",
		});
	});

	it("falls back to incomplete payment when no card is on file", () => {
		const params = helpers.buildStripeSubscriptionRecreateParams(
			{
				id: "sub_old",
				customer: "cus_1",
				items: { data: [{ price: { id: "price_1" } }] },
			},
			{}
		);
		expect(params.payment_behavior).toBe("default_incomplete");
		expect(params.default_payment_method).toBeUndefined();
	});
});
