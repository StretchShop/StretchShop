"use strict";

const subscriptionMethods = require("../../../services/orders/methods/subscription.methods");

function createService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		fixStringToId: (id) => id,
		getPaidTotalStripe: jest.fn((paymentData) => {
			paymentData.paidAmountTotal = 25;
		}),
		generateInvoice: jest.fn().mockResolvedValue({ html: "<p>inv</p>", path: "/inv.pdf" }),
		prepareForUpdate: (order) => {
			const copy = JSON.parse(JSON.stringify(order));
			delete copy._id;
			return { $set: copy };
		},
		entityChanged: jest.fn(),
		afterPaidUserUpdates: jest.fn(),
		afterPaidActions: jest.fn(),
		adapter: {
			updateById: jest.fn((id, update) => Promise.resolve({ _id: id, ...update.$set })),
		},
		...subscriptionMethods.methods,
		...extra,
	};
}

function sampleOrder(overrides = {}) {
	return {
		_id: "ord-1",
		status: "cart",
		lang: { code: "en" },
		dates: {},
		invoice: {},
		items: [{ type: "subscription", _id: "prod-1", paid: false }],
		prices: { priceTotal: 25, priceTotalToPay: 25 },
		data: {
			paymentData: { codename: "online_stripe_card", paidAmountTotal: 0 },
			subscription: { ids: [{ subscription: "sub-1", processed: "no" }] },
		},
		user: { id: "u1", email: "jane@example.com" },
		...overrides,
	};
}

function sampleSubscription(overrides = {}) {
	return {
		_id: "sub-1",
		status: "inactive",
		period: "month",
		duration: 1,
		cycles: 12,
		history: [],
		dates: { dateStart: new Date("2024-01-01"), dateOrderNext: new Date("2024-01-01") },
		orderOriginId: "ord-1",
		data: {
			product: { _id: "prod-1" },
			order: {
				user: { email: "jane@example.com", username: "jane", settings: { language: "en" } },
				data: { paymentData: { codename: "online_stripe", lastResponseResult: [{ amount_paid: 2500, currency: "eur", id: "in_1", payment_intent: "pi_1" }] } },
			},
		},
		...overrides,
	};
}

describe("order subscription methods", () => {
	it("marks a fully paid stripe subscription order as paid", () => {
		const service = createService();
		const order = sampleOrder();
		service.updatePaidOrderSubscriptionData(order, { status: "succeeded" });
		expect(service.getPaidTotalStripe).toHaveBeenCalled();
		expect(order.status).toBe("paid");
	});

	it("loads inactive subscriptions for an order", async () => {
		const service = createService();
		const ctx = { call: jest.fn().mockResolvedValue([{ _id: "sub-1" }]) };
		const found = await service.getOrderSubscriptionsToProcess(ctx, sampleOrder());
		expect(found).toEqual([{ _id: "sub-1" }]);
		ctx.call.mockResolvedValue([]);
		await expect(service.getOrderSubscriptionsToProcess(ctx, sampleOrder())).resolves.toBeNull();
	});

	it("cancels a subscription and removes content dependencies", async () => {
		const service = createService({
			removeSubscriptionContentDependencies: jest.fn().mockResolvedValue({ _id: "u1" }),
		});
		const ctx = {
			params: { data: { reason: "user" } },
			call: jest.fn().mockResolvedValue({ _id: "sub-1", history: [{ action: "canceled" }] }),
		};
		const result = await service.subscriptionCancelled(ctx, sampleSubscription());
		expect(result.success).toBe(false);
		expect(result.message).toBe("subscription canceled");
		expect(service.removeSubscriptionContentDependencies).toHaveBeenCalled();
	});

	it("applies the first subscription payment to the original order", async () => {
		const service = createService({
			updateSubscriptionAfterPaid: jest.fn().mockResolvedValue(sampleSubscription()),
			sendEmailPaymentReceivedSubscription: jest.fn(),
		});
		const ctx = {
			params: { data: { type: "webhook" } },
			meta: { user: { type: "admin" } },
			call: jest.fn().mockResolvedValue([sampleOrder()]),
		};
		const result = await service.subscriptionPaymentReceived(ctx, sampleSubscription());
		expect(result.success).toBe(true);
		expect(service.updateSubscriptionAfterPaid).toHaveBeenCalled();
	});

	it("creates a later subscription invoice order", async () => {
		const service = createService({
			afterSubscriptionPaidOrderActions: jest.fn().mockResolvedValue({ success: true }),
		});
		const ctx = {
			params: { data: { type: "webhook" } },
			meta: { user: { type: "user", _id: "u1" } },
			call: jest.fn((action) => {
				if (action === "orders.find") {
					return Promise.resolve([sampleOrder()]);
				}
				if (action === "subscriptions.createPaidSubscriptionOrder") {
					return Promise.resolve({ order: sampleOrder(), subscription: sampleSubscription() });
				}
				return Promise.resolve({});
			}),
		};
		const sub = sampleSubscription({ history: [{ action: "payment" }] });
		await service.subscriptionPaymentReceived(ctx, sub);
		expect(ctx.call).toHaveBeenCalledWith("subscriptions.createPaidSubscriptionOrder", expect.any(Object));
	});

	it("activates a subscription after payment and emails the user", async () => {
		const service = createService();
		const ctx = {
			meta: { siteSettings: { name: "Shop", supportEmail: "s@x.c" } },
			call: jest.fn((action) => {
				if (action === "subscriptions.calculateDates") {
					return Promise.resolve({
						dateOrderNext: new Date("2024-02-01"),
						dateEnd: new Date("2025-01-01"),
					});
				}
				if (action === "subscriptions.save") {
					return Promise.resolve({ _id: "sub-1", status: "active" });
				}
				if (action === "users.sendEmail") {
					return Promise.resolve(true);
				}
				return Promise.resolve({});
			}),
		};
		const updated = await service.updateSubscriptionAfterPaid(ctx, sampleSubscription());
		expect(updated.status).toBe("active");
		service.sendEmailPaymentReceivedSubscription(ctx, sampleSubscription());
		expect(ctx.call).toHaveBeenCalledWith("users.sendEmail", expect.objectContaining({
			template: "order/payment/paymentreceived",
		}));
	});

	it("counts paid cycles from history", () => {
		const service = createService();
		expect(service.countSubscriptionPaidCycles([
			{ action: "payment", data: { message: JSON.stringify({ data: { object: { total: 10 } } }) } },
			{ action: "other", data: {} },
		])).toEqual({ counter: 1, total: 10 });
	});
});
