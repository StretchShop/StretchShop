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
				const supplier = ctx.params.supplier.toLowerCase();
				let action = ctx.params.action.charAt(0).toUpperCase();
				action += ctx.params.action.slice(1);
				let actionName = supplier + "Order" + action;
				const availablePaymentActions = SettingsMixin.getOriginalSiteSettings("orders")["availablePaymentActions"];

				const assertPaymentAccess = (order) => {
					if (!order) {
						return Promise.reject(new MoleculerClientError("Item not found!", 404));
					}
					const uid = ctx.meta.user?._id?.toString();
					const isAdmin = ctx.meta.user?.type === "admin";
					const isOwner = uid && order.user?.id?.toString() === uid;
					if (isAdmin || isOwner) {
						return Promise.resolve(order);
					}
					// Guest checkout: order_no_verif JWT must match order user
					const guestToken = ctx.meta.cookies?.["order_no_verif"];
					if (guestToken) {
						try {
							const decoded = jwt.verify(guestToken, this.settings.JWT_SECRET);
							const guestId = decoded?.id?.toString();
							const guestEmail = decoded?.email;
							if (
								(guestId && guestId === order.user?.id?.toString()) ||
								(guestEmail && guestEmail === order.user?.email)
							) {
								return Promise.resolve(order);
							}
						} catch (e) {
							this.logger.warn("orders.payment - invalid order_no_verif token");
						}
					}
					return Promise.reject(new MoleculerClientError("Forbidden", 403));
				};

				if (action === "Prepare") {
					return this.adapter.findById(ctx.params.orderId)
						.then(order => assertPaymentAccess(order))
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
								(
									["paid", "shipped", "delivered"].includes(orderPaymentStatus.products?.status) ||
									orderPaymentStatus.products?.count === 0
								) &&
								["saved", "failed"].includes(orderPaymentStatus.subscriptions?.status)
							) {
								actionName = supplier + "OrderSubscription";
							}

							this.logger.info("order.payment #1 - calling payment: ", actionName);
							this.logger.info("order.payment #1 - calling payment2: ", SettingsMixin.getOriginalSiteSettings("orders"));
							if (availablePaymentActions && availablePaymentActions.indexOf(actionName) > -1) {
								this.logger.info("action & order & data: ", actionName, order, ctx.params.data);
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
							if (error instanceof MoleculerClientError) {
								return Promise.reject(error);
							}
							this.logger.error("order.payment - find order error: ", error);
							return this.Promise.reject(new MoleculerClientError("Item not found!", 404));
						});
				}

				this.logger.info("order.payment #2 - calling payment: ", actionName);
				this.logger.info("order.payment #2 - calling payment2: ", SettingsMixin.getOriginalSiteSettings("orders"));
				if (availablePaymentActions && availablePaymentActions.indexOf(actionName) > -1) {
					return this.adapter.findById(ctx.params.orderId)
						.then(order => assertPaymentAccess(order))
						.then(() => ctx.call("orders." + actionName, {
							orderId: ctx.params.orderId,
							data: ctx.params.data
						}))
						.then(result => {
							return result;
						})
						.catch(error => {
							if (error instanceof MoleculerClientError) {
								return Promise.reject(error);
							}
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
						if (!suspendResult) {
							return Promise.reject(new MoleculerClientError(
								"Payment suspend returned empty result",
								422,
								"PAYMENT_SUSPEND_EMPTY",
								[]
							));
						}
						return suspendResult;
					})
					.catch(error => {
						this.logger.error("order.paymentSuspend - error: ", error, JSON.stringify(error));
						// Propagate failure — callers must not treat suspend as confirmed
						return Promise.reject(error);
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
				if (ctx.meta.user?.type !== "admin") {
					return Promise.reject(new MoleculerClientError("Forbidden", 403));
				}
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
