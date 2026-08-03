"use strict";

/**
 * Lightweight CJS stand-in for the ESM-only `slug` package under Jest.
 * Mirrors the callable default export used throughout services.
 */
function slug(string, opts = {}) {
	let result = String(string ?? "")
		.normalize("NFKD")
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/[\s_-]+/g, "-");

	if (opts.lower !== false) {
		result = result.toLowerCase();
	}

	return result;
}

slug.charmap = {};
slug.multicharmap = {};
slug.defaults = { mode: "pretty", lower: true };
slug.extend = () => {};
slug.reset = () => {};
slug.setLocale = () => {};

module.exports = slug;
