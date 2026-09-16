"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { isNonProductionEnv } = require("./env.helpers");

/**
 * Simple in-memory sliding-window rate limiter for auth endpoints.
 * Prefer edge/nginx limits in production; this is a baseline.
 *
 * Production keeps the call-site limits. Outside production, limits are
 * relaxed unless RATE_LIMIT_STRICT=true (so local E2E can re-run without
 * waiting out login/register windows). Per-action env overrides always win:
 *   RATE_LIMIT_<ACTION>_LIMIT / RATE_LIMIT_<ACTION>_WINDOW_MS
 * e.g. RATE_LIMIT_LOGIN_LIMIT=5, RATE_LIMIT_REGISTER_WINDOW_MS=3600000
 */
const buckets = new Map();

/** Floors applied in non-production when RATE_LIMIT_STRICT is not set. */
const NON_PROD_MIN_LIMITS = {
	login: 100,
	register: 50,
	resetPassword: 20,
	checkUsername: 200,
	checkEmail: 200,
	impersonate: 50,
	restoreAdmin: 100,
};

function pruneBucket(key, windowMs, now) {
	const entries = buckets.get(key);
	if (!entries) {
		return [];
	}
	const kept = entries.filter((ts) => now - ts < windowMs);
	if (kept.length === 0) {
		buckets.delete(key);
	} else {
		buckets.set(key, kept);
	}
	return kept;
}

/**
 * @param {string} actionKey
 * @returns {string}
 */
function actionEnvSuffix(actionKey) {
	return String(actionKey).replace(/([A-Z])/g, "_$1").toUpperCase();
}

/**
 * Resolve effective limit/window: env override > non-prod floor > call-site options.
 * @param {string} actionKey
 * @param {{ limit: number, windowMs: number }} options
 * @returns {{ limit: number, windowMs: number }}
 */
function resolveRateLimitOptions(actionKey, options) {
	const suffix = actionEnvSuffix(actionKey);
	const envLimit = process.env[`RATE_LIMIT_${suffix}_LIMIT`];
	const envWindow = process.env[`RATE_LIMIT_${suffix}_WINDOW_MS`];

	let limit = options?.limit;
	let windowMs = options?.windowMs;

	if (envLimit != null && String(envLimit).trim() !== "") {
		const parsed = parseInt(envLimit, 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			limit = parsed;
		}
	} else if (
		isNonProductionEnv() &&
		process.env.RATE_LIMIT_STRICT !== "true" &&
		NON_PROD_MIN_LIMITS[actionKey] != null
	) {
		limit = Math.max(limit, NON_PROD_MIN_LIMITS[actionKey]);
	}

	if (envWindow != null && String(envWindow).trim() !== "") {
		const parsed = parseInt(envWindow, 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			windowMs = parsed;
		}
	}

	return { limit, windowMs };
}

/**
 * @param {{ key: string, limit: number, windowMs: number, record?: boolean }} args
 * @returns {boolean} true if under limit (request allowed)
 */
function checkRateLimit({ key, limit, windowMs, record = true }) {
	const now = Date.now();
	const kept = pruneBucket(key, windowMs, now);
	if (kept.length >= limit) {
		return false;
	}
	if (record) {
		kept.push(now);
		buckets.set(key, kept);
	}
	return true;
}

/**
 * @param {object} ctx
 * @param {string} suffix
 * @param {string} [extra] optional identity (e.g. login email) so accounts do not share one IP bucket
 * @returns {string}
 */
function clientKey(ctx, suffix, extra) {
	const ip = ctx.meta?.remoteAddress || "unknown";
	const extraPart = extra ? `:${String(extra).toLowerCase().trim()}` : "";
	return `${ip}${extraPart}:${suffix}`;
}

function resetRateLimitBuckets() {
	buckets.clear();
}

function rateLimitError() {
	return new MoleculerClientError("Too many requests", 429, "RATE_LIMIT", []);
}

module.exports = {
	methods: {
		/**
		 * @param {Context} ctx
		 * @param {string} actionKey
		 * @param {{ limit: number, windowMs: number, keyExtra?: string, checkOnly?: boolean }} options
		 *   checkOnly — reject if already at limit without recording this attempt
		 *   (used by login so only failures consume the budget)
		 */
		enforceRateLimit(ctx, actionKey, options) {
			const { limit, windowMs } = resolveRateLimitOptions(actionKey, options);
			const key = clientKey(ctx, actionKey, options?.keyExtra);
			const record = options?.checkOnly !== true;
			if (!checkRateLimit({ key, limit, windowMs, record })) {
				return Promise.reject(rateLimitError());
			}
			return Promise.resolve();
		},

		/**
		 * Record one hit without rejecting (e.g. failed login). No-op if already over limit.
		 * @param {Context} ctx
		 * @param {string} actionKey
		 * @param {{ limit: number, windowMs: number, keyExtra?: string }} options
		 */
		recordRateLimitHit(ctx, actionKey, options) {
			const { limit, windowMs } = resolveRateLimitOptions(actionKey, options);
			const key = clientKey(ctx, actionKey, options?.keyExtra);
			checkRateLimit({ key, limit, windowMs, record: true });
			return Promise.resolve();
		},

		/**
		 * Clear the bucket for this client/action (e.g. after successful login).
		 * @param {Context} ctx
		 * @param {string} actionKey
		 * @param {{ keyExtra?: string }} [options]
		 */
		resetRateLimit(ctx, actionKey, options) {
			const key = clientKey(ctx, actionKey, options?.keyExtra);
			buckets.delete(key);
			return Promise.resolve();
		},
	},
	clientKey,
	checkRateLimit,
	resolveRateLimitOptions,
	resetRateLimitBuckets,
	NON_PROD_MIN_LIMITS,
};
