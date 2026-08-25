"use strict";

const suspendMethods = require("../../../services/subscriptions/methods/suspend.methods");
const billingMethods = require("../../../services/subscriptions/methods/subscription-billing.methods");

describe("subscription cancel email", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		isUserInitiatedSubscriptionCancel: suspendMethods.methods.isUserInitiatedSubscriptionCancel,
		notifyUserSubscriptionCancelled: suspendMethods.methods.notifyUserSubscriptionCancelled,
		sendSubscriptionEmail: billingMethods.methods.sendSubscriptionEmail,
	};

	it("treats missing or user altUser as a customer cancel", () => {
		expect(service.isUserInitiatedSubscriptionCancel("user")).toBe(true);
		expect(service.isUserInitiatedSubscriptionCancel(undefined)).toBe(true);
		expect(service.isUserInitiatedSubscriptionCancel("checkSubscription CRON")).toBe(false);
	});

	it("sends subscription/cancelled mail for a user-initiated cancel", async () => {
		const sendEmail = jest.fn().mockResolvedValue(true);
		const ctx = {
			meta: {
				siteSettings: { name: "Test Shop", supportEmail: "support@example.com" },
			},
			call: sendEmail,
		};
		const subscription = {
			_id: "sub-1",
			data: {
				order: {
					user: {
						email: "buyer@example.com",
						username: "buyer",
						settings: { language: "en" },
					},
				},
			},
		};

		await service.notifyUserSubscriptionCancelled(ctx, subscription);

		expect(sendEmail).toHaveBeenCalledWith("users.sendEmail", expect.objectContaining({
			template: "subscription/cancelled",
			settings: expect.objectContaining({
				subject: "Test Shop - Subscription cancelled",
			}),
		}));
		const payload = sendEmail.mock.calls[0][1];
		const recipients = Array.isArray(payload.settings.to) ? payload.settings.to : [payload.settings.to];
		expect(recipients).toContain("buyer@example.com");
	});

	it("does not fail cancel if the email send rejects", async () => {
		const ctx = {
			meta: { siteSettings: { name: "Test Shop" } },
			call: jest.fn().mockRejectedValue(new Error("SMTP down")),
		};
		const subscription = {
			data: { order: { user: { email: "buyer@example.com" } } },
		};

		await expect(service.notifyUserSubscriptionCancelled(ctx, subscription)).resolves.toBe(false);
	});
});
