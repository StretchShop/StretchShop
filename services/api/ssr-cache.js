"use strict";

const crypto = require("crypto");
const fs = require("fs-extra");
const path = require("path");
const { isPublicSsrPath, normalizePublicPath } = require("./ssr-paths");

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function cacheDir() {
	return process.env.SSR_CACHE_DIR || path.resolve(process.cwd(), ".ssr-cache");
}

function cacheFile(pathname) {
	const key = crypto.createHash("sha256").update(normalizePublicPath(pathname)).digest("hex");
	return path.join(cacheDir(), `${key}.html`);
}

function ttlMs() {
	const configured = Number(process.env.SSR_CACHE_TTL_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_MS;
}

async function readSsrCache(pathname) {
	if (!isPublicSsrPath(pathname)) {
		return null;
	}
	const file = cacheFile(pathname);
	try {
		const stat = await fs.stat(file);
		if (Date.now() - stat.mtimeMs > ttlMs()) {
			await fs.remove(file);
			return null;
		}
		const html = await fs.readFile(file, "utf8");
		if (!html.includes("__SSR_STATE__")) {
			return null;
		}
		return html;
	} catch {
		return null;
	}
}

async function writeSsrCache(pathname, html) {
	if (!isPublicSsrPath(pathname) || !html || !html.includes("__SSR_STATE__")) {
		return;
	}
	const file = cacheFile(pathname);
	await fs.ensureDir(cacheDir());
	const temporary = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temporary, html);
	await fs.move(temporary, file, { overwrite: true });
}

function invalidateSsrCache() {
	try {
		fs.removeSync(cacheDir());
	} catch (error) {
		console.error("ssr cache invalidate failed", error);
	}
}

async function renderThroughSidecar(pathname) {
	const endpoint = process.env.SSR_RENDER_URL;
	if (!endpoint || !isPublicSsrPath(pathname)) {
		return null;
	}
	const secret = process.env.SSR_RENDER_SECRET || "";
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), Number(process.env.SSR_RENDER_TIMEOUT_MS) || 15000);
	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(secret ? { authorization: `Bearer ${secret}` } : {}),
			},
			body: JSON.stringify({ path: normalizePublicPath(pathname) }),
			signal: controller.signal,
		});
		if (!response.ok) {
			return null;
		}
		const html = await response.text();
		if (!html.includes('id="app"') || !html.includes("__SSR_STATE__")) {
			return null;
		}
		await writeSsrCache(pathname, html);
		return html;
	} catch (error) {
		console.error("ssr render request failed", error);
		return null;
	} finally {
		clearTimeout(timer);
	}
}

module.exports = {
	readSsrCache,
	writeSsrCache,
	invalidateSsrCache,
	renderThroughSidecar,
	cacheFile,
};
