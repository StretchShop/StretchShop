"use strict";

const {
	isProduction,
	getRequiredSecret,
} = require("../../../mixins/env.helpers");

describe("env.helpers", () => {
	const originalNodeEnv = process.env.NODE_ENV;
	const originalJwtSecret = process.env.JWT_SECRET;

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
		if (originalJwtSecret === undefined) {
			delete process.env.JWT_SECRET;
		} else {
			process.env.JWT_SECRET = originalJwtSecret;
		}
	});

	it("should detect production environment", () => {
		process.env.NODE_ENV = "production";
		expect(isProduction()).toBe(true);
	});

	it("should return env value when set", () => {
		process.env.NODE_ENV = "production";
		process.env.JWT_SECRET = "prod-secret";
		expect(getRequiredSecret("JWT_SECRET", "fallback")).toBe("prod-secret");
	});

	it("should throw in production when secret is missing", () => {
		process.env.NODE_ENV = "production";
		delete process.env.JWT_SECRET;
		expect(() => getRequiredSecret("JWT_SECRET", "fallback")).toThrow(
			"Missing required environment variable: JWT_SECRET"
		);
	});

	it("should allow dev fallback outside production", () => {
		process.env.NODE_ENV = "test";
		delete process.env.JWT_SECRET;
		expect(getRequiredSecret("JWT_SECRET", "dev-fallback")).toBe("dev-fallback");
	});
});
