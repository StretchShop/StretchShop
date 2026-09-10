"use strict";

const mockParse = jest.fn();
jest.mock("formidable", () => ({
	formidable: jest.fn(() => ({
		parse: mockParse,
	})),
}));

const coreMethods = require("../../../services/api/methods/core.methods");
const helperMethods = require("../../../services/api/methods/helpers.methods");

function createService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		...coreMethods.methods,
		prepareFilePathNameData: helperMethods.methods.prepareFilePathNameData,
		...extra,
	};
}

function createRes() {
	return {
		headersSent: false,
		writableEnded: false,
		getHeader() {},
		setHeader: jest.fn(),
		getHeaders: () => ({}),
		writeHead: jest.fn(),
		end: jest.fn(),
	};
}

describe("api parseUploadedFile", () => {
	beforeEach(() => {
		mockParse.mockReset();
	});

	it("returns an error response when formidable reports a parse error (empty body)", () => {
		mockParse.mockImplementation((req, cb) => {
			cb(new Error("bad content-type header, no content-type"), null, null);
		});
		const service = createService();
		const res = createRes();

		expect(() => service.parseUploadedFile({}, res, { validUserTypes: ["user"] })).not.toThrow();
		expect(res.writeHead).toHaveBeenCalledWith(400, { "content-type": "application/json" });
		expect(res.end).toHaveBeenCalledWith(JSON.stringify({ success: false, error: "Upload failed" }));
	});

	it("returns an error response when no files are present", () => {
		mockParse.mockImplementation((req, cb) => {
			cb(null, {}, {});
		});
		const service = createService();
		const res = createRes();

		service.parseUploadedFile({}, res, { validUserTypes: ["user"] });
		expect(res.writeHead).toHaveBeenCalledWith(400, { "content-type": "application/json" });
		expect(res.end).toHaveBeenCalledWith(JSON.stringify({ success: false, error: "No file uploaded" }));
	});

	it("returns an error response when files is null", () => {
		mockParse.mockImplementation((req, cb) => {
			cb(null, {}, null);
		});
		const service = createService();
		const res = createRes();

		expect(() => service.parseUploadedFile({}, res, { validUserTypes: ["user"] })).not.toThrow();
		expect(res.writeHead).toHaveBeenCalledWith(400, { "content-type": "application/json" });
		expect(res.end).toHaveBeenCalledWith(JSON.stringify({ success: false, error: "No file uploaded" }));
	});

	it("does not throw when an uploaded part has no filepath", async () => {
		mockParse.mockImplementation((req, cb) => {
			cb(null, {}, { file: { originalFilename: "empty.jpg" } });
		});
		const service = createService();
		const res = createRes();

		expect(() => service.parseUploadedFile({}, res, { validUserTypes: ["user"] })).not.toThrow();
		await new Promise((resolve) => setImmediate(resolve));
		expect(res.writeHead).toHaveBeenCalledWith(400, { "content-type": "application/json" });
		expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({
			success: false,
			errors: true,
		});
	});
});

describe("getActiveUploadPath", () => {
	it("does not throw when the request has no user", () => {
		const service = {
			getProductFileNameByType: helperMethods.methods.getProductFileNameByType,
			getActiveUploadPath: helperMethods.methods.getActiveUploadPath,
		};
		const req = {
			$alias: { path: "products/upload/:orderCode/:type" },
			$params: { orderCode: "ABC", type: "cover" },
			$ctx: { meta: {} },
		};
		expect(service.getActiveUploadPath(req)).toMatchObject({
			url: "/products/upload/:orderCode/:type",
			checkAuthorActionParams: { publisher: undefined, orderCode: "ABC" },
		});
	});
});
