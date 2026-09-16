"use strict";

const {
	isProduction,
	getRequiredSecret,
	useRedisCacher,
	getCacherConfig,
	getClientIp,
	getCookieSameSite,
} = require("../../../mixins/env.helpers");

describe("env.helpers", () => {
	const originalNodeEnv = process.env.NODE_ENV;
	const originalJwtSecret = process.env.JWT_SECRET;
	const originalCookiesKey = process.env.COOKIES_KEY;
	const originalTransporter = process.env.TRANSPORTER;
	const originalRedisUrl = process.env.REDIS_URL;

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
		if (originalJwtSecret === undefined) {
			delete process.env.JWT_SECRET;
		} else {
			process.env.JWT_SECRET = originalJwtSecret;
		}
		if (originalCookiesKey === undefined) {
			delete process.env.COOKIES_KEY;
		} else {
			process.env.COOKIES_KEY = originalCookiesKey;
		}
		if (originalTransporter === undefined) {
			delete process.env.TRANSPORTER;
		} else {
			process.env.TRANSPORTER = originalTransporter;
		}
		if (originalRedisUrl === undefined) {
			delete process.env.REDIS_URL;
		} else {
			process.env.REDIS_URL = originalRedisUrl;
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

	it("should reject well-known JWT secrets in production", () => {
		process.env.NODE_ENV = "production";
		process.env.JWT_SECRET = "jwt-stretchshop-secret";
		expect(() => getRequiredSecret("JWT_SECRET", "fallback")).toThrow(
			"Insecure value for required environment variable: JWT_SECRET"
		);
	});

	it("should reject well-known COOKIES_KEY values in production", () => {
		process.env.NODE_ENV = "production";
		process.env.COOKIES_KEY = "Lvj1MalbaTe6k";
		expect(() => getRequiredSecret("COOKIES_KEY", "fallback")).toThrow(
			"Insecure value for required environment variable: COOKIES_KEY"
		);
	});

	it("should use memory cacher outside production microservices", () => {
		process.env.NODE_ENV = "test";
		process.env.TRANSPORTER = "nats://localhost:4222";
		expect(getCacherConfig()).toEqual({
			type: "Memory",
			options: { maxParamsLength: 100 },
		});
	});

	it("should use redis cacher in production microservices", () => {
		process.env.NODE_ENV = "production";
		process.env.TRANSPORTER = "nats://nats-server:4222";
		process.env.REDIS_URL = "redis://redis:6379";
		expect(useRedisCacher()).toBe(true);
		expect(getCacherConfig()).toEqual({
			type: "Redis",
			options: {
				prefix: "stretchshop",
				ttl: 3600,
				redis: "redis://redis:6379",
				maxParamsLength: 100,
			},
		});
	});

	it("should require REDIS_URL for production microservices", () => {
		process.env.NODE_ENV = "production";
		process.env.TRANSPORTER = "nats://nats-server:4222";
		delete process.env.REDIS_URL;
		expect(() => getCacherConfig()).toThrow("Missing required environment variable: REDIS_URL");
	});

	it("uses X-Real-IP or the last X-Forwarded-For hop when TRUST_PROXY is on", () => {
		const originalTrust = process.env.TRUST_PROXY;
		process.env.TRUST_PROXY = "true";
		expect(getClientIp({
			connection: { remoteAddress: "10.0.0.1" },
			headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2", "x-real-ip": "9.9.9.9" },
		})).toBe("9.9.9.9");
		expect(getClientIp({
			connection: { remoteAddress: "10.0.0.1" },
			headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
		})).toBe("2.2.2.2");
		process.env.TRUST_PROXY = "false";
		expect(getClientIp({
			connection: { remoteAddress: "10.0.0.1" },
			headers: { "x-forwarded-for": "1.1.1.1", "x-real-ip": "9.9.9.9" },
		})).toBe("10.0.0.1");
		if (originalTrust === undefined) {
			delete process.env.TRUST_PROXY;
		} else {
			process.env.TRUST_PROXY = originalTrust;
		}
	});

	it("honors COOKIES_SAME_SITE without defaulting to None", () => {
		const original = process.env.COOKIES_SAME_SITE;
		process.env.COOKIES_SAME_SITE = "lax";
		expect(getCookieSameSite()).toBe("lax");
		delete process.env.COOKIES_SAME_SITE;
		expect(getCookieSameSite()).toBe(true);
		if (original === undefined) {
			delete process.env.COOKIES_SAME_SITE;
		} else {
			process.env.COOKIES_SAME_SITE = original;
		}
	});
});
