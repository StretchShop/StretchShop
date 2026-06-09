"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const pathResolve = require("path").resolve;
const { createReadStream } = require("fs-extra");
const { ReadStream } = require("fs");
const jwt = require("jsonwebtoken");
const fetch = require("cross-fetch");
const SettingsMixin = require("../../../mixins/settings.mixin");

module.exports = {
	actions: {
		payment: {
			params: {
				supplier: { type: "string", min: 3 },
				action: { type: "string", min: 3 },
				orderId: { type: "string", min: 3 },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				let self = this;
				// get action to call - get its name from supplier & action params
				const supplier = ctx.params.supplier.toLowerCase();
				let action = ctx.params.action.charAt(0).toUpperCase();
				action += ctx.params.action.slice(1);
				let actionName = supplier + "Order" + action;
				const availablePaymentActions = SettingsMixin.getOriginalSiteSettings("orders")["availablePaymentActions"];

				if (action === "Prepare") {
					return this.adapter.findById(ctx.params.orderId)
						.then(order => {
							const orderPaymentStatus = self.getOrderPaymentStatus(order);
							console.log("orderPaymentStatus: ", JSON.stringify(orderPaymentStatus, null, 2));
							if (["prepared", "running", "completed"].includes(orderPaymentStatus.order.status)) {
								return { success: true, data: null, message: "order_already_prepared" };
							}
							this.logger.info("products status: ", orderPaymentStatus.products?.status, [null, "saved"].includes(orderPaymentStatus.products?.status));
							this.logger.info("subscriptions status: ", orderPaymentStatus.subscriptions?.status,
								(
									["paid", "shipped", "delivered"].includes(orderPaymentStatus.products?.status) ||
									orderPaymentStatus.products?.count === 0
								) &&
								["saved", "failed"].includes(orderPaymentStatus.subscriptions?.status)
							);

							// null if order has products already prepared
							if (
								orderPaymentStatus.products?.count > 0 &&
								[null, "saved"].includes(orderPaymentStatus.products?.status)
							) {
								actionName = supplier + "OrderPaymentintent";
							} else if (
								// if products paid or not exist and subscriptions not exist or failed
								(
									["paid", "shipped", "delivered"].includes(orderPaymentStatus.products?.status) ||
									orderPaymentStatus.products?.count === 0
								) &&
								["saved", "failed"].includes(orderPaymentStatus.subscriptions?.status)
							) { // products are already prepared, but subscription(s) not
								actionName = supplier + "OrderSubscription";
							}

							// using resources/settings/orders.js check if final payment action can be called
							this.logger.info("order.payment #1 - calling payment: ", actionName);
							this.logger.info("order.payment #1 - calling payment2: ", SettingsMixin.getOriginalSiteSettings("orders"));
							if (availablePaymentActions && availablePaymentActions.indexOf(actionName) > -1) {
								this.logger.info("action & order & data: ", actionName, order, ctx.params.data);
								// call action, that accepts already available order
								return ctx.call("orders." + actionName, {
									order,
									data: ctx.params.data
								})
									.then(result => {
										result["paymentStatus"] = orderPaymentStatus;
										return result;
									})
									.catch(error => {
										this.logger.error("order.payment - calling payment error: ", error);
										return null;
									});
							}
						})
						.catch(error => {
							this.logger.error("order.payment - find order error: ", error);
							return this.Promise.reject(new MoleculerClientError("Item not found!", 404));
						});
				}

				// using resources/settings/orders.js check if final payment action can be called
				this.logger.info("order.payment #2 - calling payment: ", actionName);
				this.logger.info("order.payment #2 - calling payment2: ", SettingsMixin.getOriginalSiteSettings("orders"));
				if (availablePaymentActions && availablePaymentActions.indexOf(actionName) > -1) {
					return ctx.call("orders." + actionName, {
						orderId: ctx.params.orderId,
						data: ctx.params.data
					})
						.then(result => {
							return result;
						})
						.catch(error => {
							this.logger.error("order.payment - calling payment error: ", error);
							return null;
						});
				}
			}
		},


		/**
		 * Process result after user paid or agreed and returned to website
		 * 
		 * @actions
		 * 
		 * @param {String} supplier - supplier name (eg. stripe)
		 * @param {String} result - result string
		 * @param {String} PayerID - id of payer
		 * @param {Object} paymentId - id of paymnet
		 * 
		 * @returns {Object} Unified result from related action
		 */
		paymentResult: {
			params: {
				supplier: { type: "string", min: 3 },
				result: { type: "string", min: 3 },
				PayerID: { type: "string", optional: true },
				paymentId: { type: "string", optional: true }
			},
			handler(ctx) {
				let supplier = ctx.params.supplier.toLowerCase();
				let actionName = supplier + "Result";
				let params = {
					result: ctx.params.result,
					PayerID: ctx.params.PayerID,
					paymentId: ctx.params.paymentId
				};
				// token params
				if (ctx.params.token) {
					params.token = ctx.params.token;
				}
				if (ctx.params.ba_token) {
					params.ba_token = ctx.params.ba_token;
				}

				// using resources/settings/orders.js check if final payment action can be called
				if (this.settings.order.availablePaymentActions &&
					this.settings.order.availablePaymentActions.indexOf(actionName) > -1) {
					return ctx.call("orders." + actionName, params)
						.then(result => {
							return result;
						})
						.catch(err => {
							console.error("order.paymentResult *action error: ", err);
							return this.Promise.reject(new MoleculerClientError("Order payment error", 422, "", []));
						});
				}
			}
		},



		/**
		 * Remove orders that have not changed from cart status 
		 * for more than a month
		 */

		paymentSuspend: {
			cache: false,
			auth: "required",
			params: {
				supplier: { type: "string", min: 3 },
				relatedId: { type: "string", min: 3 },
				subscription: { type: "object" }
			},
			handler(ctx) {
				let supplier = (ctx.params.supplier) ? ctx.params.supplier : "stripe";

				this.logger.info("orders.paymentSuspend params: ", ctx.params);

				// get name of action to call for this supplier
				return ctx.call("orders." + supplier + "SuspendBillingAgreement", {
					billingRelatedId: ctx.params.relatedId
				})
					.then(suspendResult => {
						this.logger.info("orders.paymentSuspend supplier call response: ", suspendResult);
						return suspendResult;
					})
					.catch(error => {
						this.logger.error("order.paymentSuspend - error: ", error, JSON.stringify(error));
						return null;
					});
			}
		},


		/**
		 * Mark order as trial
		 * 
		 * Status trial means, all products that are not subscrition type
		 * are paid, but one or more of subscription products are in trial.
		 * 
		 * @actions
		 * 
		 * @param {String} subscriptionId - id of subscription to mark as trial
		 */
		orderSubscriptionTrial: {
			cache: false,
			auth: "required",
			params: {
				subscriptionId: { type: "string" }
			},
			handler(ctx) {
				let self = this;
				let result = { success: false, message: null };
				let subscriptionId = ctx.params.subscriptionId;
				this.logger.info("order.orderSubscriptionTrial - subscriptionId: ", subscriptionId);

				return this.adapter.find({
					query: {
						"subscription.id": subscriptionId
					}
				})
					.then(found => {
						if (found && found.length > 0) {
							let order = found[0];
							order.status = "trial";
							order.dates.dateChanged = new Date();
							order.data.paymentData.lastResponseResult.push({
								description: "Marked as Trial by Admin",
								date: new Date(),
								userId: ctx.meta.user._id.toString()
							});
							let orderId = order._id.toString();
							delete order.id;
							delete order._id;
							const update = {
								"$set": order
							};
							return self.adapter.updateById(orderId, update)
								.then(doc => {
									return this.transformDocuments(ctx, {}, doc);
								})
								.then(json => {
									return this.entityChanged("updated", json, ctx)
										.then(() => {
											self.logger.info("order.orderSubscriptionTrial - trial success: ");
											result.success = true;
											return result;
										})
										.then((orderUpdated) => {
											if (orderUpdated.success) {
												return ctx.call("subscriptions.subscriptionTrial", { subscriptionId: subscriptionId });
											}
										});
								})
								.catch(error => {
									self.logger.error("order.orderSubscriptionTrial - update error: ", error);
									result.message = "error: " + JSON.stringify(error);
									return result;
								});
						} else {
							self.logger.error("order.orderSubscriptionTrial - not found: ", subscriptionId);
							result.message = "error: order not found";
							return result;
						}
					})
					.catch(error => {
						self.logger.error("order.orderSubscriptionTrial - find error: ", error);
						result.message = "error: " + JSON.stringify(error);
						return result;
					});
			}
		}

	}
};
