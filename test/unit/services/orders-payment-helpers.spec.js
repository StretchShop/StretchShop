"use strict";

const paymentMethods = require("../../../services/orders/methods/order-payment.methods");
const stripeHelpers = require("../../../services/orders/mixins/payments.stripe.helpers.mixin");

function createService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		adapter: {
			updateById: jest.fn((id, update) => Promise.resolve({ _id: id, invoice: { id: "INV-1" }, ...update.$set })),
		},
		entityChanged: jest.fn(),
		prepareForUpdate: (order) => {
			const copy = JSON.parse(JSON.stringify(order));
			delete copy._id;
			return { $set: copy };
		},
		generateInvoice: jest.fn().mockResolvedValue({ html: "<p>inv</p>", path: "/inv.pdf" }),
		updateOrderPaymentState: paymentMethods.methods.updateOrderPaymentState,
		getOrderPaymentStatus: paymentMethods.methods.getOrderPaymentStatus,
		updatePaidOrderData: paymentMethods.methods.updatePaidOrderData,
		getPaymentResultDedupeKey: paymentMethods.methods.getPaymentResultDedupeKey,
		extractPaymentAmount: paymentMethods.methods.extractPaymentAmount,
		calculatePaidAmountTotal: paymentMethods.methods.calculatePaidAmountTotal,
		updateOrderStatePaidStripe: jest.fn(),
		...paymentMethods.methods,
		...extra,
	};
}

describe("order payment helpers", () => {
	const service = createService();

	it("dedupes payment results and totals succeeded amounts", () => {
		expect(service.getPaymentResultDedupeKey({ payment_intent: "pi_1" })).toBe("pi_1");
		expect(service.extractPaymentAmount({ status: "succeeded", amount_received: 2599 })).toBe(25.99);
		expect(service.extractPaymentAmount({ status: "failed", amount: 10 })).toBe(0);
		expect(service.calculatePaidAmountTotal({
			lastResponseResult: [
				{ id: "pi_1", status: "succeeded", amount: 10 },
				{ id: "pi_1", status: "succeeded", amount: 10 },
				{ status: "succeeded", amount: 5 },
			],
		})).toBe(15);
	});

	it("updates paid order data and payment status", () => {
		const order = service.updatePaidOrderData({
			dates: {},
			status: "cart",
			prices: { priceTotal: 30, priceTotalToPay: 30 },
			data: { paymentData: {} },
			items: [{ type: "product" }],
		}, { id: "pi_1", status: "succeeded", amount: 30 });
		expect(order.status).toBe("paid");
		expect(order.data.paymentData.paidAmountTotal).toBe(30);

		const status = service.getOrderPaymentStatus({
			items: [{ type: "product" }, { type: "subscription" }],
			data: {
				paymentData: { paymentRequestId: "pi_1", supplier: { status: "paid", paid: true } },
				subscription: { ids: [{ subscription: "sub-1", status: "active" }] },
			},
		});
		expect(status.order).toBeDefined();
		expect(status.products.count).toBe(1);
	});

	it("updates stripe payment state when amounts match", () => {
		const order = {
			items: [{ _id: "p1", type: "product", price: 25.99 }],
			data: {},
		};
		service.updateOrderPaymentState({}, order, { amount: 25.99, metadata: {} }, "stripe", "products");
		expect(service.updateOrderStatePaidStripe).toHaveBeenCalled();
	});

	it("skips invoice generation when already emailed", async () => {
		const result = await service.orderPaymentReceived({}, {
			_id: "ord-1",
			dates: { emailPaidSent: new Date() },
			invoice: { id: "INV-1" },
		}, {}, "stripe", "products");
		expect(result).toEqual({ id: "INV-1" });
		expect(service.generateInvoice).not.toHaveBeenCalled();
	});
});

describe("stripe helper methods", () => {
	it("reads order language and paid totals", () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			getOrderLang: stripeHelpers.methods.getOrderLang,
			getPaidTotalStripe: stripeHelpers.methods.getPaidTotalStripe,
		};
		expect(service.getOrderLang({ lang: { code: "sk" } })).toBe("en");
		const paymentData = { paidAmountTotal: 0, lastResponseResult: [
			{ status: "paid", amount_paid: 1000 },
			{ status: "succeeded", amount_received: 2500 },
			{ status: "succeeded", amount: 3 },
		] };
		service.getPaidTotalStripe(paymentData);
		expect(paymentData.paidAmountTotal).toBe(38);
	});
});
