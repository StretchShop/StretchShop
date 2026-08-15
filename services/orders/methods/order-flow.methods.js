"use strict";

require("dotenv").config();
const passGenerator = require("generate-password");
const fetch = require("cross-fetch");
const jwt = require("jsonwebtoken");
const handlebars = require("handlebars");
const { writeFileSync, ensureDir, createWriteStream } = require("fs-extra");
const pathResolve = require("path").resolve;
const SettingsMixin = require("../../../mixins/settings.mixin");
const PdfPrintMixin = require("../../../mixins/pdfprint.mixin");
const { subscriptionPaymentStatuses } = require("../constants/subscription.constants");
const { productStatuses } = require("../constants/product.constants");
const { orderStatuses } = require("../constants/order.constants");
const { update } = require("lodash");

const calcExcludedTypes = ["subscription"];

module.exports = {
	methods: {
		orderAfterSaveActions(ctx, orderProcessedResult) {
			let self = this;

			// 1. if set url, send order. If no url or send was success, set status to Sent.
			this.logger.info("orders.orderAfterSaveActions() - this.settings.order.sendingOrder: ", this.settings.order.sendingOrder);
			if ( this.settings.order.sendingOrder && this.settings.order.sendingOrder.url && this.settings.order.sendingOrder.url.toString().trim()!="" ) {
				let auth = "Basic " + Buffer.from(this.settings.order.sendingOrder.login + ":" + this.settings.order.sendingOrder.password).toString("base64");
				let sendingUrl;
				try {
					sendingUrl = new URL(this.settings.order.sendingOrder.url);
				} catch(e) {
					this.logger.error("orders.orderAfterSaveActions() - invalid sendingOrder URL:", e);
					return orderProcessedResult;
				}
				if (sendingUrl.protocol !== "https:") {
					this.logger.error("orders.orderAfterSaveActions() - sendingOrder URL must use https protocol");
					return orderProcessedResult;
				}
				return fetch(sendingUrl.origin + sendingUrl.pathname + "?action=order", {
					method: "post",
					body:    JSON.stringify({"shopId": process.env.SITE_NAME,"order":orderProcessedResult.order}),
					headers: { "Content-Type": "application/json", "Authorization": auth },
				})
					.then(res => res.json()) // expecting a json response, checking it
					.then(orderSentResponse => {
						this.logger.info("orders.orderAfterSaveActions() - orderSentResponse: ", orderSentResponse);
						// check if response has the most important information about how order was processed
						if ( orderSentResponse.type && orderSentResponse.type=="success" &&
						orderSentResponse.result && orderSentResponse.result.status &&
						orderSentResponse.result.order ) {
							// order SENT, response type is success
							// if response is SUCCESS, nothing has to be changed by user, return original order
							if ( orderSentResponse.result.status=="accepted" ) {
								// process response
								let updatedOrder = this.processResponseOfOrderSent(orderProcessedResult.order, orderSentResponse.result.order);
								// actions that don't change order - 2. clear cart + 3. send email
								return self.orderAfterAcceptedActions(ctx, updatedOrder)
									.then(success => {
										if ( success ) {
											orderProcessedResult.order = updatedOrder;
											if (orderProcessedResult.order.status != "paid") {
												orderProcessedResult.order.status = "sent";
											}
											orderProcessedResult.order.dates.emailSent = new Date();
											// save with sent status and email sent date after it
											return this.adapter.updateById(orderProcessedResult.order._id, self.prepareForUpdate(orderProcessedResult.order))
												.then(() => { //(orderUpdated)
													this.entityChanged("updated", orderProcessedResult.order, ctx);
													return orderProcessedResult;
												});
										}
									});
							} else {
								// response is CHANGED or REJECTED - send response without changes to front-side so user makes decision
								return orderProcessedResult;
							}
						} else { // something is wrong with order data or server
							// return original response, but add error
							if ( !orderSentResponse.errors ) {
								orderSentResponse.errors = [];
							}
							orderSentResponse.errors.push({"value": "Server", "desc": "bad response"});
							return orderSentResponse;
						}
					})
					.catch(orderSentError => {
						this.logger.error("orders.orderAfterSaveActions.fetch ERROR:", orderSentError);
					});
			} else { // no url to send
				this.logger.info("orders.orderAfterSaveActions() - NO URL TO SEND");
				// 2. clear cart + 3. send email
				return self.orderAfterAcceptedActions(ctx, orderProcessedResult.order)
					.then(success => {
						if ( success ) {
							orderProcessedResult.order.dates.emailSent = new Date();
							// save after it
							return orderProcessedResult;
						}
					});
			}
		},


		/**
		 * This function verifies data from sent response, and if they were
		 * updated, it defines the logic of what new data will be used and what
		 * remains same.
		 * This implementation represents the most conservative version - changes
		 * only amount of cart items. It's up to business model if any more liberal
		 * approach is needed. But be carefull to not create backdoors.
		 * 
		 * @param {Object} orderOriginal 
		 * @param {Object} orderResponse 
		 * 
		 * @returns {Object} processed order
		 */
		processResponseOfOrderSent(orderOriginal, orderResponse) {
			if ( orderOriginal && orderResponse ) {
				// update externalIds
				if ( orderResponse.externalId && orderResponse.externalId.toString().trim()!="" ) {
					orderOriginal.externalId = orderResponse.externalId;
				}
				if ( orderResponse.externalCode && orderResponse.externalCode.toString().trim()!="" ) {
					orderOriginal.externalCode = orderResponse.externalCode;
				}
				// update items
				if ( orderOriginal.items && orderOriginal.items.length>0 &&
				orderResponse.items && orderResponse.items.length>0 &&
				orderOriginal.items.length==orderResponse.items.length ) {
					Object.keys(orderOriginal.items).forEach(function(key){
						/** items of both orders must satisfy these rules:
						 *   - response must have items,
	 					 *   - both orders' items must have same value of ._id property on same array position,
						 *   - both orders' items must have .amount property
						 */
						if ( orderResponse.items[key] &&
						orderOriginal.items[key]._id && orderResponse.items[key]._id &&
						orderResponse.items[key]._id==orderResponse.items[key]._id &&
						orderOriginal.items[key].amount && orderResponse.items[key].amount ) {
							// if it has responseAction set
							if ( orderOriginal.items[key].responseAction ) {
								if ( orderOriginal.items[key].responseAction=="updated" ) {
									orderOriginal.items[key].amount = orderResponse.items[key].amount;
								} else if ( orderOriginal.items[key].responseAction=="rejected" ) {
									orderOriginal.items[key].amount = 0;
								}
							}
						}
					});
				}
			}

			return orderOriginal;
		},



		/**
		 * Actions to perform after order was sent and accepted.
		 * It is used by manual (user) and also automated order (subscriptions)
		 *
		 * @returns {Boolean}
		 */
		orderAfterAcceptedActions(ctx, order) {
			if (!order) {
				return false;
			}

			this.logger.info("orders.orderAfterAcceptedActions() - order:", order._id);
			// 1. clear the cart
			return ctx.call("cart.delete")
				.then(() => { //(cart)

					// 2. send email about order
					this.sendOrderedEmail(ctx, order);

					// 3. process any subscriptions of order
					if (order.data && 
						(!order.data.subscription || order.data.subscription==null) && 
						order.items && order.items.length>0 ) {
						let hasSubscriptions = false;
						order.items.some(item => {
							if (item.type === "subscription") {
								hasSubscriptions = true;
							}
						});
						if (hasSubscriptions && !order.data.subscription) {
							return ctx.call("subscriptions.orderToSubscription", {order} )
								.then(subscriptions => {
									// save subscription data to order
									this.logger.info("order.orderAfterAcceptedActions orderToSubscription saved subscription IDs", subscriptions);
									if (subscriptions && subscriptions.length>0) {
										return true;
									}
									return false;
								})
								.catch(err => {
									this.logger.error("order.orderAfterAcceptedActions orderToSubscription err:", err);
								});
						}
					}

					this.logger.info("order.orderAfterAcceptedActions no subscriptions");
					return true;
				});
		},


		/**
		 * Send email after order was sent
		 * 
		 * @param {Object} ctx 
		 * @param {Object} order 
		 * 
		 * @returns {Boolean}
		 */
	}
};
