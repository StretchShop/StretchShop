"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const fulfillment = require("../../../services/orders/methods/order-fulfillment.methods");
const lifecycle = require("../../../services/orders/mixins/order-actions.lifecycle.mixin");
const authMixin = require("../../../services/users/mixins/auth.mixin");
const SettingsMixin = require("../../../mixins/settings.mixin");

describe("order fulfillment helpers", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		...fulfillment.methods,
	};

	it("builds invoice numbers and counts item types", () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			invoiceData: { eshop: { numberCodePrefix: "SS" } },
		});
		expect(service.generateInvoiceNumber(7, new Date("2024-03-15T00:00:00Z"))).toMatch(/^SS/);
		SettingsMixin.getSiteSettings.mockRestore();

		expect(service.getInvoiceFilePaths({ user: { id: "u1" }, invoice: { id: "INV-1" } })).toMatchObject({
			sendPath: "invoices/u1/INV-1.pdf",
		});
		expect(service.countOrderItemTypes({
			status: "paid",
			items: [
				{ type: "product" },
				{ type: "product" },
				{ type: "subscription" },
			],
			data: { subscription: { ids: [{ processed: "yes" }] } },
		})).toEqual({ product: 0, subscription: 0 });
	});

	it("collects user data for guest checkout and emails ordered status", async () => {
		const ctx = {
			meta: { user: { email: "guest@example.com" } },
			params: {
				orderParams: {
					user: { password: "secret12" },
					addresses: { invoiceAddress: { email: "guest@example.com", nameFirst: "G" } },
					lang: { code: "en" },
					country: { code: "EUR" },
				},
			},
			call: jest.fn().mockResolvedValue(true),
		};
		expect(service.getDataToCreateUser(ctx).user.email).toBe("guest@example.com");
		service.sendOrderedEmail(ctx, { _id: "ord-1", user: { email: "a@b.c" } });
		expect(ctx.call).toHaveBeenCalledWith("users.sendEmail", expect.objectContaining({
			template: "order/ordered",
		}));
	});
});

describe("order lifecycle actions", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		countOrderPrices: jest.fn((type, extra, order) => order),
		transformDocuments: jest.fn((ctx, params, doc) => doc),
		entityChanged: jest.fn().mockResolvedValue(true),
		orderAfterSaveActions: jest.fn(),
		adapter: {
			insert: jest.fn().mockResolvedValue({ _id: "ord-1", dates: {} }),
			findById: jest.fn(),
			updateById: jest.fn().mockResolvedValue({ _id: "ord-1", status: "cart" }),
		},
	};

	it("creates an order and runs after-save actions", async () => {
		const result = await lifecycle.actions.create.handler.call(service, {
			params: { order: { dates: {}, items: [] } },
		});
		expect(result._id).toBe("ord-1");
		expect(service.orderAfterSaveActions).toHaveBeenCalled();
	});

	it("updates an existing order", async () => {
		service.adapter.findById.mockResolvedValue({ _id: "ord-1", dates: {} });
		const result = await lifecycle.actions.updateOrder.handler.call(service, {
			params: { order: { id: "ord-1", dates: {}, items: [] } },
		});
		expect(service.adapter.updateById).toHaveBeenCalled();
		expect(result._id).toBe("ord-1");
	});
});

describe("users auth actions", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		enforceRateLimit: jest.fn().mockResolvedValue(true),
		validateEntity: jest.fn().mockResolvedValue(true),
		adapter: {
			findOne: jest.fn(),
			insert: jest.fn(),
			updateById: jest.fn(),
		},
	};

	it("rejects duplicate usernames on create", async () => {
		service.adapter.findOne.mockResolvedValue({ _id: "u1" });
		await expect(authMixin.actions.create.handler.call(service, {
			params: { user: { username: "jane", email: "j@e.c", password: "secret12", settings: { language: "en", currency: "EUR" } } },
			meta: {},
		})).rejects.toMatchObject({ code: 422 });
	});

	it("rejects unknown and inactive logins", async () => {
		service.adapter.findOne.mockResolvedValue(null);
		await expect(authMixin.actions.login.handler.call(service, {
			params: { user: { email: "missing@example.com", password: "x" } },
			meta: {},
		})).rejects.toMatchObject({ code: 422 });

		service.adapter.findOne.mockResolvedValue({ email: "a@b.c", dates: {} });
		await expect(authMixin.actions.login.handler.call(service, {
			params: { user: { email: "a@b.c", password: "x" } },
			meta: {},
		})).rejects.toMatchObject({ code: 422 });
	});

	it("forbids impersonation for non-admins", async () => {
		await expect(authMixin.actions.loginAs.handler.call(service, {
			meta: { user: { type: "user" } },
			params: { email: "a@b.c" },
		})).rejects.toMatchObject({ code: 403 });
	});
});
