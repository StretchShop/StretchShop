"use strict";

const { ServiceBroker } = require("moleculer");
const { ValidationError } = require("moleculer").Errors;
const CartService = require("../../services/cart.service");

describe("Test 'cart' service", () => {
	let broker = new ServiceBroker();
	broker.createService(CartService);

	beforeAll(() => broker.start());
	afterAll(() => broker.stop());

	// Test Add to cart
	describe("Test 'cart.add' action", () => {

		it("should return new cart 'Hello Moleculer'", () => {
			expect(broker.call("cart.add")).resolves.toBe("Hello Moleculer");
		});

	});

	describe("Test 'greeter.welcome' action", () => {

		it("should return with 'Welcome'", () => {
			expect(broker.call("greeter.welcome", { name: "Adam" })).resolves.toBe("Welcome, Adam");
		});

		it("should reject an ValidationError", () => {
			expect(broker.call("greeter.welcome")).rejects.toBeInstanceOf(ValidationError);
		});

	});

});
