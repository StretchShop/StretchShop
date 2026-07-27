"use strict";

/**
 * Escape special characters for safe use inside a MongoDB $regex pattern.
 * @param {string} input
 * @returns {string}
 */
function escapeRegex(input) {
	return String(input ?? "").replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Recursively strip Mongo operator keys (starting with $) and prototype-pollution keys
 * from a client-supplied object. Arrays are mapped item-by-item.
 * @param {*} value
 * @returns {*}
 */
function sanitizeMongoQuery(value) {
	if (value == null) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeMongoQuery(item));
	}
	if (typeof value !== "object" || value instanceof Date || value instanceof RegExp) {
		return value;
	}
	const out = {};
	for (const key of Object.keys(value)) {
		if (DANGEROUS_KEYS.has(key) || key.startsWith("$")) {
			continue;
		}
		out[key] = sanitizeMongoQuery(value[key]);
	}
	return out;
}

/**
 * Allow only listed field names in a flat query object (no $ operators).
 * @param {object} query
 * @param {string[]} allowedFields
 * @returns {object}
 */
function allowlistQueryFields(query, allowedFields) {
	const clean = sanitizeMongoQuery(query || {});
	const allowed = new Set(allowedFields);
	const out = {};
	for (const key of Object.keys(clean)) {
		if (allowed.has(key)) {
			out[key] = clean[key];
		}
	}
	return out;
}

module.exports = {
	escapeRegex,
	sanitizeMongoQuery,
	allowlistQueryFields,
	DANGEROUS_KEYS,
};
