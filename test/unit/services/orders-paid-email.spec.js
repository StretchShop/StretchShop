"use strict";

jest.mock("../../../modules/einvoice", () => ({
	generateAndSend: jest.fn()
}));

const fulfillmentMethods = require("../../../services/orders/methods/order-fulfillment.methods");
const SettingsMixin = require("../../../mixins/settings.mixin");
const einvoice = require("../../../modules/einvoice");

describe("orders paid email invoice attachment", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		getInvoiceFilePaths: fulfillmentMethods.methods.getInvoiceFilePaths,
		sendOrderPaidEmail: fulfillmentMethods.methods.sendOrderPaidEmail,
		generateEinvoice: fulfillmentMethods.methods.generateEinvoice,
	};

	it("builds invoice paths outside the public static folder", () => {
		const originalPublic = process.env.PATH_PUBLIC;
		const originalAssets = process.env.ASSETS_PATH;
		const originalInvoices = process.env.PATH_INVOICES;
		const originalResources = process.env.PATH_RESOURCES;
		process.env.PATH_PUBLIC = "./public";
		process.env.ASSETS_PATH = "assets/_s";
		process.env.PATH_INVOICES = "./data/invoices";
		delete process.env.PATH_RESOURCES;

		const paths = service.getInvoiceFilePaths({
			user: { id: "user1" },
			invoice: { id: "5202608031" },
		});

		expect(paths.sendPath).toBe("invoices/user1/5202608031.pdf");
		expect(paths.pdfPath.replace(/\\/g, "/")).toMatch(/data\/invoices\/user1\/5202608031\.pdf$/);
		expect(paths.pdfPath.replace(/\\/g, "/")).not.toMatch(/\/public\//);

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
		if (originalInvoices === undefined) {
			delete process.env.PATH_INVOICES;
		} else {
			process.env.PATH_INVOICES = originalInvoices;
		}
		if (originalResources === undefined) {
			delete process.env.PATH_RESOURCES;
		} else {
			process.env.PATH_RESOURCES = originalResources;
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

	it("asks the e-invoice module to store xml beside the pdf", async () => {
		const spy = jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			invoiceData: { company: { name: "Co" } }
		});
		einvoice.generateAndSend.mockResolvedValue({
			format: "en16931-peppolBisBilling30",
			lang: "en",
			path: "invoices/user1/5202608031.xml",
			sent: false,
			status: null,
			error: null
		});
		const result = await service.generateEinvoice({
			user: { id: "user1" },
			invoice: { id: "5202608031" }
		});
		expect(einvoice.generateAndSend).toHaveBeenCalledWith(expect.objectContaining({
			relativeDir: "invoices/user1",
			outputDir: expect.stringMatching(/user1$/)
		}));
		expect(result.path).toBe("invoices/user1/5202608031.xml");
		spy.mockRestore();
	});
});
