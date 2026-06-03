"use strict";

const { createTestBroker } = require("../../setup/broker");
const MetricsService = require("../../../services/metrics.service");

describe("Test 'metrics' service", () => {
	let broker;
	let serviceMetrics;

	beforeAll(async () => {
		broker = createTestBroker();
		serviceMetrics = broker.createService(MetricsService);
		await broker.start();
	});

	afterAll(async () => {
		await broker.stop();
	});

	it("should report healthy broker status", async () => {
		const result = await broker.call("metrics.health");

		expect(result.status).toBe("ok");
		expect(result.checks.broker).toBe("ok");
		expect(result.nodeID).toBe(broker.nodeID);
		expect(result.timestamp).toEqual(expect.any(String));
		expect(result.uptime).toEqual(expect.any(Number));
	});

	it("should include mongo check when MONGO_URI is configured", async () => {
		const originalMongoUri = process.env.MONGO_URI;
		process.env.MONGO_URI = "mongodb://invalid-host:27017/health-test";

		const result = await broker.call("metrics.health");

		expect(result.checks.mongo).toBe("error");
		expect(result.status).toBe("degraded");

		if (originalMongoUri === undefined) {
			delete process.env.MONGO_URI;
		} else {
			process.env.MONGO_URI = originalMongoUri;
		}
	});
});
