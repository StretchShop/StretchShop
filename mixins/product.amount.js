"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

const MAX_DECIMAL_DEPTH = 10;

function getDecimalAmountConfig(product) {
	const decimalAmount = product?.data?.decimalAmount;
	if (!decimalAmount || decimalAmount.allowed !== true) {
		return null;
	}
	let maxDepth = Number(decimalAmount.maxDepth);
	if (!Number.isFinite(maxDepth)) {
		return null;
	}
	maxDepth = Math.floor(maxDepth);
	if (maxDepth < 1) {
		return null;
	}
	if (maxDepth > MAX_DECIMAL_DEPTH) {
		maxDepth = MAX_DECIMAL_DEPTH;
	}
	return { allowed: true, maxDepth };
}

function countDecimalPlaces(value) {
	if (!Number.isFinite(value)) {
		return 0;
	}
	if (Math.floor(value) === value) {
		return 0;
	}
	const str = String(value);
	if (str.includes("e") || str.includes("E")) {
		const parts = str.split(/e/i);
		const mantissa = parts[0];
		const exp = Number(parts[1]);
		const mantissaDecimals = (mantissa.split(".")[1] || "").length;
		return Math.max(0, mantissaDecimals - exp);
	}
	const fraction = str.split(".")[1];
	return fraction ? fraction.length : 0;
}

function normalizeProductAmount(amount, product) {
	const numericAmount = Number(amount);
	if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
		throw new MoleculerClientError("Invalid product amount", 422, "INVALID_AMOUNT", []);
	}
	const config = getDecimalAmountConfig(product);
	if (!config) {
		return Math.ceil(numericAmount);
	}
	if (countDecimalPlaces(numericAmount) > config.maxDepth) {
		throw new MoleculerClientError(
			`Product amount exceeds maximum decimal places (${config.maxDepth})`,
			422,
			"INVALID_AMOUNT_DECIMALS",
			[]
		);
	}
	return numericAmount;
}

function sanitizeProductDecimalAmountData(data) {
	if (!data || typeof data !== "object") {
		return data;
	}
	const decimalAmount = data.decimalAmount;
	if (!decimalAmount || decimalAmount.allowed !== true) {
		delete data.decimalAmount;
		return data;
	}
	let maxDepth = Number(decimalAmount.maxDepth);
	if (!Number.isFinite(maxDepth)) {
		throw new MoleculerClientError("decimalAmount.maxDepth must be a number", 422, "INVALID_DECIMAL_AMOUNT", []);
	}
	maxDepth = Math.floor(maxDepth);
	if (maxDepth < 1 || maxDepth > MAX_DECIMAL_DEPTH) {
		throw new MoleculerClientError(
			`decimalAmount.maxDepth must be between 1 and ${MAX_DECIMAL_DEPTH}`,
			422,
			"INVALID_DECIMAL_AMOUNT",
			[]
		);
	}
	data.decimalAmount = { allowed: true, maxDepth };
	return data;
}

function sanitizeProductEntityDecimalAmount(entity) {
	if (!entity?.data) {
		return entity;
	}
	sanitizeProductDecimalAmountData(entity.data);
	return entity;
}

module.exports = {
	MAX_DECIMAL_DEPTH,
	getDecimalAmountConfig,
	countDecimalPlaces,
	normalizeProductAmount,
	sanitizeProductDecimalAmountData,
	sanitizeProductEntityDecimalAmount,
};
