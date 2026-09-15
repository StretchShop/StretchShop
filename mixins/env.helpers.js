"use strict";

const PRODUCTION = "production";
const NON_PRODUCTION_ENVS = new Set(["test", "development", "dockerdev"]);
const SIGNING_SECRET_NAMES = new Set(["JWT_SECRET", "COOKIES_KEY"]);
const INSECURE_SECRET_VALUES = new Set([
	"jwt-stretchshop-secret",
	"jwt-secret-SOMETHING",
	"Lvj1MalbaTe6k",
	"change-me-to-a-long-random-string",
	"generate-with-openssl-rand-hex-32",
]);

function isProduction() {
	return process.env.NODE_ENV === PRODUCTION;
}

function isNonProductionEnv() {
	return !process.env.NODE_ENV || NON_PRODUCTION_ENVS.has(process.env.NODE_ENV);
}

function isInsecureSecretValue(value) {
	const normalized = value.toString().trim();
	if (INSECURE_SECRET_VALUES.has(normalized)) {
		return true;
	}
	return /^CHANGE[_-]?ME/i.test(normalized);
}

/**
 * Returns env value, or devFallback outside production.
 * Throws when NODE_ENV=production and the variable is missing/empty.
 * Production also rejects well-known placeholder signing secrets.
 */
function getRequiredSecret(name, devFallback = null) {
	const value = process.env[name];
	if (value && value.toString().trim() !== "") {
		if (isProduction() && SIGNING_SECRET_NAMES.has(name) && isInsecureSecretValue(value)) {
			throw new Error(`Insecure value for required environment variable: ${name}`);
		}
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

/** True only when COOKIES_SECURE is the string "true". */
function isCookiesSecure() {
	return process.env.COOKIES_SECURE === "true";
}

/** Trust X-Forwarded-For / X-Real-IP only when explicitly enabled. */
function trustProxy() {
	return process.env.TRUST_PROXY === "true";
}

/**
 * Client IP for rate-limiting. When TRUST_PROXY is on, prefer X-Real-IP
 * (the hop nginx sets) over the leftmost X-Forwarded-For (client-spoofable).
 * @param {import("http").IncomingMessage} req
 * @returns {string}
 */
function getClientIp(req) {
	const direct = req?.connection?.remoteAddress || req?.socket?.remoteAddress || "";
	if (!trustProxy()) {
		return direct;
	}
	const realIp = req?.headers?.["x-real-ip"];
	if (realIp && String(realIp).trim()) {
		return String(realIp).trim();
	}
	const xff = req?.headers?.["x-forwarded-for"];
	if (xff) {
		const hops = String(xff).split(",").map((s) => s.trim()).filter(Boolean);
		if (hops.length > 0) {
			return hops[hops.length - 1];
		}
	}
	return direct;
}

/**
 * Cookie SameSite from COOKIES_SAME_SITE. Do not force None just because Secure is on.
 * Use None only when the frontend and API are truly cross-site.
 * @returns {string|true}
 */
function getCookieSameSite() {
	const raw = process.env.COOKIES_SAME_SITE;
	if (!raw || String(raw).trim() === "") {
		return true;
	}
	return String(raw).trim();
}

module.exports = {
	isProduction,
	isNonProductionEnv,
	isInsecureSecretValue,
	getRequiredSecret,
	useRedisCacher,
	getCacherConfig,
	isCookiesSecure,
	trustProxy,
	getClientIp,
	getCookieSameSite,
};
