"use strict";

const { ServiceBroker, Context } = require("moleculer");
const { ValidationError } = require("moleculer").Errors;
const Datastore	= require("nedb");
const SubscriptionsService = require("../../../services/subscriptions.service");
const ProductsService = require("../../../services/products.service");


describe("Test 'subscription' service", () => {
	let broker = new ServiceBroker();
	const serviceSubscriptions = broker.createService(SubscriptionsService, {});
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
	describe("Test 'subscriptions.orderToSubscription' action", () => {

		it("should return Array of save Subscriptions", async () => {
			const res = await broker.call("subscriptions.orderToSubscription", {
				itemId: "5c8183d176feb5cd4f7573ff",
				amount: 1
			})
			.then(cart => {
				cart.order = "ORDR1234567";
				return broker.call("subscriptions.find", {bla: blabla});
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
