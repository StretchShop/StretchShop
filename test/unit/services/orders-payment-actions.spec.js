"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const jwt = require("jsonwebtoken");
const paymentMixin = require("../../../services/orders/mixins/order-actions.payment.mixin");
const fulfillmentMixin = require("../../../services/orders/mixins/order-actions.fulfillment.mixin");
const SettingsMixin = require("../../../mixins/settings.mixin");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const paymentMethods = require("../../../services/orders/methods/order-payment.methods");

function createPaymentService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		settings: { JWT_SECRET: process.env.JWT_SECRET, order: { availablePaymentActions: ["stripeResult"] } },
		getOrderPaymentStatus: paymentMethods.methods.getOrderPaymentStatus,
		adapter: {
			findById: jest.fn(),
		},
		...extra,
	};
}

describe("orders.payment action", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("rejects missing orders and unauthorized users", async () => {
		jest.spyOn(SettingsMixin, "getOriginalSiteSettings").mockReturnValue({
			availablePaymentActions: ["stripeOrderPaymentintent"],
		});
		const service = createPaymentService();
		service.adapter.findById.mockResolvedValue(null);
		await expect(paymentMixin.actions.payment.handler.call(service, {
			params: { supplier: "stripe", action: "prepare", orderId: "ord-1" },
			meta: { user: { _id: "u1", type: "user" } },
		})).rejects.toMatchObject({ code: 404 });

		service.adapter.findById.mockResolvedValue({ _id: "ord-1", user: { id: "other" } });
		await expect(paymentMixin.actions.payment.handler.call(service, {
			params: { supplier: "stripe", action: "prepare", orderId: "ord-1" },
			meta: { user: { _id: "u1", type: "user" } },
		})).rejects.toMatchObject({ code: 403 });
	});

	it("allows guest JWT owners and already prepared orders", async () => {
		jest.spyOn(SettingsMixin, "getOriginalSiteSettings").mockReturnValue({
			availablePaymentActions: ["stripeOrderPaymentintent"],
		});
		const token = jwt.sign({ id: "guest-1", email: "g@e.c" }, process.env.JWT_SECRET, { algorithm: "HS256" });
		const order = {
			_id: "ord-1",
			user: { id: "guest-1", email: "g@e.c" },
			items: [{ type: "product" }],
			data: {
				paymentData: { paymentRequestId: "pi_1", supplier: { status: "prepared", paid: false } },
				subscription: { ids: [] },
			},
		};
		const service = createPaymentService({
			getOrderPaymentStatus: jest.fn().mockReturnValue({
				order: { status: "prepared" },
				products: { count: 1, status: "prepared" },
				subscriptions: { status: null },
			}),
		});
		service.adapter.findById.mockResolvedValue(order);
		const result = await paymentMixin.actions.payment.handler.call(service, {
			params: { supplier: "stripe", action: "prepare", orderId: "ord-1" },
			meta: { user: { type: "user" }, cookies: { order_no_verif: token } },
			call: jest.fn(),
		});
		expect(result.message).toBe("order_already_prepared");
	});

	it("calls stripeOrderPaymentintent for unpaid products", async () => {
		jest.spyOn(SettingsMixin, "getOriginalSiteSettings").mockReturnValue({
			availablePaymentActions: ["stripeOrderPaymentintent"],
		});
		const order = {
			_id: "ord-1",
			user: { id: "u1" },
			items: [{ type: "product" }],
			data: { paymentData: {}, subscription: { ids: [] } },
		};
		const service = createPaymentService();
		service.adapter.findById.mockResolvedValue(order);
		const ctx = {
			params: { supplier: "stripe", action: "prepare", orderId: "ord-1" },
			meta: { user: { _id: "u1", type: "user" } },
			call: jest.fn().mockResolvedValue({ clientSecret: "cs" }),
		};
		const result = await paymentMixin.actions.payment.handler.call(service, ctx);
		expect(ctx.call).toHaveBeenCalledWith("orders.stripeOrderPaymentintent", expect.objectContaining({ order }));
		expect(result.clientSecret).toBe("cs");
	});

	it("forbids admin payment results for non-admins and calls stripeResult", async () => {
		const service = createPaymentService();
		await expect(paymentMixin.actions.paymentResult.handler.call(service, {
			params: { supplier: "stripe", result: "adminPaid" },
			meta: { user: { type: "user" } },
		})).rejects.toMatchObject({ code: 403 });

		const ctx = {
			params: { supplier: "stripe", result: "paid", PayerID: "p1", paymentId: "pay-1", token: "tok" },
			meta: { user: { type: "admin" } },
			call: jest.fn().mockResolvedValue({ ok: true }),
		};
		await expect(paymentMixin.actions.paymentResult.handler.call(service, ctx)).resolves.toEqual({ ok: true });
	});

	it("suspends a billing agreement", async () => {
		const service = createPaymentService();
		const ctx = {
			params: { supplier: "stripe", relatedId: "sub_1", subscription: { _id: "sub-1" } },
			call: jest.fn().mockResolvedValue({ id: "sub_1", status: "canceled" }),
		};
		const result = await paymentMixin.actions.paymentSuspend.handler.call(service, ctx);
		expect(ctx.call).toHaveBeenCalledWith("orders.stripeSuspendBillingAgreement", {
			billingRelatedId: "sub_1",
		});
		expect(result.id).toBe("sub_1");
	});

	it("pauses and reactivates billing agreements", async () => {
		const service = createPaymentService();
		const ctx = {
			params: { supplier: "stripe", relatedId: "sub_1", subscription: { _id: "sub-1" } },
			call: jest.fn()
				.mockResolvedValueOnce({ id: "sub_1", pause_collection: { behavior: "void" } })
				.mockResolvedValueOnce({ subscription: { id: "sub_1" }, resumed: true }),
		};
		await expect(paymentMixin.actions.paymentPause.handler.call(service, ctx)).resolves.toMatchObject({ id: "sub_1" });
		await expect(paymentMixin.actions.paymentReactivate.handler.call(service, ctx)).resolves.toMatchObject({ resumed: true });
	});
});

describe("orders fulfillment actions", () => {
	it("rejects invalid invoice downloads and non-admins paying", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			requireAdmin: HelpersMixin.methods.requireAdmin,
			adapter: { findById: jest.fn() },
		};
		await expect(fulfillmentMixin.actions.invoiceDownload.handler.call(service, {
			params: { invoice: "bad" },
			meta: { user: { type: "user", _id: "u1" } },
		})).rejects.toMatchObject({ code: 400 });

		await expect(fulfillmentMixin.actions.paid.handler.call(service, {
			params: { orderId: "ord-1" },
			meta: { user: { type: "user" } },
		})).rejects.toMatchObject({ code: 403 });
	});

	it("marks an order paid as admin", async () => {
		const order = {
			_id: "ord-1",
			dates: {},
			prices: { priceTotal: 20 },
			data: { paymentData: {} },
		};
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			requireAdmin: HelpersMixin.methods.requireAdmin,
			orderPaymentReceived: jest.fn().mockResolvedValue({ paid: true }),
			afterPaidActions: jest.fn(),
			adapter: { findById: jest.fn().mockResolvedValue(order) },
		};
		const result = await fulfillmentMixin.actions.paid.handler.call(service, {
			params: { orderId: "ord-1" },
			meta: { user: { type: "admin", _id: "admin-1" } },
		});
		expect(service.orderPaymentReceived).toHaveBeenCalled();
		expect(result).toEqual({ paid: true });
	});

	it("cleans stale cart orders", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			adapter: { find: jest.fn().mockResolvedValue([{ _id: "old-1" }]) },
		};
		const ctx = { call: jest.fn().mockResolvedValue({ _id: "old-1" }) };
		const result = await fulfillmentMixin.actions.cleanOrders.handler.call(service, ctx);
		expect(result[0]).toContain("Removed orders");
	});
});
