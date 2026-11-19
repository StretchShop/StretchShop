"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { isPublicSsrPath, hasAuthCookie, normalizePublicPath } = require("../../../services/api/ssr-paths");
const { writeSsrCache, readSsrCache, invalidateSsrCache } = require("../../../services/api/ssr-cache");

describe("ssr paths", () => {
	it("matches the public storefront routes", () => {
		expect(normalizePublicPath("/en/page/info/")).toBe("/en/page/info");
		expect(isPublicSsrPath("/en/products/books/product/slug/id")).toBe(true);
		expect(isPublicSsrPath("/en/cart")).toBe(false);
		expect(isPublicSsrPath("/en/page/info/edit")).toBe(false);
	});

	it("treats login cookies as logged in, not anonymous session", () => {
		expect(hasAuthCookie("token=abc")).toBe(true);
		expect(hasAuthCookie("admin_token=abc")).toBe(true);
		expect(hasAuthCookie("session=anonymous-jwt")).toBe(false);
		expect(hasAuthCookie("cart=xyz")).toBe(false);
		expect(hasAuthCookie("token=")).toBe(false);
		expect(hasAuthCookie("")).toBe(false);
	});
});

describe("ssr cache", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ssr-cache-"));

	beforeAll(() => {
		process.env.SSR_CACHE_DIR = directory;
	});

	afterAll(() => {
		delete process.env.SSR_CACHE_DIR;
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it("stores and drops hydrated HTML", async () => {
		const html = "<html><div id=\"app\"></div><script>window.__SSR_STATE__={}</script></html>";
		await writeSsrCache("/en/page/info", html);
		await expect(readSsrCache("/en/page/info")).resolves.toBe(html);
		invalidateSsrCache();
		await expect(readSsrCache("/en/page/info")).resolves.toBeNull();
	});
});
