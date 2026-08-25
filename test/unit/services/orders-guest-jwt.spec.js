"use strict";

const jwt = require("jsonwebtoken");
const helpers = require("../../../services/orders/methods/helpers.methods");

describe("verifyOrderGuestToken", () => {
	const secret = "test-jwt-secret";
	const service = {
		settings: { JWT_SECRET: secret },
		logger: { warn() {}, info() {}, error() {} },
		verifyOrderGuestToken: helpers.methods.verifyOrderGuestToken,
	};

	it("returns payload for a token signed with JWT_SECRET", () => {
		const token = jwt.sign(
			{ id: "guest-1", email: "guest@example.com" },
			secret,
			{ algorithm: "HS256", expiresIn: "1h" }
		);
		expect(service.verifyOrderGuestToken(token)).toEqual(
			expect.objectContaining({ id: "guest-1", email: "guest@example.com" })
		);
	});

	it("rejects a forged token that jwt.decode would accept", () => {
		const forged = jwt.sign(
			{ id: "attacker", email: "attacker@example.com" },
			"wrong-secret",
			{ algorithm: "HS256", expiresIn: "1h" }
		);
		expect(jwt.decode(forged)).toEqual(
			expect.objectContaining({ id: "attacker", email: "attacker@example.com" })
		);
		expect(service.verifyOrderGuestToken(forged)).toBeNull();
	});
});
