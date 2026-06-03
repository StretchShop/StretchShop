"use strict";

const { createTestBroker } = require("../../setup/broker");
const OrdersService = require("../../../services/orders/orders.service");
const UsersService = require("../../../services/users/users.service");

const testLocals = require("../../../resources/settings/locals.json");

describe("Test orders.afterPaidUserUpdates", () => {
	let broker;
	let serviceOrders;
	let serviceUsers;
	let testUserId;

	beforeAll(async () => {
		broker = createTestBroker();
		serviceUsers = broker.createService(UsersService, { meta: { localsDefault: testLocals } });
		serviceOrders = broker.createService(OrdersService, { meta: { localsDefault: testLocals } });
		await broker.start();

		const inserted = await serviceUsers.adapter.insert({
			username: "paid_user_" + Date.now(),
			email: "paid_user_" + Date.now() + "@example.com",
			password: "hashed-password",
			type: "user",
			data: {
				contentDependencies: {
					list: ["OLD-PRODUCT"],
				},
			},
			dates: {
				dateCreated: new Date(),
				dateUpdated: new Date(),
			},
		});
		testUserId = inserted._id.toString();
	});

	afterAll(async () => {
		await broker.stop();
	});

	it("should merge content dependency codes and persist them via users service", async () => {
		const order = {
			user: { id: testUserId },
			items: [
				{ orderCode: "NEW-PRODUCT", contentDependency: true },
				{ orderCode: "IGNORE-ME", contentDependency: false },
			],
		};
		const ctx = {
			meta: {
				user: {
					data: {
						contentDependencies: {
							list: ["OLD-PRODUCT"],
						},
					},
				},
			},
			call: (...args) => broker.call(...args),
		};

		const result = await serviceOrders.afterPaidUserUpdates(order, ctx);

		expect(result.order).toBe(order);
		expect(result.user.data.contentDependencies.list).toEqual(["OLD-PRODUCT", "NEW-PRODUCT"]);
		expect(ctx.meta.user.data.contentDependencies.list).toEqual(["OLD-PRODUCT", "NEW-PRODUCT"]);

		const storedUser = await serviceUsers.adapter.findById(testUserId);
		expect(storedUser.data.contentDependencies.list).toEqual(["OLD-PRODUCT", "NEW-PRODUCT"]);
	});

	it("should skip update when order has no content dependency items", async () => {
		const updateSpy = jest.spyOn(broker, "call");

		const result = await serviceOrders.afterPaidUserUpdates(
			{
				user: { id: testUserId },
				items: [{ orderCode: "NO-CD", contentDependency: false }],
			},
			{ meta: {} }
		);

		expect(result).toEqual({
			user: null,
			order: {
				user: { id: testUserId },
				items: [{ orderCode: "NO-CD", contentDependency: false }],
			},
		});
		expect(updateSpy).not.toHaveBeenCalledWith(
			"users.updateContentDependencies",
			expect.anything()
		);

		updateSpy.mockRestore();
	});
});

describe("Test helpers content dependency utilities", () => {
	let broker;
	let serviceOrders;

	beforeAll(async () => {
		broker = createTestBroker();
		serviceOrders = broker.createService(OrdersService, { meta: { localsDefault: testLocals } });
		await broker.start();
	});

	afterAll(async () => {
		await broker.stop();
	});

	it("should build removal params from subscription product", () => {
		const params = serviceOrders.getContentDependencyRemovalParamsFromSubscription({
			userId: "user-123",
			data: {
				product: {
					orderCode: "SUB-PRODUCT",
					contentDependency: true,
				},
			},
		});

		expect(params).toEqual({
			userId: "user-123",
			productCodes: ["SUB-PRODUCT"],
		});
	});

	it("should return null when subscription has no content dependency product", () => {
		const params = serviceOrders.getContentDependencyRemovalParamsFromSubscription({
			userId: "user-123",
			data: {
				product: {
					orderCode: "SUB-PRODUCT",
					contentDependency: false,
				},
			},
		});

		expect(params).toBeNull();
	});
});
