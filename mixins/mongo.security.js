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

/** Never allow these, even if listed in allowedOperators. */
const FORBIDDEN_OPERATORS = new Set([
	"$where",
	"$expr",
	"$function",
	"$accumulator",
	"$jsonSchema",
	"$regex",
]);

/**
 * @param {*} value
 * @returns {boolean}
 */
function isSafeScalar(value) {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value instanceof Date
	);
}

/**
 * Keep only values that are safe under an allowlisted operator.
 * Rejects nested objects (which could reintroduce operators).
 * @param {string} op
 * @param {*} value
 * @returns {*|undefined}
 */
function sanitizeOperatorValue(op, value) {
	if (op === "$in" || op === "$nin") {
		if (!Array.isArray(value)) {
			return undefined;
		}
		const items = value.filter(isSafeScalar);
		return items.length > 0 ? items : undefined;
	}
	if (op === "$eq" || op === "$ne" || op === "$gt" || op === "$gte" || op === "$lt" || op === "$lte") {
		return isSafeScalar(value) ? value : undefined;
	}
	if (op === "$exists") {
		return typeof value === "boolean" ? value : undefined;
	}
	// Unknown allowlisted op: only accept scalars / scalar arrays
	if (isSafeScalar(value)) {
		return value;
	}
	if (Array.isArray(value) && value.every(isSafeScalar)) {
		return value;
	}
	return undefined;
}

/**
 * Recursively strip prototype-pollution keys and Mongo operators from a
 * client-supplied object. Arrays are mapped item-by-item.
 *
 * By default every `$…` key is removed. Pass `allowedOperators` to keep
 * specific operators whose values pass type checks (e.g. `$in` with an
 * array of strings/numbers). Dangerous operators are always dropped.
 *
 * @param {*} value
 * @param {{ allowedOperators?: string[] }} [options]
 * @returns {*}
 */
function sanitizeMongoQuery(value, options = {}) {
	const allowedOperators = new Set(options.allowedOperators || []);

	if (value == null) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeMongoQuery(item, options));
	}
	if (typeof value !== "object" || value instanceof Date || value instanceof RegExp) {
		return value;
	}

	const out = {};
	for (const key of Object.keys(value)) {
		if (DANGEROUS_KEYS.has(key)) {
			continue;
		}
		if (key.startsWith("$")) {
			if (!allowedOperators.has(key) || FORBIDDEN_OPERATORS.has(key)) {
				continue;
			}
			const cleaned = sanitizeOperatorValue(key, value[key]);
			if (cleaned !== undefined) {
				out[key] = cleaned;
			}
			continue;
		}

		const nested = sanitizeMongoQuery(value[key], options);
		// Drop empty plain objects left after operators were stripped
		if (
			nested !== null &&
			typeof nested === "object" &&
			!Array.isArray(nested) &&
			!(nested instanceof Date) &&
			!(nested instanceof RegExp) &&
			Object.keys(nested).length === 0
		) {
			continue;
		}
		out[key] = nested;
	}
	return out;
}

/**
 * Allow only listed field names in a query object.
 * @param {object} query
 * @param {string[]} allowedFields
 * @param {{ allowedOperators?: string[] }} [options]
 * @returns {object}
 */
function allowlistQueryFields(query, allowedFields, options = {}) {
	const clean = sanitizeMongoQuery(query || {}, options);
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
	FORBIDDEN_OPERATORS,
};
