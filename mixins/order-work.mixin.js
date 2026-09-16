"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

const orderWorkAls = new AsyncLocalStorage();

function emptyOrderErrors() {
	return {
		itemErrors: [],
		userErrors: [],
		orderErrors: [],
	};
}

function createOrderWorkStore() {
	return {
		orderTemp: {},
		orderErrors: emptyOrderErrors(),
	};
}

function attachStore(ctx, store) {
	if (!ctx) {
		return store;
	}
	ctx._orderWork = store;
	if (!ctx.locals || typeof ctx.locals !== "object") {
		ctx.locals = {};
	}
	ctx.locals.orderWork = store;
	return store;
}

module.exports = {
	methods: {
		/**
		 * Run checkout work with per-request order draft/errors (never on this.settings).
		 * The store lives on ctx.locals / ctx._orderWork so it survives Moleculer ctx.copy
		 * without leaking PII through ctx.meta.
		 * @param {object|Function} ctxOrFn
		 * @param {Function} [fn]
		 * @returns {*}
		 */
		withOrderWork(ctxOrFn, fn) {
			const callback = typeof ctxOrFn === "function" ? ctxOrFn : fn;
			const ctx = typeof ctxOrFn === "function" ? { meta: {}, locals: {} } : ctxOrFn;
			const store = createOrderWorkStore();
			attachStore(ctx, store);
			return orderWorkAls.run(store, callback);
		},

		/**
		 * Per-request order draft + errors.
		 * @param {object} [ctx]
		 * @returns {{ orderTemp: object, orderErrors: object }}
		 */
		getOrderWork(ctx) {
			if (ctx?._orderWork) {
				return ctx._orderWork;
			}
			if (ctx?.locals?.orderWork) {
				return ctx.locals.orderWork;
			}
			const store = orderWorkAls.getStore();
			if (store) {
				if (ctx) {
					attachStore(ctx, store);
				}
				return store;
			}
			if (ctx) {
				return attachStore(ctx, createOrderWorkStore());
			}
			return createOrderWorkStore();
		},
	},
};
