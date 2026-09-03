"use strict";

const { DANGEROUS_KEYS } = require("./mongo.security");

/** Top-level order fields a client may send in orderParams. */
const TOP_LEVEL_KEYS = new Set([
	"lang",
	"country",
	"addresses",
	"dates",
	"data",
	"notes",
]);

const ADDRESS_KEYS = new Set(["invoiceAddress", "deliveryAddress"]);

const ADDRESS_FIELD_KEYS = new Set([
	"type",
	"email",
	"name",
	"nameFirst",
	"nameLast",
	"street",
	"street2",
	"zip",
	"city",
	"country",
	"phone",
	"state",
	"companyName",
	"companyOrgId",
	"companyTaxId",
	"companyTaxVatId",
]);

const DATE_KEYS = new Set(["userConfirmation"]);

const DATA_KEYS = new Set(["deliveryData", "paymentData", "couponData"]);

const DELIVERY_DATA_KEYS = new Set(["codename"]);

const PAYMENT_DATA_KEYS = new Set(["codename", "name", "price", "taxData"]);

const DELIVERY_OPTION_KEYS = new Set(["value", "price", "taxData"]);

const TAX_DATA_KEYS = new Set([
	"taxDecimal",
	"tax",
	"taxType",
	"priceWithoutTax",
	"priceWithTax",
	"taxTypes",
]);

const NOTE_KEYS = new Set(["customerNote"]);

const LANG_COUNTRY_KEYS = new Set(["code", "longCode", "name"]);

/** Paths where clients may supply new object keys (e.g. product-type buckets). */
const DYNAMIC_OBJECT_PATHS = new Set([
	"data.deliveryData.codename",
]);

const PATH_ALLOWED_KEYS = {
	addresses: ADDRESS_KEYS,
	"addresses.invoiceAddress": ADDRESS_FIELD_KEYS,
	"addresses.deliveryAddress": ADDRESS_FIELD_KEYS,
	dates: DATE_KEYS,
	data: DATA_KEYS,
	"data.deliveryData": DELIVERY_DATA_KEYS,
	"data.paymentData": PAYMENT_DATA_KEYS,
	notes: NOTE_KEYS,
	lang: LANG_COUNTRY_KEYS,
	country: LANG_COUNTRY_KEYS,
};

/**
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		!(value instanceof Date)
	);
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isDangerousKey(key) {
	return DANGEROUS_KEYS.has(key) || key.startsWith("$");
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isDynamicPath(path) {
	return DYNAMIC_OBJECT_PATHS.has(path);
}

/**
 * @param {string} path
 * @param {string} key
 * @param {object} target
 * @returns {boolean}
 */
function isKeyAllowed(path, key, target) {
	if (isDangerousKey(key)) {
		return false;
	}
	if (!path) {
		return TOP_LEVEL_KEYS.has(key);
	}
	if (isDynamicPath(path)) {
		return true;
	}
	const allowed = PATH_ALLOWED_KEYS[path];
	if (allowed) {
		return allowed.has(key);
	}
	if (path.endsWith(".taxData")) {
		return TAX_DATA_KEYS.has(key);
	}
	if (path.startsWith("data.deliveryData.codename.")) {
		return DELIVERY_OPTION_KEYS.has(key);
	}
	return Object.prototype.hasOwnProperty.call(target, key);
}

/**
 * @param {string} path
 * @param {string} key
 * @param {object} target
 * @returns {boolean}
 */
function canAssignKey(path, key, target) {
	if (isDynamicPath(path)) {
		return true;
	}
	if (!path && TOP_LEVEL_KEYS.has(key)) {
		return true;
	}
	if (PATH_ALLOWED_KEYS[path]?.has(key)) {
		return true;
	}
	if (path.endsWith(".taxData") && TAX_DATA_KEYS.has(key)) {
		return true;
	}
	if (path.startsWith("data.deliveryData.codename.") && DELIVERY_OPTION_KEYS.has(key)) {
		return true;
	}
	return Object.prototype.hasOwnProperty.call(target, key);
}

/**
 * Pick only client-allowed order fields from a request payload.
 * @param {*} source
 * @param {string} [path]
 * @param {object} [target]
 * @returns {object}
 */
function pickAllowedOrderParams(source, path = "", target = null) {
	if (!isPlainObject(source)) {
		return {};
	}

	const out = {};
	for (const key of Object.keys(source)) {
		if (!isKeyAllowed(path, key, target || {})) {
			continue;
		}

		const value = source[key];
		const nextPath = path ? `${path}.${key}` : key;

		if (isPlainObject(value)) {
			const nested = pickAllowedOrderParams(
				value,
				nextPath,
				target && isPlainObject(target[key]) ? target[key] : null
			);
			if (Object.keys(nested).length > 0 || isDynamicPath(nextPath)) {
				out[key] = nested;
			}
			continue;
		}

		if (Array.isArray(value)) {
			if (canAssignKey(path, key, target || {})) {
				out[key] = value;
			}
			continue;
		}

		if (canAssignKey(path, key, target || {})) {
			out[key] = value;
		}
	}

	return out;
}

/**
 * @param {object} source
 * @returns {boolean}
 */
function hasAllowedOrderParamUpdates(source) {
	return Object.keys(pickAllowedOrderParams(source)).length > 0;
}

/**
 * Merge only allowlisted client fields into an order template/document.
 * @param {object} target
 * @param {object} source
 * @param {string} [path]
 * @returns {object}
 */
function mergeAllowedOrderParams(target, source, path = "") {
	if (!isPlainObject(target) || !isPlainObject(source)) {
		return target;
	}

	const picked = pickAllowedOrderParams(source, path, target);
	for (const key of Object.keys(picked)) {
		const value = picked[key];
		const nextPath = path ? `${path}.${key}` : key;

		if (isPlainObject(value)) {
			if (!isPlainObject(target[key])) {
				target[key] = {};
			}
			mergeAllowedOrderParams(target[key], value, nextPath);
			continue;
		}

		target[key] = value;
	}

	return target;
}

module.exports = {
	DANGEROUS_KEYS,
	TOP_LEVEL_KEYS,
	pickAllowedOrderParams,
	hasAllowedOrderParamUpdates,
	mergeAllowedOrderParams,
};
