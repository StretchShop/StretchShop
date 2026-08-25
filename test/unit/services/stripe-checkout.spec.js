"use strict";

jest.mock("stripe", () => {
	const paymentIntentsCreate = jest.fn().mockResolvedValue({ id: "pi_test", client_secret: "cs_test" });
	const paymentIntentsRetrieve = jest.fn().mockResolvedValue({ id: "pi_old", client_secret: "cs_old" });
	const Stripe = jest.fn(() => ({
		paymentIntents: { create: paymentIntentsCreate, retrieve: paymentIntentsRetrieve },
		webhooks: { constructEvent: jest.fn() },
	}));
	Stripe.__paymentIntentsCreate = paymentIntentsCreate;
	Stripe.__paymentIntentsRetrieve = paymentIntentsRetrieve;
	return Stripe;
});

const Stripe = require("stripe");
const checkoutMixin = require("../../../services/orders/mixins/payments.stripe.checkout.mixin");

describe("stripe checkout payment intent", () => {
	const originalSite = process.env.SITE_NAME;

	beforeAll(() => {
		process.env.SITE_NAME = "StretchShop";
	});

	afterAll(() => {
		if (originalSite === undefined) {
			delete process.env.SITE_NAME;
		} else {
			process.env.SITE_NAME = originalSite;
		}
	});

	it("creates a payment intent and updates the order", async () => {
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
		};
		const ctx = {
			meta: { siteSettings: { url: "https://shop.example.com" } },
			params: {
				order: {
					_id: "ord-1",
					lang: { code: "en" },
					items: [{
						type: "product",
						name: { en: "Shirt" },
						orderCode: "S-1",
						price: 20,
						amount: 1,
					}],
					prices: {
						currency: { code: "EUR" },
						pricePayment: 1,
						priceDelivery: 4,
						priceTotal: 25,
					},
					data: {
						paymentData: {
							codename: "online_stripe_card",
							name: { en: "Card" },
						},
						deliveryData: {
							codename: { physical: { value: "post" } },
						},
					},
				},
			},
			call: jest.fn().mockResolvedValue({ _id: "ord-1" }),
		};

		const result = await checkoutMixin.actions.stripeOrderPaymentintent.handler.call(service, ctx);
		expect(Stripe.__paymentIntentsCreate).toHaveBeenCalled();
		expect(ctx.call).toHaveBeenCalledWith("orders.updateOrder", expect.objectContaining({
			order: expect.objectContaining({
				data: expect.objectContaining({
					paymentData: expect.objectContaining({ paymentRequestId: "pi_test" }),
				}),
			}),
		}));
		expect(result).toEqual(expect.objectContaining({ clientSecret: "cs_test", existing: false }));
	});

	it("retrieves an existing payment intent", async () => {
		const service = { logger: { info() {}, warn() {}, error() {} }, Promise };
		const result = await checkoutMixin.actions.stripeOrderPaymentintent.handler.call(service, {
			meta: { siteSettings: { url: "https://shop.example.com" } },
			params: {
				order: {
					_id: "ord-1",
					data: { paymentData: { paymentRequestId: "pi_old", supplier: { id: "pi_old" } } },
				},
			},
			call: jest.fn(),
		});
		expect(Stripe.__paymentIntentsRetrieve).toHaveBeenCalledWith("pi_old");
		expect(result.existing).toBe(true);
	});
});
