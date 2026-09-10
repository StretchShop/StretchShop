"use strict";

const orderCreateMethods = require("../../../services/orders/methods/order-create.methods");

describe("orders.refreshOrderItemsFromCatalog", () => {
	const service = {
		logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
		refreshOrderItemsFromCatalog: orderCreateMethods.methods.refreshOrderItemsFromCatalog,
	};

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("replaces client/cart prices and subscription terms with catalog values", async () => {
		const ctx = {
			call: jest.fn().mockResolvedValue([
				{
					_id: "prod-1",
					price: 49.99,
					tax: 0.2,
					taxData: { priceWithTax: 49.99, priceWithoutTax: 41.66, tax: 8.33 },
					type: "subscription",
					subtype: "digital",
					data: {
						subscription: { period: "month", duration: 1, cycles: 12 },
						requirements: {
							inputs: [{ codename: "seat", value: null }],
						},
					},
				},
			]),
		};

		const order = {
			items: [
				{
					_id: "prod-1",
					price: 0.01,
					amount: 2,
					taxData: { priceWithTax: 0.01 },
					data: {
						subscription: { period: "day", duration: 1, cycles: 999 },
						requirements: {
							inputs: [{ codename: "seat", value: "A1" }],
						},
					},
				},
			],
		};

		const refreshed = await service.refreshOrderItemsFromCatalog(ctx, order);

		expect(ctx.call).toHaveBeenCalledWith("products.findWithId", {
			query: { _id: "prod-1" },
		});
		expect(refreshed.items).toHaveLength(1);
		expect(refreshed.items[0].price).toBe(49.99);
		expect(refreshed.items[0].amount).toBe(2);
		expect(refreshed.items[0].data.subscription).toEqual({
			period: "month",
			duration: 1,
			cycles: 12,
		});
		expect(refreshed.items[0].data.requirements.inputs[0].value).toBe("A1");
	});

	it("drops items that are missing from the catalog", async () => {
		const ctx = {
			call: jest.fn().mockResolvedValue([]),
		};
		const order = {
			items: [{ _id: "gone", price: 1, amount: 1 }],
		};

		const refreshed = await service.refreshOrderItemsFromCatalog(ctx, order);
		expect(refreshed.items).toEqual([]);
		expect(service.logger.error).toHaveBeenCalled();
	});
});
