"use strict";

const { XMLParser } = require("fast-xml-parser");
const packeta = require("../../../services/orders/delivery/suppliers/packeta");
const { publicDeliveryMethod, applyOrderDestination } = require("../../../services/orders/delivery/registry");
const pricing = require("../../../services/orders/methods/order-pricing.methods");
const helpers = require("../../../services/orders/methods/helpers.methods");
const fulfillmentMethods = require("../../../services/orders/methods/order-fulfillment.methods");
const fulfillmentMixin = require("../../../services/orders/mixins/order-actions.fulfillment.mixin");
const HelpersMixin = require("../../../mixins/helpers.mixin");

const parser = new XMLParser({ ignoreAttributes: true });

const packetaMethod = {
	codename: "packeta",
	type: "physical",
	data: {
		destinationSelectionPlugin: true,
		widgetApiKey: "public-key",
		deliveryServiceApiKey: "do-not-leak",
		eshop: "demo-shop",
		defaultWeightKg: 1,
		trackingUrl: "https://tracking.packeta.com/{lang}/{trackingId}",
		widget: {
			language: "sk",
			view: "modal",
			vendors: [{ country: "sk" }],
		},
	},
	prices: [
		{ range: { from: 0, to: 500 }, price: 5, tax: 0.2 },
	],
};

const destination = {
	supplier: "packeta",
	externalId: "42",
	name: "Z-BOX",
	street: "Main 1",
	city: "Bratislava",
	zip: "81101",
	country: "sk",
};

function shipmentOrder(overrides = {}) {
	return {
		_id: "507f1f77bcf86cd799439011",
		lang: { code: "sk" },
		user: { email: "buyer@example.com" },
		addresses: {
			invoiceAddress: {
				nameFirst: "Jane",
				nameLast: "Doe",
				email: "buyer@example.com",
				phone: "+421900000000",
			},
		},
		prices: { priceTotal: 12.5, currency: { code: "eur" } },
		data: {
			paymentData: { codename: "online_stripe" },
			deliveryData: { destination },
		},
		...overrides,
	};
}

describe("packeta supplier", () => {
	const previousPassword = process.env.PACKETA_API_PASSWORD;
	const previousEshop = process.env.PACKETA_ESHOP;

	beforeEach(() => {
		process.env.PACKETA_API_PASSWORD = "secret";
		process.env.PACKETA_ESHOP = "";
	});

	afterAll(() => {
		if (previousPassword === undefined) {
			delete process.env.PACKETA_API_PASSWORD;
		} else {
			process.env.PACKETA_API_PASSWORD = previousPassword;
		}
		if (previousEshop === undefined) {
			delete process.env.PACKETA_ESHOP;
		} else {
			process.env.PACKETA_ESHOP = previousEshop;
		}
	});

	it("publishes the widget key and hides the API password", () => {
		const published = publicDeliveryMethod({
			...packetaMethod,
			data: { ...packetaMethod.data, apiPassword: "secret" },
		});
		expect(published.data.widgetApiKey).toBe("public-key");
		expect(published.data.destinationSelectionPlugin).toBe(true);
		expect(published.data.widget.vendors).toEqual([{ country: "sk" }]);
		expect(published.data.deliveryServiceApiKey).toBeUndefined();
		expect(published.data.apiPassword).toBeUndefined();
		expect(published.data.eshop).toBeUndefined();
	});

	it("builds createPacket XML from the order and pickup point", () => {
		const xml = packeta.buildCreatePacketXml(shipmentOrder(), packetaMethod, "secret");
		const parsed = parser.parse(xml).createPacket.packetAttributes;
		expect(String(parsed.addressId)).toBe("42");
		expect(parsed.name).toBe("Jane");
		expect(parsed.surname).toBe("Doe");
		expect(parsed.email).toBe("buyer@example.com");
		expect(parsed.currency).toBe("EUR");
		expect(parsed.eshop).toBe("demo-shop");
		expect(xml).toContain("<cod>0.00</cod>");
		expect(xml).toContain("<value>12.50</value>");
		expect(xml).toContain("<weight>1</weight>");
		expect(xml).toContain("<apiPassword>secret</apiPassword>");

		const codOrder = shipmentOrder();
		codOrder.data.paymentData.codename = "cod";
		const codXml = packeta.buildCreatePacketXml(codOrder, packetaMethod, "secret");
		expect(codXml).toContain("<cod>12.50</cod>");
	});

	it("maps createPacket and packetTracking XML, including delivered", () => {
		const created = packeta.parseCreatePacketResponse(`
			<response>
				<status>ok</status>
				<result>
					<id>123456789</id>
					<barcode>Z123456789</barcode>
					<barcodeText>Z 12345 67890</barcodeText>
				</result>
			</response>
		`);
		expect(created).toEqual({ packetId: "123456789", trackingId: "Z123456789" });

		expect(() => packeta.parseCreatePacketResponse(`
			<response>
				<status>fault</status>
				<fault>PacketAttributesFault</fault>
				<string>Failed to validate attributes.</string>
				<detail><attributes><fault><name>phone</name><fault>Phone is not valid.</fault></fault></attributes></detail>
			</response>
		`)).toThrow(/phone: Phone is not valid/);

		const expedition = packeta.parseTrackingResponse(`
			<response>
				<status>ok</status>
				<result>
					<record>
						<dateTime>2022-01-10T10:43:00</dateTime>
						<statusCode>5</statusCode>
						<codeText>ready for pickup</codeText>
						<statusText>Ready at the branch.</statusText>
					</record>
					<record>
						<dateTime>2022-01-10T15:34:06</dateTime>
						<statusCode>7</statusCode>
						<codeText>delivered</codeText>
						<statusText>The parcel was handed over.</statusText>
					</record>
				</result>
			</response>
		`, {
			trackingId: "Z123456789",
			packetId: "123456789",
			lang: "sk",
			trackingUrlTemplate: "https://tracking.packeta.com/{lang}/{trackingId}",
		});

		expect(expedition.status).toBe("delivered");
		expect(expedition.statusText).toBe("The parcel was handed over.");
		expect(expedition.trackingUrl).toBe("https://tracking.packeta.com/sk/Z123456789");
		expect(expedition.deliveredAt).toBe(new Date("2022-01-10T15:34:06").toISOString());
		expect(expedition.updatedAt).toBe(expedition.deliveredAt);
	});

	it("keeps the barcode when label download fails", async () => {
		const fetchImpl = jest.fn()
			.mockResolvedValueOnce({
				ok: true,
				text: async () => `
					<response><status>ok</status><result>
						<id>123456789</id><barcode>Z123456789</barcode>
					</result></response>
				`,
			})
			.mockResolvedValueOnce({
				ok: false,
				text: async () => "no label",
			});

		const shipment = await packeta.createShipment(shipmentOrder(), packetaMethod, { fetch: fetchImpl });
		expect(shipment.trackingId).toBe("Z123456789");
		expect(shipment.packetId).toBe("123456789");
		expect(shipment.labelPdf).toBeNull();
		expect(shipment.labelError).toBe("Packeta request failed");
		expect(shipment.trackingUrl).toBe("https://tracking.packeta.com/sk/Z123456789");
	});
});

describe("checkOrderData destination", () => {
	function serviceWith(orderTemp) {
		const orderErrors = { orderErrors: [] };
		const ctx = {};
		const service = {
			logger: { info() {}, warn() {}, error() {} },
			settings: {
				order: {
					deliveryMethods: [packetaMethod, { codename: "personally", type: "physical", prices: [{ range: { from: 0, to: 1000000 }, price: 0, tax: 0.2 }] }],
					paymentMethods: [{
						codename: "cod",
						name: { en: "Cash" },
						prices: [{ range: { from: 0, to: 1000000 }, price: 0, tax: 0.2 }],
					}],
				},
				defaultConstants: { tax: 0.2 },
			},
			getOrderWork() {
				return { orderTemp, orderErrors };
			},
			getOrderTypology: helpers.methods.getOrderTypology,
			getProductTaxData: HelpersMixin.methods.getProductTaxData,
			countOrderPrices: pricing.methods.countOrderPrices,
			formatPrice: HelpersMixin.methods.formatPrice,
			roundNumber: HelpersMixin.methods.roundNumber,
			checkOrderData: pricing.methods.checkOrderData,
		};
		return { service, ctx, orderErrors, orderTemp };
	}

	function orderTemp(destinationValue) {
		return {
			items: [{
				type: "product",
				subtype: "physical",
				price: 100,
				amount: 1,
				taxData: { priceWithTax: 100, priceWithoutTax: 80, tax: 20 },
			}],
			prices: {},
			data: {
				deliveryData: {
					codename: { physical: { value: "packeta" } },
					destination: destinationValue,
				},
				paymentData: { codename: "cod" },
			},
		};
	}

	it("rejects Packeta without a pickup point and still prices the method", () => {
		const { service, ctx, orderErrors, orderTemp: order } = serviceWith(orderTemp(null));
		expect(service.checkOrderData.call(service, ctx)).toBe(false);
		expect(orderErrors.orderErrors).toEqual(
			expect.arrayContaining([{ value: "Delivery destination", desc: "not set" }])
		);
		expect(order.data.deliveryData.codename.physical.price).toBe(5);
		expect(order.data.deliveryData.destination).toBeUndefined();
	});

	it("keeps a valid pickup point and prices Packeta", () => {
		const { service, ctx, orderErrors, orderTemp: order } = serviceWith(orderTemp({
			...destination,
			raw: { ignore: true },
		}));
		expect(service.checkOrderData.call(service, ctx)).toBe(true);
		expect(orderErrors.orderErrors).toEqual([]);
		expect(order.data.deliveryData.codename.physical.price).toBe(5);
		expect(order.data.deliveryData.destination).toEqual(destination);
	});

	it("drops a destination for methods that do not ask for one", () => {
		const order = orderTemp(destination);
		order.data.deliveryData.codename.physical = { value: "personally" };
		const { service, ctx } = serviceWith(order);
		expect(service.checkOrderData.call(service, ctx)).toBe(true);
		expect(order.data.deliveryData.destination).toBeUndefined();
		expect(applyOrderDestination(
			{ codename: { physical: { value: "personally" } }, destination },
			[{ codename: "personally", type: "physical" }]
		).ok).toBe(true);
	});
});

describe("orders.expede shipment", () => {
	function createService() {
		return {
			logger: { info() {}, warn() {}, error() {} },
			Promise,
			settings: { order: { deliveryMethods: [packetaMethod] } },
			transformDocuments: jest.fn((ctx, params, doc) => doc),
			entityChanged: jest.fn().mockResolvedValue(true),
			adapter: {
				findById: jest.fn(),
				updateById: jest.fn().mockResolvedValue({ _id: "ord-1", status: "expeded" }),
			},
			prepareExpedition: fulfillmentMethods.methods.prepareExpedition,
			storeDeliveryLabel: jest.fn().mockResolvedValue("/tmp/label.pdf"),
			requireAdmin: HelpersMixin.methods.requireAdmin,
		};
	}

	function packetaOrder(expedition) {
		return {
			_id: "ord-1",
			status: "paid",
			dates: {},
			user: { id: "user-1" },
			addresses: shipmentOrder().addresses,
			prices: shipmentOrder().prices,
			data: {
				paymentData: { codename: "online_stripe" },
				deliveryData: {
					codename: { physical: { value: "packeta" } },
					destination,
					expedition,
				},
			},
		};
	}

	const adminCtx = {
		meta: { user: { type: "admin", _id: "admin-1" } },
		params: { orderId: "ord-1" },
	};

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("does not change status when packet creation fails", async () => {
		jest.spyOn(packeta, "createShipment").mockRejectedValue(new Error("phone: Phone is not valid."));
		const service = createService();
		service.adapter.findById.mockResolvedValue(packetaOrder());

		const result = await fulfillmentMixin.actions.expede.handler.call(service, adminCtx);

		expect(result.success).toBe(false);
		expect(result.message).toBe("phone: Phone is not valid.");
		expect(service.adapter.updateById).not.toHaveBeenCalled();
	});

	it("does not create a second packet when a barcode is already stored", async () => {
		const createShipment = jest.spyOn(packeta, "createShipment").mockResolvedValue({});
		const service = createService();
		service.adapter.findById.mockResolvedValue(packetaOrder({
			supplier: "packeta",
			trackingId: "Z123456789",
			packetId: "123456789",
		}));

		const result = await fulfillmentMixin.actions.expede.handler.call(service, adminCtx);

		expect(createShipment).not.toHaveBeenCalled();
		expect(result.success).toBe(true);
		expect(service.adapter.updateById).toHaveBeenCalledWith(
			"ord-1",
			expect.objectContaining({
				$set: expect.objectContaining({
					status: "expeded",
				}),
			})
		);
		const stored = service.adapter.updateById.mock.calls[0][1].$set;
		expect(stored.data.deliveryData.expedition.trackingId).toBe("Z123456789");
		expect(stored.dates.dateExpeded).toBeInstanceOf(Date);
	});
});

describe("orders.attachDeliveryTracking", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	function service() {
		return {
			logger: { info() {}, warn() {}, error() {} },
			settings: { order: { deliveryMethods: [packetaMethod] } },
			adapter: { updateById: jest.fn().mockResolvedValue({}) },
			attachDeliveryTracking: fulfillmentMethods.methods.attachDeliveryTracking,
		};
	}

	function expededOrder() {
		return {
			_id: "ord-1",
			dates: { dateExpeded: new Date("2022-01-01T00:00:00.000Z") },
			lang: { code: "sk" },
			data: {
				deliveryData: {
					codename: { physical: { value: "packeta" } },
					expedition: {
						supplier: "packeta",
						trackingId: "Z123456789",
						packetId: "123456789",
						trackingUrl: "https://tracking.packeta.com/sk/Z123456789",
						labelStored: true,
					},
				},
			},
		};
	}

	it("stores deliveredAt the first time tracking reports delivery", async () => {
		jest.spyOn(packeta, "track").mockResolvedValue({
			supplier: "packeta",
			trackingId: "Z123456789",
			packetId: "123456789",
			status: "delivered",
			statusText: "The parcel was handed over.",
			trackingUrl: "https://tracking.packeta.com/sk/Z123456789",
			updatedAt: "2022-01-10T14:34:06.000Z",
			deliveredAt: "2022-01-10T14:34:06.000Z",
		});
		const orders = service();
		const order = expededOrder();

		const result = await orders.attachDeliveryTracking.call(orders, order);

		expect(result.data.deliveryData.expedition.status).toBe("delivered");
		expect(result.data.deliveryData.expedition.statusText).toBe("The parcel was handed over.");
		expect(result.data.deliveryData.expedition.labelStored).toBe(true);
		expect(result.dates.dateDelivered).toEqual(new Date("2022-01-10T14:34:06.000Z"));
		expect(orders.adapter.updateById).toHaveBeenCalled();
	});

	it("keeps the stored tracking link when the supplier call fails", async () => {
		jest.spyOn(packeta, "track").mockRejectedValue(new Error("down"));
		const orders = service();
		const order = expededOrder();

		const result = await orders.attachDeliveryTracking.call(orders, order);

		expect(result.data.deliveryData.expedition.trackingUrl).toBe("https://tracking.packeta.com/sk/Z123456789");
		expect(result.dates.dateDelivered).toBeUndefined();
		expect(orders.adapter.updateById).not.toHaveBeenCalled();
	});
});
