"use strict";

const { ServiceBroker, Context } = require("moleculer");
const { ValidationError } = require("moleculer").Errors;
const Datastore	= require("nedb");
const CartService = require("../../../services/cart.service");
const ProductsService = require("../../../services/products.service");


describe("Test 'cart' service", () => {
	let broker = new ServiceBroker();
	const serviceCart = broker.createService(CartService, {});
	const serviceProducts = broker.createService(ProductsService, {});

	beforeAll(async () => {
		await broker.start();
		let adapter = new Datastore({ filename: `../../../data/cart.db`, autoload: true });
		await adapter.remove({}, { multi: true });
	});
	afterAll(async () => {
		await broker.stop()
	});


	// Test New cart
	describe("Test 'cart.me' action", () => {
		it("should return Empty Cart", async () => {

			await broker.call("cart.me")
			.then(res => {
				expect(res).toMatchObject({
		      _id: expect.any(String),
		      dateCreated: expect.any(String),
		      dateUpdated: expect.any(String),
		      hash: expect.nullOrAny(String),
		      ip: expect.nullOrAny(String),
		      items: expect.nullOrAny(Array),
		      order: expect.nullOrAny(String),
		      user: expect.nullOrAny(String)
		    });
			});

		});

	});


	// Test Add to cart
	describe("Test 'cart.add' action", () => {

		it("should return Cart with some Item object", async () => {
			const res = await broker.call("cart.add", {
				itemId: "5c8183d176feb5cd4f7573ff",
				amount: 1
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
						amount: 1
					})
				]),
	      order: expect.nullOrAny(String),
	      user: expect.nullOrAny(String)
			});
		});

	});


	// Test Update Amount of Item in cart
	describe("Test 'cart.updateCartItemAmount' action", () => {

		it("should return Cart with Item amount updated", async () => {
			const res = await broker.call("cart.updateCartItemAmount", {
				itemId: "5c8183d176feb5cd4f7573ff",
				amount: 2
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
	      order: expect.nullOrAny(String),
	      user: expect.nullOrAny(String)
			});
		});

	});


	// Test Update Cart - eg. after getting order id
	describe("Test 'cart.updateMyCart' action", () => {

		it("should return Cart with order ID", async () => {
			const res = await broker.call("cart.me")
			.then(cart => {
				cart.order = "ORDR1234567";
				return broker.call("cart.updateMyCart", {cartNew: cart});
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


	// Test Delete Item of cart
	describe("Test 'cart.delete' action", () => {

		it("should return Cart with -1 items", async () => {
			const res = await broker.call("cart.delete", {
				itemId: "5c8183d176feb5cd4f7573ff",
				amount: 1
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
						amount: 1
					})
				]),
	      order: expect.nullOrAny(String),
	      user: expect.nullOrAny(String)
			});
		});

		it("should return Cart with empty array of items", async () => {
			const res = await broker.call("cart.delete", {
				itemId: "5c8183d176feb5cd4f7573ff"
			});

			expect(res).toEqual({
	      _id: expect.any(String),
	      dateCreated: expect.any(String),
	      dateUpdated: expect.any(String),
	      hash: expect.nullOrAny(String),
	      ip: expect.nullOrAny(String),
	      items: [],
	      order: expect.nullOrAny(String),
	      user: expect.nullOrAny(String)
			});
		});

	});

});
