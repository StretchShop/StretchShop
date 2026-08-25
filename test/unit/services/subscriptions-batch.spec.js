"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const batchMethods = require("../../../services/subscriptions/methods/batch.methods");
const coreMethods = require("../../../services/subscriptions/methods/subscription-core.methods");
const batchMixin = require("../../../services/subscriptions/mixins/subscriptions.actions.batch.mixin");
const queryMixin = require("../../../services/subscriptions/mixins/subscriptions.actions.query.mixin");

function createService(overrides) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		fixStringToId: (id) => id,
		idToString: (id) => String(id),
		transformDocuments: jest.fn((ctx, params, doc) => doc),
		entityChanged: jest.fn().mockResolvedValue(true),
		newHistoryRecord: coreMethods.methods.newHistoryRecord,
		adapter: {
			find: jest.fn(),
			findById: jest.fn(),
			updateMany: jest.fn().mockResolvedValue(2),
			collection: {
				distinct: jest.fn(),
			},
		},
		broker: {
			cacher: null,
		},
		normalizeBatchSubscriptionStatus: batchMethods.methods.normalizeBatchSubscriptionStatus,
		getDedicatedSubscriptionStatusAction: batchMethods.methods.getDedicatedSubscriptionStatusAction,
		summarizeDedicatedSubscriptionResult: batchMethods.methods.summarizeDedicatedSubscriptionResult,
		runDedicatedSubscriptionStatusActions: batchMethods.methods.runDedicatedSubscriptionStatusActions,
		notifySubscriptionsUpdated: batchMethods.methods.notifySubscriptionsUpdated,
		processBatchSubscriptionStatusChange: batchMethods.methods.processBatchSubscriptionStatusChange,
		normalizeDistinctSubscriptionValues: batchMethods.methods.normalizeDistinctSubscriptionValues,
		loadDistinctSubscriptionField: batchMethods.methods.loadDistinctSubscriptionField,
		loadDistinctSubscriptionValues: batchMethods.methods.loadDistinctSubscriptionValues,
		getDistinctSubscriptionValues: batchMethods.methods.getDistinctSubscriptionValues,
		...overrides,
	};
}

describe("subscriptions.batch status side effects", () => {
	it("maps aliases and routes cancel/stop to suspend, pause to pause, and active to reactivate", () => {
		const service = createService();
		expect(service.normalizeBatchSubscriptionStatus("cancelled")).toBe("canceled");
		expect(service.normalizeBatchSubscriptionStatus("suspend")).toBe("canceled");
		expect(service.normalizeBatchSubscriptionStatus("pause")).toBe("paused");
		expect(service.normalizeBatchSubscriptionStatus("reactivated")).toBe("active");
		expect(service.getDedicatedSubscriptionStatusAction("canceled")).toBe("subscriptions.suspend");
		expect(service.getDedicatedSubscriptionStatusAction("stopped")).toBe("subscriptions.suspend");
		expect(service.getDedicatedSubscriptionStatusAction("paused")).toBe("subscriptions.pause");
		expect(service.getDedicatedSubscriptionStatusAction("active")).toBe("subscriptions.reactivate");
		expect(service.getDedicatedSubscriptionStatusAction("finished")).toBeNull();
	});

	it("runs dedicated Stripe actions sequentially", async () => {
		const started = [];
		const finished = [];
		const service = createService();
		const ctx = {
			meta: { user: { type: "admin" } },
			call: jest.fn((action, params) => {
				started.push(params.subscriptionId);
				return new Promise((resolve) => {
					setTimeout(() => {
						finished.push(params.subscriptionId);
						resolve({ success: true, message: action });
					}, params.subscriptionId === "a" ? 20 : 0);
				});
			}),
		};

		const results = await service.runDedicatedSubscriptionStatusActions.call(
			service,
			ctx,
			[{ _id: "a" }, { _id: "b" }],
			"subscriptions.suspend"
		);

		expect(ctx.call.mock.calls.map((call) => call[0])).toEqual([
			"subscriptions.suspend",
			"subscriptions.suspend",
		]);
		expect(ctx.call.mock.calls[0][1]).toMatchObject({
			subscriptionId: "a",
			altUser: "admin",
			altMessage: "batch",
		});
		expect(started).toEqual(["a", "b"]);
		expect(finished).toEqual(["a", "b"]);
		expect(results).toEqual([
			{ subscriptionId: "a", success: true, result: { success: true, message: "subscriptions.suspend" } },
			{ subscriptionId: "b", success: true, result: { success: true, message: "subscriptions.suspend" } },
		]);
	});

	it("delegates canceled/active instead of updateMany", async () => {
		const service = createService();
		service.runDedicatedSubscriptionStatusActions = jest.fn().mockResolvedValue([{ success: true }]);
		const ctx = { call: jest.fn(), meta: { user: { type: "admin" } } };
		const subscriptions = [{ _id: "sub-1" }];

		await service.processBatchSubscriptionStatusChange.call(
			service, ctx, subscriptions, "canceled", ["sub-1"]
		);
		expect(service.runDedicatedSubscriptionStatusActions).toHaveBeenCalledWith(
			ctx, subscriptions, "subscriptions.suspend"
		);
		expect(service.adapter.updateMany).not.toHaveBeenCalled();

		await service.processBatchSubscriptionStatusChange.call(
			service, ctx, subscriptions, "active", ["sub-1"]
		);
		expect(service.runDedicatedSubscriptionStatusActions).toHaveBeenCalledWith(
			ctx, subscriptions, "subscriptions.reactivate"
		);

		await service.processBatchSubscriptionStatusChange.call(
			service, ctx, subscriptions, "cancelled", ["sub-1"]
		);
		expect(service.runDedicatedSubscriptionStatusActions).toHaveBeenCalledWith(
			ctx, subscriptions, "subscriptions.suspend"
		);

		await service.processBatchSubscriptionStatusChange.call(
			service, ctx, subscriptions, "paused", ["sub-1"]
		);
		expect(service.runDedicatedSubscriptionStatusActions).toHaveBeenCalledWith(
			ctx, subscriptions, "subscriptions.pause"
		);
	});

	it("updates other statuses then notifies entityChanged", async () => {
		const updated = { _id: "sub-1", status: "finished" };
		const service = createService();
		service.adapter.findById.mockResolvedValue(updated);

		const results = await service.processBatchSubscriptionStatusChange.call(
			service,
			{ meta: { user: { type: "admin" } } },
			[{ _id: "sub-1" }],
			"finished",
			["sub-1"]
		);

		expect(service.adapter.updateMany).toHaveBeenCalledWith(
			{ _id: { $in: ["sub-1"] } },
			expect.objectContaining({
				$set: expect.objectContaining({ status: "finished" }),
			})
		);
		expect(service.entityChanged).toHaveBeenCalledWith("updated", updated, expect.any(Object));
		expect(results).toEqual([{ subscriptionId: "sub-1", success: true, subscription: updated }]);
	});

	it("rejects non-admin callers", async () => {
		const service = createService();
		const handler = batchMixin.actions.batch.handler;
		await expect(handler.call(service, {
			meta: { user: { type: "user" } },
			params: { subscriptionIds: ["sub-1"], action: { name: "status", value: "canceled" } },
		})).rejects.toBeInstanceOf(MoleculerClientError);
	});

	it("finds subscriptions and processes the status change", async () => {
		const service = createService();
		const found = [{ _id: "sub-1" }];
		service.adapter.find.mockResolvedValue(found);
		service.processBatchSubscriptionStatusChange = jest.fn().mockResolvedValue([{ success: true }]);
		const handler = batchMixin.actions.batch.handler;
		const ctx = {
			meta: { user: { type: "admin", _id: "admin-1" } },
			params: { subscriptionIds: ["sub-1"], action: { name: "status", value: "canceled" } },
		};

		const results = await handler.call(service, ctx);

		expect(service.adapter.find).toHaveBeenCalledWith({ query: { _id: { $in: ["sub-1"] } } });
		expect(service.processBatchSubscriptionStatusChange).toHaveBeenCalledWith(
			ctx, found, "canceled", ["sub-1"]
		);
		expect(results).toEqual([{ success: true }]);
	});
});

describe("subscriptions distinct values", () => {
	it("loads sorted unique values from MongoDB distinct", async () => {
		const service = createService();
		service.adapter.collection.distinct.mockImplementation((field) => {
			if (field === "status") {
				return Promise.resolve(["paused", "active", null, "active", ""]);
			}
			if (field === "type") {
				return Promise.resolve(["autorefresh"]);
			}
			if (field === "period") {
				return Promise.resolve(["month", "year"]);
			}
			if (field === "orderItemName") {
				return Promise.resolve(["Plan B", "Plan A"]);
			}
			return Promise.resolve([]);
		});

		const values = await service.getDistinctSubscriptionValues.call(service);

		expect(service.adapter.collection.distinct.mock.calls.map((call) => call[0])).toEqual([
			"status",
		]);
		expect(values).toEqual({
			status: ["active", "paused"],
		});
	});

	it("returns cached distinct values without querying MongoDB", async () => {
		const cached = { status: ["active"], type: [], period: [], orderItemName: [] };
		const service = createService();
		service.broker.cacher = {
			get: jest.fn().mockResolvedValue(cached),
			set: jest.fn().mockResolvedValue(true),
		};

		const values = await service.getDistinctSubscriptionValues.call(service);

		expect(values).toEqual(cached);
		expect(service.adapter.collection.distinct).not.toHaveBeenCalled();
		expect(service.broker.cacher.set).not.toHaveBeenCalled();
	});

	it("stores distinct values in the cache on a miss", async () => {
		const service = createService();
		service.adapter.collection.distinct.mockResolvedValue(["active"]);
		service.broker.cacher = {
			get: jest.fn().mockResolvedValue(null),
			set: jest.fn().mockResolvedValue(true),
		};

		const values = await service.getDistinctSubscriptionValues.call(service);

		expect(values.status).toEqual(["active"]);
		expect(service.broker.cacher.set).toHaveBeenCalledWith(
			"subscriptions.distinctValues",
			values,
			60
		);
	});

	it("includes distinct values in listSubscriptions response", async () => {
		const distinct = { status: ["active", "paused"], type: [], period: [], orderItemName: [] };
		const service = createService();
		service.getDistinctSubscriptionValues = jest.fn().mockResolvedValue(distinct);
		const handler = queryMixin.actions.listSubscriptions.handler;
		const ctx = {
			meta: { user: { _id: "user-1", type: "admin" } },
			params: {},
			call: jest.fn((action) => {
				if (action === "subscriptions.find") {
					return Promise.resolve([{ _id: "s1", status: "active", history: ["keep"] }]);
				}
				if (action === "subscriptions.count") {
					return Promise.resolve(1);
				}
				return Promise.resolve(null);
			}),
		};

		const result = await handler.call(service, ctx);

		expect(result).toEqual({
			total: 1,
			results: [{ _id: "s1", status: "active" }],
			distinct,
		});
		expect(service.getDistinctSubscriptionValues).toHaveBeenCalled();
	});
});
