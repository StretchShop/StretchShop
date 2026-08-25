"use strict";

jest.mock("stripe", () => {
	const constructEvent = jest.fn();
	const Stripe = jest.fn(() => ({
		webhooks: { constructEvent },
	}));
	Stripe.__constructEvent = constructEvent;
	return Stripe;
});

const Stripe = require("stripe");
const { MoleculerClientError } = require("moleculer").Errors;
const webhookMixin = require("../../../services/orders/mixins/payments.stripe.webhook.mixin");

function createService() {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		fixStringToId: (id) => id,
		orderPaymentReceived: jest.fn().mockResolvedValue({ paid: true }),
		handleStripeWebhookEvent: webhookMixin.methods.handleStripeWebhookEvent,
	};
}

describe("stripe webhook", () => {
	beforeEach(() => {
		Stripe.__constructEvent.mockReset();
	});

	it("rejects invalid signatures", async () => {
		Stripe.__constructEvent.mockImplementation(() => {
			throw new Error("bad sig");
		});
		const service = createService();
		await expect(webhookMixin.actions.stripeWebhook.handler.call(service, {
			params: { data: { raw: true } },
			meta: { headers: { "stripe-signature": "sig" } },
		})).rejects.toBeInstanceOf(MoleculerClientError);
	});

	it("looks up the order and dispatches payment_intent.succeeded", async () => {
		Stripe.__constructEvent.mockReturnValue({
			type: "payment_intent.succeeded",
			data: {
				object: {
					id: "pi_1",
					amount_received: 2599,
					currency: "eur",
					status: "succeeded",
					metadata: { orderId: "ord-1", type: "products" },
				},
			},
		});
		const service = createService();
		const ctx = {
			params: { data: { payload: true } },
			meta: { headers: { "stripe-signature": "sig" } },
			call: jest.fn().mockResolvedValue([{ _id: "ord-1", status: "cart" }]),
		};

		const result = await webhookMixin.actions.stripeWebhook.handler.call(service, ctx);
		expect(ctx.call).toHaveBeenCalledWith("orders.find", expect.objectContaining({
			query: { _id: "ord-1" },
		}));
		expect(service.orderPaymentReceived).toHaveBeenCalledWith(
			ctx,
			expect.objectContaining({ _id: "ord-1", id: "ord-1" }),
			expect.objectContaining({ amount: 25.99, id: "pi_1" }),
			"stripe",
			"products"
		);
		expect(result).toEqual({ paid: true });
	});

	it("skips charge.succeeded when a payment_intent is present", async () => {
		const service = createService();
		const result = await service.handleStripeWebhookEvent(
			{},
			{ type: "charge.succeeded", data: { object: { payment_intent: "pi_1" } } },
			{ _id: "ord-1" },
			{}
		);
		expect(result).toBeUndefined();
		expect(service.orderPaymentReceived).not.toHaveBeenCalled();
	});
});
