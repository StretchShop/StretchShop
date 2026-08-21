"use strict";

const paymentMethods = require("../../../services/orders/methods/order-payment.methods");
const stripeWebhook = require("../../../services/orders/mixins/payments.stripe.webhook.mixin");

function createPaymentContext() {
	return {
		logger: { info() {}, warn() {}, error() {} },
		getPaymentResultDedupeKey: paymentMethods.methods.getPaymentResultDedupeKey,
		extractPaymentAmount: paymentMethods.methods.extractPaymentAmount,
		calculatePaidAmountTotal: paymentMethods.methods.calculatePaidAmountTotal,
		updatePaidOrderData: paymentMethods.methods.updatePaidOrderData,
	};
}

describe("orders paid amount from Stripe", () => {
	it("uses the normalized Stripe webhook amount for succeeded payments", () => {
		const ctx = createPaymentContext();
		const order = {
			dates: {},
			status: "prepared",
			data: { paymentData: { lastResponseResult: [] } },
			prices: { priceTotal: 102 },
		};

		ctx.updatePaidOrderData(order, {
			id: "pi_123",
			amount: 102,
			status: "succeeded",
			currency: "eur",
		});

		expect(order.data.paymentData.paidAmountTotal).toBe(102);
		expect(order.prices.priceTotalToPay).toBe(0);
		expect(order.status).toBe("paid");
	});

	it("ignores PayPal approved transactions", () => {
		const ctx = createPaymentContext();
		const order = {
			dates: {},
			status: "prepared",
			data: { paymentData: { lastResponseResult: [] } },
			prices: { priceTotal: 50 },
		};

		ctx.updatePaidOrderData(order, {
			id: "PAY-1",
			state: "approved",
			transactions: [{ amount: { total: "50.00" } }],
		});

		expect(order.data.paymentData.paidAmountTotal).toBe(0);
		expect(order.prices.priceTotalToPay).toBe(50);
	});

	it("ignores Stripe invoice paid amounts that are not succeeded", () => {
		const ctx = createPaymentContext();
		expect(ctx.calculatePaidAmountTotal({
			lastResponseResult: [{ id: "in_123", status: "paid", amount_paid: 10200 }],
		})).toBe(0);
	});

	it("does not double-count charge and payment_intent for the same payment", () => {
		const ctx = createPaymentContext();
		const paymentData = {
			lastResponseResult: [
				{
					id: "ch_123",
					amount: 102,
					status: "succeeded",
					payment_intent: "pi_123",
				},
				{
					id: "pi_123",
					amount: 102,
					status: "succeeded",
				},
			],
		};

		expect(ctx.calculatePaidAmountTotal(paymentData)).toBe(102);
	});

	it("does not push the same Stripe payment id twice", () => {
		const ctx = createPaymentContext();
		const payment = { id: "pi_123", amount: 102, status: "succeeded" };
		const order = {
			dates: {},
			status: "paid",
			data: { paymentData: { lastResponseResult: [payment] } },
			prices: { priceTotal: 102 },
		};

		ctx.updatePaidOrderData(order, payment);

		expect(order.data.paymentData.lastResponseResult).toHaveLength(1);
		expect(order.data.paymentData.paidAmountTotal).toBe(102);
	});
});

describe("Stripe product webhook paid-email routing", () => {
	function createWebhookContext() {
		return {
			logger: { info() {}, warn() {}, error() {} },
			orderPaymentReceived: jest.fn().mockResolvedValue(true),
			handleStripeWebhookEvent: stripeWebhook.methods.handleStripeWebhookEvent,
		};
	}

	const order = { _id: "order1" };
	const paymentData = { id: "pi_123", amount: 102, status: "succeeded" };

	it("processes payment_intent.succeeded as a product payment", () => {
		const service = createWebhookContext();
		service.handleStripeWebhookEvent(
			{},
			{ type: "payment_intent.succeeded", data: { object: { id: "pi_123" } } },
			order,
			paymentData
		);

		expect(service.orderPaymentReceived).toHaveBeenCalledWith(
			{},
			order,
			paymentData,
			"stripe",
			"products"
		);
	});

	it("skips charge.succeeded when the charge already has a payment_intent", () => {
		const service = createWebhookContext();
		service.handleStripeWebhookEvent(
			{},
			{ type: "charge.succeeded", data: { object: { id: "ch_123", payment_intent: "pi_123" } } },
			order,
			paymentData
		);

		expect(service.orderPaymentReceived).not.toHaveBeenCalled();
	});

	it("processes charge.succeeded when there is no payment_intent", () => {
		const service = createWebhookContext();
		service.handleStripeWebhookEvent(
			{},
			{ type: "charge.succeeded", data: { object: { id: "ch_123" } } },
			order,
			paymentData
		);

		expect(service.orderPaymentReceived).toHaveBeenCalledTimes(1);
	});

	it("does not treat charge.updated as a new paid notification", () => {
		const service = createWebhookContext();
		service.handleStripeWebhookEvent(
			{},
			{ type: "charge.updated", data: { object: { id: "ch_123" } } },
			order,
			paymentData
		);

		expect(service.orderPaymentReceived).not.toHaveBeenCalled();
	});
});
