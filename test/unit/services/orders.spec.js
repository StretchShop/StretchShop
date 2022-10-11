"use strict";

const toBeOneOf = require("../../extensions/to-be-one-of");
const nullOrAny = require("../../extensions/null-or-any");

const { ServiceBroker, Context } = require("moleculer");
const { ValidationError } = require("moleculer").Errors;
const ApiService = require("../../../services/api/api.service");
const CartService = require("../../../services/cart/cart.service");
const ProductsService = require("../../../services/products/products.service");
const OrdersService = require("../../../services/orders/orders.service");
const UserService = require("../../../services/users/users.service");

const testLocals = require("../../../resources/settings/locals.json");
const testUser = require("../../demodata/user.json");

global.testMeta = {
	localsDefault: testLocals,
}
global.testUser = testUser;

global.orderSpecial = {};

global.orderExpectation = {};

describe("Test 'orders' service", () => {
	let broker = new ServiceBroker({ logger: false });
	const serviceApi = broker.createService(ApiService, {});
	const serviceOrders = broker.createService(OrdersService, { meta: global.testMeta });
	const serviceProducts = broker.createService(ProductsService, {});
	const serviceCart = broker.createService(CartService, {});
	const serviceUser = broker.createService(UserService, {});

	// add extensions
	expect.extend({toBeOneOf});
	expect.extend({nullOrAny});

	global.orderExpectation = {
		// _id: expect.any(String),
		externalId: expect.nullOrAny(String),
		externalCode: expect.nullOrAny(String),
		status: expect.stringMatching("cart"),
		user: expect.objectContaining({
			id: expect.nullOrAny(String),
			externalId: expect.nullOrAny(String),
			username: expect.nullOrAny(String),
			email: expect.nullOrAny(String),
		}),
		// ip: expect.nullOrAny(String),
		dates: expect.objectContaining({
			dateCreated: expect.toBeOneOf([String, Date]),
			dateChanged: expect.toBeOneOf([String, Date]),
		}),
		lang: expect.objectContaining({
			code: expect.any(String),
			longCode: expect.any(String),
			name: expect.any(String),
		}),
		country: expect.objectContaining({
			code: expect.any(String),
			name: expect.any(String),
		}),
		addresses: expect.objectContaining({
			invoiceAddress: expect.nullOrAny(Object),
			deliveryAddress: expect.nullOrAny(Array),
		}),
		prices: expect.objectContaining({
			currency: expect.objectContaining({
				code: expect.any(String),
				ratio: expect.any(Number),
				symbol: expect.any(String),
			}),
			priceTotal: expect.nullOrAny(String),
			taxData: expect.objectContaining({
				taxDecimal: expect.any(Number),
				taxType: expect.any(String),
				taxTypes: expect.any(Array),
			}),
		}),
		items: expect.arrayContaining([
			expect.objectContaining({
				_id: expect.any(String),
				orderCode: expect.any(String),
				price: expect.any(Number),
				amount: expect.any(Number)
			})
		]),
		data: expect.any(Object),
		notes: expect.any(Object),
		settings: expect.any(Object),
	}


	beforeAll(async () => {
		await broker.start();
	});
	afterAll(async () => {
		await broker.stop()
	});


	// Test order updates
	describe("Test 'orders.progress' action", () => {


		it("Should return Object of New Order created", async () => {			
			const cart = await broker.call("cart.add", {
				itemId: "5c8183d176feb5cd4f7573ff",
				amount: 1
			});

			// create new order because none exists for cart
			const orderResponse = await broker.call("orders.progress", {}, { meta: global.testMeta });
			expect(orderResponse.result).toMatchObject({
				id: 1,
				name: "missing user data",
				success: false
			});
			global.orderSpecial = orderResponse.order;

			expect(orderResponse.order).toMatchObject(global.orderExpectation);
		});



		it("Should return Order with user/client information", async () => {			
			// add user to CTX.meta
			global.testMeta["user"] = global.testUser;
			// order update
			global.orderSpecial.user = global.testUser;
			global.orderSpecial.addresses = {
				invoiceAddress: {
					type: "invoice",
					email: global.testUser.email,
					nameFirst: global.testUser.addresses[0].nameFirst,
					nameLast: global.testUser.addresses[0].nameLast,
					street: global.testUser.addresses[0].street,
					street2: global.testUser.addresses[0].street2,
					zip: global.testUser.addresses[0].zip,
					city: global.testUser.addresses[0].city,
					country: global.testUser.addresses[0].country,
					phone: global.testUser.addresses[0].phone,
					companyName: "StretchShop s.r.o.",
					companyOrgId: "1234567890",
					companyTaxId: "1234567809",
					companyTaxVatId: "SK1234567809"
				},
				deliveryAddress: null
			};

			// call progress action to get result - order status
			const orderResponse = await broker.call("orders.progress", { orderParams: global.orderSpecial }, { meta: global.testMeta });
			expect(orderResponse.result).toMatchObject({
				id: 2,
				name: "missing order data",
				success: false
			});
			global.orderSpecial = orderResponse.order;

			// - - - - - - - - - VALIDATE - - - - - - - - - 
			// expectations
			global.orderExpectation.user = expect.objectContaining({
				username: expect.any(String),
				email: expect.any(String),
				// type: expect.any(String),
				// subtype: expect.any(String),
				addresses: expect.arrayContaining([
					expect.objectContaining({
						type: "invoice",
						nameFirst: expect.any(String),
						nameLast: expect.any(String),
						street: expect.any(String),
						zip: expect.any(String),
						city: expect.any(String),
						country: expect.any(String),
						phone: expect.any(String)
					})
				]),
				id: expect.any(String),
			});
			global.orderExpectation.country = expect.objectContaining({
				name: expect.any(String),
				code: expect.any(String)
			});
			global.orderExpectation.addresses.invoiceAddress = expect.objectContaining({
				type: "invoice",
				nameFirst: expect.any(String),
				nameLast: expect.any(String),
				street: expect.any(String),
				zip: expect.any(String),
				city: expect.any(String),
				country: expect.any(String),
				phone: expect.any(String)
			});
			expect(orderResponse.order).toMatchObject(global.orderExpectation);
		});



		it("Should return Order with delivery & payment information", async () => {			
			global.orderSpecial.data.deliveryData = {
				codename:{
					physical: {
						value: "personaly",
						price: 0,
						taxData: {
							taxDecimal: 0.1,
							tax: 0,
							taxType: "VAT",
							priceWithoutTax: null,
							priceWithTax: null
						}
					},
					digital: null
				}
			};
			global.orderSpecial.data.paymentData = {
				codename: "online_stripe",
        name: {
          en: "Pay online with Stripe (Card, PayPal)",
          sk: "Zaplatiť online cez Stripe (Karta, PayPal)"
        },
        price: 2,
        taxData: {
          taxDecimal: 0.2,
          tax: 0.4,
          taxType: "VAT",
          priceWithoutTax: 1.6,
          priceWithTax: 2
        }
			};

			// create new order because none exists for cart
			const orderResponse = await broker.call("orders.progress", { orderParams: global.orderSpecial }, { meta: global.testMeta });
			expect(orderResponse.result).toMatchObject({
				id: 3,
				name: "missing confirmation",
				success: false
			});
			global.orderSpecial = orderResponse.order;

			// - - - - - - - - - VALIDATE - - - - - - - - - 
			// expectations
			global.orderExpectation.data.deliveryData = expect.objectContaining({
				codename: expect.objectContaining({
					physical: expect.objectContaining({
						value: "personaly",
						price: expect.any(Number),
						taxData: expect.objectContaining({
							taxDecimal: expect.any(Number),
							tax: expect.any(Number),
							taxType: expect.any(String),
						})
					}),
					digital: nullOrAny(Object)
				})
			});
			global.orderExpectation.data.paymentData = expect.objectContaining({
				codename: "online_stripe",
        name: expect.any(Object),
        price: expect.any(Number),
				taxData: expect.objectContaining({
					taxDecimal: expect.any(Number),
					tax: expect.any(Number),
					taxType: expect.any(String),
				})
			});
			global.orderExpectation.prices = expect.objectContaining({
				priceDeliveryTaxData: expect.objectContaining({
					taxDecimal: expect.any(Number),
					tax: expect.any(Number),
					taxType: expect.any(String),
				}),
				pricePaymentTaxData: expect.objectContaining({
					taxDecimal: expect.any(Number),
					tax: expect.any(Number),
					taxType: expect.any(String),
				}),
			});
			expect(orderResponse.order).toMatchObject(global.orderExpectation);
		});



		it("Should return finished Order", async () => {			
			global.orderSpecial.dates['userConfirmation'] = (new Date()).getTime();

			// create new order because none exists for cart
			const orderResponse = await broker.call("orders.progress", { orderParams: global.orderSpecial }, { meta: global.testMeta });
			expect(orderResponse.result).toMatchObject({
				id: 4,
				name: "confirmed",
				success: true
			});
			global.orderSpecial = orderResponse.order;

			// - - - - - - - - - VALIDATE - - - - - - - - - 
			// expectations
			expect(orderResponse.order.dates.userConfirmation).toBeLessThan(Date.now());
		});


		it("Should List Last Order", async () => {			
			global.orderSpecial.dates["userConfirmation"] = (new Date()).getTime();

			// get last order	
			if ( global.testMeta.user.id ) {
				global.testMeta.user["_id"] = global.testMeta.user.id;
			}
			const orderLast = await broker.call("orders.listOrders", { limit: 1, sort: "-dates.dateCreated" }, { meta: global.testMeta });
			expect(orderLast.total).toBeGreaterThan(0);

			// - - - - - - - - - VALIDATE - - - - - - - - - 
			// expectations
			expect(orderLast.results).toBeInstanceOf(Array);
			expect(orderLast.results[0]._id.toString()).toBe(global.orderSpecial._id.toString());
		});


	});

});
