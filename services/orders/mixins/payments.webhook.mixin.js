"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
		/**
		 * SUBSCRIPTION FLOW - 3.1 (API->BE)
		 * Webhook endpoint for payment providers, that DON'T need raw body
		 * 
		 * @param {String} - name of supplier
		 * 
		 * @returns {Object} specific response required by provider
		 */
		paymentWebhook: {
			params: {
				supplier: { type: "string", min: 3 }
			},
			handler(ctx) {
				const supplier = ctx.params.supplier?.toLowerCase();
				this.logger.info("orders.paymentWebhook supplier:", supplier);
				let actionName = supplier+"Webhook";

				// using resources/settings/orders.js check if final payment action can be called
				if ( this.settings.order.availablePaymentActions &&
				this.settings.order.availablePaymentActions.indexOf(actionName)>-1 ) {
					return ctx.call("orders."+actionName, {
						data: ctx.params
					})
						.then(result => {
							return result;
						});
				}
			}
		},


		/**
		 * Webhook endpoint for payment providers, that NEED raw body (eg. stripe)
		 * 
		 * @param {String} - name of supplier
		 * 
		 * @returns {Object} specific response required by provider
		 */
		paymentWebhookRaw: {
			handler(ctx) {
				if (!ctx.params) { ctx.params = { params: {} }; }
				if (!ctx.params.params) { ctx.params.params = { supplier: "stripe" }; }
				ctx.params.params["supplier"] = "stripe";

				if (!ctx.params.body) {
					return Promise.reject(new MoleculerClientError("Webhook error", 400, "", [{ field: "request body", message: "not found"}]));
				}

				let supplier = ctx.params.params.supplier.toLowerCase();
				let actionName = supplier+"Webhook";

				this.logger.info("orders.paymentWebhookRaw supplier:", supplier);

				// using resources/settings/orders.js check if final payment action can be called
				if ( this.settings.order.availablePaymentActions &&
				this.settings.order.availablePaymentActions.indexOf(actionName)>-1 ) {
					return ctx.call("orders."+actionName, {
						data: ctx.meta.rawbody
					})
						.then(result => {
							return result;
						});
				}
			}
		},
	},


	methods: {

	}
};
