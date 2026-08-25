"use strict";

const jwt = require("jsonwebtoken");
const orderHelpers = require("../../../services/orders/methods/helpers.methods");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const SettingsMixin = require("../../../mixins/settings.mixin");
const PaymentModel = require("../../../services/orders/models/payment.model");
const Metadata = require("../../../services/orders/models/metadata.model");

function createService() {
	return {
		logger: { info() {}, warn() {}, error() {} },
		settings: { JWT_SECRET: process.env.JWT_SECRET },
		getProductTaxData: HelpersMixin.methods.getProductTaxData,
		sanitizeForMongoUpdate: (value) => value,
		...orderHelpers.methods,
	};
}

describe("order helpers", () => {
	const service = createService();

	it("writes a guest checkout JWT cookie", () => {
		const ctx = { meta: { cookies: {} } };
		service.generateJWT({ id: "ord-1", email: "guest@example.com" }, ctx);
		expect(ctx.meta.makeCookies.order_no_verif.value).toEqual(expect.any(String));
		const decoded = jwt.verify(ctx.meta.makeCookies.order_no_verif.value, process.env.JWT_SECRET);
		expect(decoded.email).toBe("guest@example.com");
	});

	it("prepares invoice template data and update payloads", () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			taxData: { global: { taxDecimal: 0.2, taxType: "VAT" } },
		});
		const data = service.prepareDataForTemplate({
			order: {
				lang: { code: "en" },
				items: [{ name: { en: "Shirt" }, price: 100, amount: 2, tax: 0.2 }],
				dates: { dateCreated: new Date("2024-01-01T00:00:00.000Z") },
				data: {
					paymentData: { name: { en: "Card" } },
					deliveryData: {
						codename: {
							physical: { value: "post", price: 4 },
						},
					},
				},
				settings: {
					deliveryMethods: [{ codename: "post", name: { en: "Post" } }],
				},
			},
		});
		expect(data.order.data.paymentData.nameReady).toBe("Card");
		expect(data.order.data.deliveryDataReady[0].name).toBe("Post");
		expect(data.order.items[0].nameReady).toBe("Shirt");
		SettingsMixin.getSiteSettings.mockRestore();

		expect(service.prepareForUpdate({ _id: "x", status: "cart" })).toEqual({
			$set: { status: "cart" },
		});
	});

	it("builds order typology from items", () => {
		expect(service.getOrderTypology({
			items: [
				{ type: "product", subtype: "physical" },
				{ type: "product", subtype: "digital" },
				{ type: "subscription", subtype: "month" },
			],
		})).toEqual({
			types: ["product", "subscription"],
			subtypes: ["physical", "digital", "month"],
		});
	});
});

describe("order models", () => {
	it("round-trips payment JSON and metadata", () => {
		const payment = PaymentModel.fromJSON({
			id: "pi_1",
			amount: 12.5,
			currency: "eur",
			status: "succeeded",
			paymentMethod: "card",
			metadata: { orderId: "o1" },
			originalData: { type: "payment_intent.succeeded" },
			createdAt: 1,
		});
		expect(payment.toJSON().id).toBe("pi_1");
		expect(new Metadata({ type: "order", orderId: "o1", subscriptionId: null, productId: "p1" }).orderId).toBe("o1");
	});
});
