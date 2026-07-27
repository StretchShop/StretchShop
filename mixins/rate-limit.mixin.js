"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

/**
 * Simple in-memory sliding-window rate limiter for auth endpoints.
 * Prefer edge/nginx limits in production; this is a baseline.
 */
const buckets = new Map();

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

function checkRateLimit({ key, limit, windowMs }) {
	const now = Date.now();
	const kept = pruneBucket(key, windowMs, now);
	if (kept.length >= limit) {
		return false;
	}
	kept.push(now);
	buckets.set(key, kept);
	return true;
}

function clientKey(ctx, suffix) {
	const ip = ctx.meta?.remoteAddress || "unknown";
	return `${ip}:${suffix}`;
}

module.exports = {
	methods: {
		/**
		 * @param {Context} ctx
		 * @param {string} actionKey
		 * @param {{ limit: number, windowMs: number }} options
		 */
		enforceRateLimit(ctx, actionKey, options) {
			const key = clientKey(ctx, actionKey);
			if (!checkRateLimit({ key, ...options })) {
				return Promise.reject(
					new MoleculerClientError("Too many requests", 429, "RATE_LIMIT", [])
				);
			}
			return Promise.resolve();
		},
	},
};
