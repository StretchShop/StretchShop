"use strict";

const fulfillmentMethods = require("../../../services/orders/methods/order-fulfillment.methods");

describe("orders paid email invoice attachment", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		getInvoiceFilePaths: fulfillmentMethods.methods.getInvoiceFilePaths,
		sendOrderPaidEmail: fulfillmentMethods.methods.sendOrderPaidEmail,
	};

	it("builds invoice paths under public + ASSETS_PATH", () => {
		const originalPublic = process.env.PATH_PUBLIC;
		const originalAssets = process.env.ASSETS_PATH;
		process.env.PATH_PUBLIC = "./public";
		process.env.ASSETS_PATH = "assets/_s";

		const paths = service.getInvoiceFilePaths({
			user: { id: "user1" },
			invoice: { id: "5202608031" },
		});

		expect(paths.sendPath).toBe("invoices/user1/5202608031.pdf");
		expect(paths.pdfPath.replace(/\\/g, "/")).toMatch(/public\/assets\/_s\/invoices\/user1\/5202608031\.pdf$/);

		if (originalPublic === undefined) {
			delete process.env.PATH_PUBLIC;
		} else {
			process.env.PATH_PUBLIC = originalPublic;
		}
		if (originalAssets === undefined) {
			delete process.env.ASSETS_PATH;
		} else {
			process.env.ASSETS_PATH = originalAssets;
		}
	});

	it("omits attachments when the PDF path is missing", async () => {
		const sendEmail = jest.fn().mockResolvedValue(true);
		await service.sendOrderPaidEmail(
			{ call: sendEmail },
			{ _id: "order1", user: { email: "buyer@example.com", id: "user1" } },
			"<p>invoice</p>",
			null
		);

		expect(sendEmail).toHaveBeenCalledWith("users.sendEmail", expect.objectContaining({
			template: "order/orderpaid",
			settings: expect.objectContaining({
				to: "buyer@example.com",
			}),
		}));
		expect(sendEmail.mock.calls[0][1].settings.attachments).toBeUndefined();
	});

	it("attaches the PDF when the file path is provided", async () => {
		const sendEmail = jest.fn().mockResolvedValue(true);
		const pdfPath = "/tmp/invoice.pdf";
		await service.sendOrderPaidEmail(
			{ call: sendEmail },
			{ _id: "order1", user: { email: "buyer@example.com" } },
			"<p>invoice</p>",
			pdfPath
		);

		expect(sendEmail.mock.calls[0][1].settings.attachments).toEqual([{ path: pdfPath }]);
	});

	it("skips a second paid email when dates.emailPaidSent is set", async () => {
		const sendEmail = jest.fn().mockResolvedValue(true);
		const result = await service.sendOrderPaidEmail(
			{ call: sendEmail },
			{ _id: "order1", dates: { emailPaidSent: new Date() }, user: { email: "buyer@example.com" } },
			"<p>invoice</p>",
			null
		);

		expect(result).toBe(true);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("persists dates.emailPaidSent after a successful send", async () => {
		const sendEmail = jest.fn().mockResolvedValue(true);
		const updateById = jest.fn().mockResolvedValue({});
		const order = { _id: "order1", user: { email: "buyer@example.com" } };
		const paidService = {
			...service,
			adapter: { updateById },
		};

		await paidService.sendOrderPaidEmail(
			{ call: sendEmail },
			order,
			"<p>invoice</p>",
			null
		);

		expect(order.dates.emailPaidSent).toBeInstanceOf(Date);
		expect(updateById).toHaveBeenCalledWith("order1", {
			$set: { "dates.emailPaidSent": order.dates.emailPaidSent }
		});
	});
});
