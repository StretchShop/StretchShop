"use strict";

const cartMethods = require("../../../services/cart/methods/core.methods");

describe("cart ownership", () => {
	const service = {
		idToString: (id) => String(id),
		...cartMethods.methods,
	};

	it("allows guest carts and matching owners", () => {
		expect(service.cartAccessible({ user: null }, { meta: {} })).toBe(true);
		expect(service.cartAccessible({ user: "u1" }, { meta: { user: { _id: "u1" } } })).toBe(true);
		expect(service.cartAccessible({ user: "u1" }, { meta: { user: { id: "u1" } } })).toBe(true);
	});

	it("refuses a cart owned by another account", () => {
		expect(service.cartAccessible({ user: "u1" }, { meta: { user: { _id: "u2" } } })).toBe(false);
		expect(service.cartAccessible({ user: "u1" }, { meta: {} })).toBe(false);
	});
});
