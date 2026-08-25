"use strict";

const pricingMethods = require("../../../services/orders/methods/order-pricing.methods");
const flowMethods = require("../../../services/orders/methods/order-flow.methods");
const helpersMixin = require("../../../mixins/helpers.mixin");

function createPricingContext() {
	return {
		logger: {
			warn() {},
			error() {},
			info() {},
		},
		settings: {
			defaultConstants: { tax: 0.2 },
		},
		roundNumber: helpersMixin.methods.roundNumber,
		formatPrice: helpersMixin.methods.formatPrice,
	};
}

describe("orders.countOrderPrices", () => {
	it("preserves payment and delivery fees when recounting all prices", () => {
		const ctx = createPricingContext();
		const order = {
			items: [
				{ type: "product", subtype: "physical", price: 10, amount: 1, taxData: { priceWithTax: 10, priceWithoutTax: 8.26, tax: 1.74 } },
			],
			prices: {
				pricePayment: 2,
				pricePaymentTaxData: { priceWithTax: 2, priceWithoutTax: 1.65, tax: 0.35 },
				priceDelivery: 5,
				priceDeliveryTaxData: { priceWithTax: 5, priceWithoutTax: 4.13, tax: 0.87 },
			},
		};

		const result = pricingMethods.methods.countOrderPrices.call(ctx, "all", null, order);

		expect(result.prices.pricePayment).toBe(2);
		expect(result.prices.priceDelivery).toBe(5);
		expect(result.prices.pricePaymentTaxData.priceWithTax).toBe(2);
		expect(result.prices.priceItems).toBe(10);
		expect(result.prices.priceTotal).toBe(17);
	});
});

describe("orders.orderAfterAcceptedActions", () => {
	it("does not send a second confirmation email when dates.emailSent is set", async () => {
		const sendOrderedEmail = jest.fn();
		const cartDelete = jest.fn();
		const service = {
			logger: { info() {}, error() {} },
			sendOrderedEmail,
			orderAfterAcceptedActions: flowMethods.methods.orderAfterAcceptedActions,
		};

		const result = await service.orderAfterAcceptedActions(
			{ call: cartDelete },
			{ _id: "order1", dates: { emailSent: new Date() } }
		);

		expect(result).toBe(true);
		expect(cartDelete).not.toHaveBeenCalled();
		expect(sendOrderedEmail).not.toHaveBeenCalled();
	});
});
