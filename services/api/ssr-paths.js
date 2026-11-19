"use strict";

/**
 * Anonymous HTML routes rendered by the Vue SSR server.
 * Keep the same patterns in stretchshop-front-vue/src/ssr/public-path.js.
 */

const PUBLIC_PATTERNS = [
	/^\/[a-z]{2}$/,
	/^\/[a-z]{2}\/products$/,
	/^\/[a-z]{2}\/services$/,
	/^\/[a-z]{2}\/products\/[^/]+$/,
	/^\/[a-z]{2}\/services\/[^/]+$/,
	/^\/[a-z]{2}\/pages\/[^/]+$/,
	/^\/[a-z]{2}\/products\/[^/]+\/product\/[^/]+\/[^/]+$/,
	/^\/[a-z]{2}\/pages\/[^/]+\/page\/[^/]+$/,
	/^\/[a-z]{2}\/page\/[^/]+$/,
];

function normalizePublicPath(input) {
	const raw = String(input || "").split("#")[0].split("?")[0];
	if (!raw.startsWith("/")) {
		return "";
	}
	if (raw.length > 1 && raw.endsWith("/")) {
		return raw.slice(0, -1);
	}
	return raw;
}

function isPublicSsrPath(input) {
	const path = normalizePublicPath(input);
	if (!path || path.includes("..") || path.endsWith("/edit")) {
		return false;
	}
	return PUBLIC_PATTERNS.some((pattern) => pattern.test(path));
}

function hasAuthCookie(cookieHeader) {
	const header = String(cookieHeader || "");
	// Only real login cookies. Anonymous `session` / `cart` / `csrf` are set for
	// every visitor by the API and must not skip SSR.
	return ["token", "admin_token"].some((name) => {
		const match = header.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`));
		return Boolean(match && decodeURIComponent(match[1]).trim());
	});
}

module.exports = {
	normalizePublicPath,
	isPublicSsrPath,
	hasAuthCookie,
};
