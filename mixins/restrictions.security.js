"use strict";

/**
 * Case-insensitive path match that treats the restriction as a full path
 * segment, not a raw substring (avoids /products matching /notproducts).
 *
 * @param {string} reqPath
 * @param {string} restrictionPath
 * @returns {boolean}
 */
function restrictionPathMatches(reqPath, restrictionPath) {
	const req = String(reqPath || "").toLowerCase().replace(/\/+$/, "") || "/";
	let rest = String(restrictionPath || "").toLowerCase().replace(/\/+$/, "");
	if (!rest) {
		return false;
	}
	if (!rest.startsWith("/")) {
		rest = `/${rest}`;
	}
	if (req === rest) {
		return true;
	}
	if (req.endsWith(rest) && req.charAt(req.length - rest.length) === "/") {
		return true;
	}
	const nested = `${rest}/`;
	const idx = req.indexOf(nested);
	if (idx === 0 || (idx > 0 && req.charAt(idx - 1) === "/")) {
		return true;
	}
	return false;
}

/**
 * @param {string} restriction e.g. "PUT /api/v1/products" or "/products"
 * @param {string} method
 * @param {string} parsedUrl
 * @returns {boolean}
 */
function restrictionMatchesRequest(restriction, method, parsedUrl) {
	const value = String(restriction || "");
	let restrictionPath = value;
	let restrictionMethod = "*";
	if (value.includes(" ")) {
		const space = value.indexOf(" ");
		restrictionMethod = value.slice(0, space).toUpperCase();
		restrictionPath = value.slice(space + 1);
	}
	const reqMethod = String(method || "").toUpperCase();
	const methodMatches = restrictionMethod === "*" || restrictionMethod === reqMethod;
	return methodMatches && restrictionPathMatches(parsedUrl, restrictionPath);
}

module.exports = {
	restrictionPathMatches,
	restrictionMatchesRequest,
};
