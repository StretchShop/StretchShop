"use strict";

const fs = require("fs-extra");
const { hasAuthCookie, isPublicSsrPath, normalizePublicPath } = require("./ssr-paths");
const { readSsrCache, renderThroughSidecar } = require("./ssr-cache");

async function readIndexHtml(indexPath, fallbackPath) {
	if (await fs.pathExists(indexPath)) {
		return fs.readFile(indexPath, "utf8");
	}
	return fs.readFile(fallbackPath, "utf8");
}

function sendHtml(res, html, cacheControl) {
	res.setHeader("Content-Type", "text/html; charset=utf-8");
	res.setHeader("Cache-Control", cacheControl);
	res.setHeader("Vary", "Cookie");
	res.end(html);
}

/**
 * Serve a hydrated public document when one is cached or the renderer can make it.
 * Logged-in visitors and every other route get the client-side shell.
 */
async function serveStorefrontHtml(req, res, paths) {
	const requestPath = req.__stretchshopPath || "/";
	const pathname = normalizePublicPath(requestPath.split("?")[0]);
	const search = requestPath.includes("?") ? requestPath.slice(requestPath.indexOf("?")) : "";
	const indexHtml = await readIndexHtml(paths.indexPath, paths.fallbackPath);

	const anonymousPublic = !search
		&& !hasAuthCookie(req.headers?.cookie)
		&& isPublicSsrPath(pathname);

	if (anonymousPublic) {
		const cached = await readSsrCache(pathname);
		if (cached) {
			sendHtml(res, cached, "private, no-cache");
			return;
		}
		const rendered = await renderThroughSidecar(pathname);
		if (rendered) {
			sendHtml(res, rendered, "private, no-cache");
			return;
		}
	}

	sendHtml(res, indexHtml, "no-cache");
}

module.exports = {
	serveStorefrontHtml,
};
