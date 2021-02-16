"use strict";

const { ServiceBroker, Context } = require("moleculer");
const { ValidationError } = require("moleculer").Errors;
const Datastore	= require("nedb");
const OrdersService = require("../../../services/orders.service");
const ProductsService = require("../../../services/products.service");


describe("Test 'subscription' service", () => {
	let broker = new ServiceBroker();
	const serviceOrders = broker.createService(OrdersService, {});
	const serviceProducts = broker.createService(ProductsService, {});

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

		it("should return Array of save Orders", async () => {
			const res = await broker.call("orders.progress", {
				itemId: "5c8183d176feb5cd4f7573ff",
				amount: 1
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
