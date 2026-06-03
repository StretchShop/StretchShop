"use strict";

const PRODUCTION = "production";
const NON_PRODUCTION_ENVS = new Set(["test", "development", "dockerdev"]);

function isProduction() {
	return process.env.NODE_ENV === PRODUCTION;
}

function isNonProductionEnv() {
	return !process.env.NODE_ENV || NON_PRODUCTION_ENVS.has(process.env.NODE_ENV);
}

/**
 * Returns env value, or devFallback outside production.
 * Throws when NODE_ENV=production and the variable is missing/empty.
 */
function getRequiredSecret(name, devFallback = null) {
	const value = process.env[name];
	if (value && value.toString().trim() !== "") {
		return value;
	}
	if (isProduction()) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return devFallback;
}

module.exports = {
	isProduction,
	isNonProductionEnv,
	getRequiredSecret,
};
