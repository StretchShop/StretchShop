"use strict";

const adminMethods = require("../../../services/users/methods/admin.methods");

describe("users cleanup visibility", () => {
	it("keeps cleanUsers private so it is not callable over the bus", () => {
		expect(adminMethods.actions.cleanUsers.visibility).toBe("private");
	});
});
