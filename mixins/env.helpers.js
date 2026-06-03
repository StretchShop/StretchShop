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

function useRedisCacher() {
	return isProduction() && !!process.env.TRANSPORTER?.trim();
}

function getCacherConfig() {
	if (useRedisCacher()) {
		return {
			type: "Redis",
			options: {
				prefix: process.env.CACHER_PREFIX || "stretchshop",
				ttl: parseInt(process.env.CACHER_TTL || "3600", 10),
				redis: getRequiredSecret("REDIS_URL", null),
				maxParamsLength: 100,
			},
		};
	}

	return {
		type: "Memory",
		options: {
			maxParamsLength: 100,
		},
	};
}

module.exports = {
	isProduction,
	isNonProductionEnv,
	getRequiredSecret,
	useRedisCacher,
	getCacherConfig,
};
