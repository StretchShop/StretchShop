"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const SettingsMixin = require("../../../mixins/settings.mixin");
const {
	isBankTransferConfigured,
	buildBankTransferQr,
} = require("../../../modules/payments/bank-transfer-qr");

function isDevelopmentEnv() {
	return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dockerdev";
}

module.exports = {
	actions: {
		/**
		 * Development preview of the bank-transfer QR for an order `_id`.
		 * Returns the SVG. Any other environment responds as if the route does not exist.
		 */
		bankTransferQrDev: {
			cache: false,
			openapi: false,
			params: {
				orderId: { type: "string", min: 1 },
			},
			handler(ctx) {
				if (!isDevelopmentEnv()) {
					return Promise.reject(new MoleculerClientError("Not found", 404));
				}
				return this.adapter.findById(ctx.params.orderId)
					.then((order) => {
						if (!order) {
							return Promise.reject(new MoleculerClientError("Not found", 404));
						}
						const business = SettingsMixin.getSiteSettings("business");
						if (!isBankTransferConfigured(business)) {
							return Promise.reject(new MoleculerClientError("Bank account is not configured", 422));
						}
						return buildBankTransferQr({ order, business });
					})
					.then((result) => {
						if (!result?.svg) {
							return result;
						}
						ctx.meta.$responseType = "image/svg+xml; charset=utf-8";
						return result.svg;
					});
			},
		},
	},
	methods: {
		/**
		 * Generate a bank-transfer QR SVG and store it on the order.
		 * Persists `data.paymentData.lastQr` when the order already has an id.
		 *
		 * @param {*} order
		 * @returns {Promise<*>}
		 */
		generateBankTransferQr(order) {
			if (order?.data?.paymentData?.codename !== "bank_transfer") {
				return Promise.resolve(order);
			}
			const business = SettingsMixin.getSiteSettings("business");
			if (!isBankTransferConfigured(business)) {
				return Promise.resolve(order);
			}
			return buildBankTransferQr({ order, business })
				.then((result) => {
					order.data.paymentData.lastQr = result.svg;
					order.data.paymentData.bankAccount = result.bankAccount;
					const orderId = order._id || order.id;
					if (!orderId || typeof this.adapter?.updateById !== "function") {
						return order;
					}
					return this.adapter.updateById(this.idToString(orderId), {
						$set: {
							"data.paymentData.lastQr": result.svg,
							"data.paymentData.bankAccount": result.bankAccount,
						},
					}).then(() => order);
				})
				.catch((error) => {
					this.logger?.error("orders.generateBankTransferQr() - failed:", error);
					return order;
				});
		},
	},
};
