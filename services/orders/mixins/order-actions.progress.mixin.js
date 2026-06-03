"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const pathResolve = require("path").resolve;
const { createReadStream } = require("fs-extra");
const { ReadStream } = require("fs");
const jwt = require("jsonwebtoken");
const fetch = require("cross-fetch");

module.exports = {
	actions: {
		progress: {
			// auth: "required",
			cache: false,
			params: {
				orderParams: { type: "object", optional: true },
			},
			handler(ctx) {
				this.logger.info("order.progress - ctx.params: ", ctx.params);
				ctx.params.orderParams = (typeof ctx.params.orderParams === "undefined" || !ctx.params.orderParams) ? {} : ctx.params.orderParams;
				this.logger.info("order.progress - ctx.params.orderParams: ", ctx.params.orderParams);
				// remove stripeKey if forgotten
				if (
					ctx.params.orderParams?.settings?.stripeKey
				) {
					delete ctx.params.orderParams.settings.stripeKey;
				}
				// this.logger.info("orders.progress - ctx.meta: ", ctx.meta);
				return ctx.call("cart.me", {}, { meta: ctx.meta })
					.then(cart => {
						this.logger.info("order.progress - Cart Result:", cart);
						if (cart.order && cart.order.toString().trim()!="") { // order exists, get it
							return this.adapter.findById(cart.order)
								.then(order => {
									this.logger.info("order.progress - Order Result:", order);
									return this.getOrderProgressAction(ctx, cart, order);
								}); // order found in db END

						} else { // order does not exist, create it
							this.logger.info("order.progress - no order found, CREATE order");
							return this.createOrderAction(cart, ctx, this.adapter);
						}
					})
					.catch(err => {
						console.error("orders.progress cart.me error: ", err);
						return this.Promise.reject(new MoleculerClientError("Order cart error", 422, "", []));
					}); // cart end
			}
		},


		/**
		 * Insert order from object sent - with recalculating the prices
		 * 
		 * @param {Object} order
		 * 
		 * @returns {Object} saved order
		 */
	}
};
