"use strict";

const { createTestBroker } = require("../../setup/broker");
const SubscriptionsService = require("../../../services/subscriptions/subscriptions.service");

describe("Test 'subscriptions' service", () => {
	let broker;
	let service;

	beforeAll(async () => {
		broker = createTestBroker();
		service = broker.createService(SubscriptionsService);
		await broker.start();
	});

	afterAll(async () => {
		await broker.stop();
	});

	describe("methods", () => {
		it("newHistoryRecord should build a history entry", () => {
			const record = service.newHistoryRecord("created", "user", { note: "test" });
			expect(record).toMatchObject({
				action: "created",
				type: "user",
				data: { note: "test" },
			});
			expect(record.date).toBeInstanceOf(Date);
		});

		it("calculateDateOrderNext should advance one month", () => {
			const start = new Date("2024-01-15T12:00:00.000Z");
			const next = service.calculateDateOrderNext("month", 1, start);
			expect(next.getMonth()).toBe(1);
			expect(next.getFullYear()).toBe(2024);
		});

		it("createEmptySubscription should return a template object", () => {
			const sub = service.createEmptySubscription();
			expect(sub).toMatchObject({
				status: "inactive",
				history: [],
			});
			expect(sub.dates.dateCreated).toBeInstanceOf(Date);
		});
	});

	describe("subscriptions.calculateDates action", () => {
		it("should return dateOrderNext and dateEnd", async () => {
			const result = await broker.call("subscriptions.calculateDates", {
				period: "month",
				duration: 1,
				dateStart: "2024-01-15T00:00:00.000Z",
				cycles: 3,
				withDateEnd: true,
			});

			expect(result.dateOrderNext).toBeInstanceOf(Date);
			expect(result.dateEnd).toBeInstanceOf(Date);
			expect(result.dateOrderNext.getTime()).toBeGreaterThan(
				new Date("2024-01-15T00:00:00.000Z").getTime()
			);
		});
	});

	describe("subscriptions.checkSubscriptions action", () => {
		it("should run cron check without throwing", async () => {
			const result = await broker.call("subscriptions.checkSubscriptions");
			expect(result === undefined || Array.isArray(result) || typeof result === "object").toBe(true);
		});
	});

	describe("subscriptions.save action", () => {
		it("should persist a subscription entity", async () => {
			const entity = service.createEmptySubscription();
			entity.userId = "user-test-001";
			entity.ip = "127.0.0.1:3000";
			entity.period = "month";
			entity.duration = 1;
			entity.cycles = 12;
			entity.status = "inactive";
			entity.orderOriginId = "order-test-001";
			entity.orderItemName = "Test plan";
			entity.price = 9.99;
			entity.data = {
				product: { orderCode: "SUB-001" },
			};

			const saved = await broker.call("subscriptions.save", { entity });
			expect(saved).toBeDefined();
			expect(saved._id || saved.id).toBeDefined();
			expect(saved.userId).toBe("user-test-001");
		});
	});
});
