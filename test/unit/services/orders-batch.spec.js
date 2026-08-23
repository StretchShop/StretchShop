"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const fulfillmentMethods = require("../../../services/orders/methods/order-fulfillment.methods");
const fulfillmentMixin = require("../../../services/orders/mixins/order-actions.fulfillment.mixin");

function createService(overrides) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		fixStringToId: (id) => id,
		idToString: (id) => String(id),
		transformDocuments: jest.fn((ctx, params, doc) => doc),
		entityChanged: jest.fn().mockResolvedValue(true),
		adapter: {
			find: jest.fn(),
			findById: jest.fn(),
			updateMany: jest.fn().mockResolvedValue(2),
		},
		normalizeBatchOrderStatus: fulfillmentMethods.methods.normalizeBatchOrderStatus,
		getDedicatedOrderStatusAction: fulfillmentMethods.methods.getDedicatedOrderStatusAction,
		summarizeDedicatedStatusResult: fulfillmentMethods.methods.summarizeDedicatedStatusResult,
		runDedicatedOrderStatusActions: fulfillmentMethods.methods.runDedicatedOrderStatusActions,
		notifyOrdersUpdated: fulfillmentMethods.methods.notifyOrdersUpdated,
		processBatchOrderStatusChange: fulfillmentMethods.methods.processBatchOrderStatusChange,
		...overrides,
	};
}

describe("orders.batch status side effects", () => {
	it("maps cancelled to canceled and routes paid/expede/cancel to dedicated actions", () => {
		const service = createService();
		expect(service.normalizeBatchOrderStatus("cancelled")).toBe("canceled");
		expect(service.normalizeBatchOrderStatus("paid")).toBe("paid");
		expect(service.getDedicatedOrderStatusAction("paid")).toBe("orders.paid");
		expect(service.getDedicatedOrderStatusAction("expeded")).toBe("orders.expede");
		expect(service.getDedicatedOrderStatusAction("canceled")).toBe("orders.cancel");
		expect(service.getDedicatedOrderStatusAction("finished")).toBeNull();
	});

	it("runs orders.paid sequentially so invoice numbers do not collide", async () => {
		const started = [];
		const finished = [];
		const service = createService();
		const ctx = {
			call: jest.fn((action, params) => {
				started.push(params.orderId);
				return new Promise((resolve) => {
					setTimeout(() => {
						finished.push(params.orderId);
						resolve({ invoice: params.orderId });
					}, params.orderId === "a" ? 20 : 0);
				});
			}),
		};

		const results = await service.runDedicatedOrderStatusActions.call(
			service,
			ctx,
			[{ _id: "a" }, { _id: "b" }],
			"orders.paid"
		);

		expect(ctx.call.mock.calls.map((call) => call[0])).toEqual(["orders.paid", "orders.paid"]);
		expect(started).toEqual(["a", "b"]);
		expect(finished).toEqual(["a", "b"]);
		expect(results).toEqual([
			{ orderId: "a", success: true, result: { invoice: "a" } },
			{ orderId: "b", success: true, result: { invoice: "b" } },
		]);
	});

	it("delegates paid/expede/cancel instead of updateMany", async () => {
		const service = createService();
		service.runDedicatedOrderStatusActions = jest.fn().mockResolvedValue([{ success: true }]);
		const ctx = { call: jest.fn() };
		const orders = [{ _id: "ord-1" }];

		await service.processBatchOrderStatusChange.call(service, ctx, orders, "paid", ["ord-1"]);
		expect(service.runDedicatedOrderStatusActions).toHaveBeenCalledWith(ctx, orders, "orders.paid");
		expect(service.adapter.updateMany).not.toHaveBeenCalled();

		await service.processBatchOrderStatusChange.call(service, ctx, orders, "expeded", ["ord-1"]);
		expect(service.runDedicatedOrderStatusActions).toHaveBeenCalledWith(ctx, orders, "orders.expede");

		await service.processBatchOrderStatusChange.call(service, ctx, orders, "cancelled", ["ord-1"]);
		expect(service.runDedicatedOrderStatusActions).toHaveBeenCalledWith(ctx, orders, "orders.cancel");
	});

	it("updates other statuses then notifies entityChanged", async () => {
		const updated = { _id: "ord-1", status: "finished" };
		const service = createService();
		service.adapter.findById.mockResolvedValue(updated);

		const results = await service.processBatchOrderStatusChange.call(
			service,
			{},
			[{ _id: "ord-1" }],
			"finished",
			["ord-1"]
		);

		expect(service.adapter.updateMany).toHaveBeenCalledWith(
			{ _id: { $in: ["ord-1"] } },
			expect.objectContaining({
				$set: expect.objectContaining({ status: "finished" }),
			})
		);
		expect(service.entityChanged).toHaveBeenCalledWith("updated", updated, {});
		expect(results).toEqual([{ orderId: "ord-1", success: true, order: updated }]);
	});

	it("rejects non-admin callers", async () => {
		const service = createService();
		const handler = fulfillmentMixin.actions.batch.handler;
		await expect(handler.call(service, {
			meta: { user: { type: "user" } },
			params: { orderIds: ["ord-1"], action: { name: "status", value: "paid" } },
		})).rejects.toBeInstanceOf(MoleculerClientError);
	});

	it("finds orders and processes the status change", async () => {
		const service = createService();
		const found = [{ _id: "ord-1" }];
		service.adapter.find.mockResolvedValue(found);
		service.processBatchOrderStatusChange = jest.fn().mockResolvedValue([{ success: true }]);
		const handler = fulfillmentMixin.actions.batch.handler;
		const ctx = {
			meta: { user: { type: "admin", _id: "admin-1" } },
			params: { orderIds: ["ord-1"], action: { name: "status", value: "paid" } },
		};

		const results = await handler.call(service, ctx);

		expect(service.adapter.find).toHaveBeenCalledWith({ query: { _id: { $in: ["ord-1"] } } });
		expect(service.processBatchOrderStatusChange).toHaveBeenCalledWith(ctx, found, "paid", ["ord-1"]);
		expect(results).toEqual([{ success: true }]);
	});
});
