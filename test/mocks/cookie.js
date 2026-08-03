"use strict";

/**
 * Lightweight CJS stand-in for the ESM-only `cookie` package under Jest.
 */

function stringifyCookie(cookie) {
	if (!cookie || typeof cookie.name !== "string") {
		return "";
	}
	return `${cookie.name}=${cookie.value == null ? "" : String(cookie.value)}`;
}

function stringifySetCookie(cookie) {
	if (!cookie || typeof cookie.name !== "string") {
		return "";
	}

	const parts = [stringifyCookie(cookie)];

	if (cookie.maxAge != null) {
		parts.push(`Max-Age=${Math.floor(cookie.maxAge)}`);
	}
	if (cookie.domain) {
		parts.push(`Domain=${cookie.domain}`);
	}
	if (cookie.path) {
		parts.push(`Path=${cookie.path}`);
	}
	if (cookie.expires instanceof Date) {
		parts.push(`Expires=${cookie.expires.toUTCString()}`);
	}
	if (cookie.httpOnly) {
		parts.push("HttpOnly");
	}
	if (cookie.secure) {
		parts.push("Secure");
	}
	if (cookie.sameSite) {
		parts.push(`SameSite=${cookie.sameSite}`);
	}

	return parts.join("; ");
}

function parseCookie() {
	return {};
}

function parseSetCookie() {
	return {};
}

module.exports = {
	parseCookie,
	parseSetCookie,
	stringifyCookie,
	stringifySetCookie,
};
