"use strict";

const { ServiceBroker, Context } = require("moleculer");
const { ValidationError } = require("moleculer").Errors;
const Datastore	= require("nedb");
const OrdersService = require("../../../services/orders/orders.service");
const ProductsService = require("../../../services/products/products.service");
const CartService = require("../../../services/cart/cart.service");


describe("Test 'orders' service", () => {
	let broker = new ServiceBroker();
	const serviceOrders = broker.createService(OrdersService, {});
	const serviceProducts = broker.createService(ProductsService, {});
	const serviceCart = broker.createService(CartService, {});

	beforeAll(async () => {
		await broker.start();
		let adapter = new Datastore({ filename: `../../../data/subscription.db`, autoload: true });
		await adapter.remove({}, { multi: true });
	});
	afterAll(async () => {
		await broker.stop()
	});


	// Test Update Cart - eg. after getting order id
	describe("Test 'orders.progress' action", () => {

		it("should return Object of saved Orders", async () => {
			const cart = await broker.call("cart.add", {
				itemId: "5c8183d176feb5cd4f7573ff",
				amount: 1
			});

			const res = await broker.call("orders.progress", {
				// cart state
			})
			.then(cart => {
				cart.order = "ORDR1234567";
				return broker.call("orders.find", {bla: blabla});
			});

			expect(res).toEqual({
	      _id: expect.any(String),
	      dateCreated: expect.any(String),
	      dateUpdated: expect.any(String),
	      hash: expect.nullOrAny(String),
	      ip: expect.nullOrAny(String),
	      items: expect.arrayContaining([
					expect.objectContaining({
						_id: expect.any(String),
						orderCode: expect.any(String),
						price: expect.any(Number),
						amount: 2
					})
				]),
	      order: "ORDR1234567",
	      user: expect.nullOrAny(String)
			});
		});

	});

});
