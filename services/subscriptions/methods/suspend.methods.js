"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	methods: {
		isUserInitiatedSubscriptionCancel(altUser) {
			return !altUser || altUser === "user";
		},

		notifyUserSubscriptionCancelled(ctx, subscription) {
			const siteName = ctx.meta?.siteSettings?.name || process.env.SITE_NAME || "StretchShop";
			return this.sendSubscriptionEmail(ctx, subscription, "subscription/cancelled", {
				subject: siteName + " - Subscription cancelled"
			})
				.catch(err => {
					this.logger.error(
						"subscriptions.notifyUserSubscriptionCancelled - email failed:",
						err?.message || err
					);
					return false;
				});
		},

		suspendSubscription: function(ctx, subscription, relatedId) {
			let self = this;
			let result = { success: false, url: null, message: "error" };
			let altUser = (ctx.params.altUser && ctx.params.altUser.trim()!=="") ? ctx.params.altUser : "user";
			let altMessage = ctx.params.altMessage ? ctx.params.altMessage : "";
			// update agreement
			let paymentType = "online_stripe";
			if (subscription?.data?.order?.data?.paymentData?.codename) {
				paymentType = subscription.data.order.data.paymentData.codename;
			}
			// using suspendPayment to be more universal call
			// TODO - need to setup rules for creating payment names
			let supplier = "stripe";
			if (paymentType=="online_stripe") {
				supplier = "stripe";
			}
			// call suspend action that calls related API
			return ctx.call("orders.paymentSuspend", {
				supplier: supplier,
				relatedId: relatedId,
				subscription: subscription
			})
				.then(suspendResult => {
					if (!suspendResult) {
						return Promise.reject({
							message: "paymentSuspend returned empty result — suspend not confirmed"
						});
					}

					subscription.history.push(
						this.newHistoryRecord("suspended", altUser, {
							relatedOrder: null,
							message: altMessage
						})
					);

					result.success = true;
					result.message = "suspend sent";
					result.data = {
						subscription: subscription,
						agreement: suspendResult
					};

					subscription.id = subscription._id.toString();
					subscription.status = "suspend sent";
					delete subscription._id;
					
					return ctx.call("subscriptions.save", {
						entity: subscription
					})
						.then(updated => {
							this.logger.info("subscriptions.suspend - subscriptions.save:", updated);
							result.data.subscription = updated;
							delete result.data.subscription.history;
							return result;
						})
						.catch(error => {
							this.logger.error("subscriptions.suspend - subscriptions.save error: ", error);
							return null;
						})
						.then(subResult => {
							if (subResult) {
								return this.removeSubscriptionContentDependencies(ctx, subResult.data.subscription)
									.then(updatedUser => {
										this.logger.info("subscriptions.suspend - users.removeContentDependencies updatedUser:", updatedUser);
										return subResult;
									});
							}
						});

				})
				.catch(errorResult => {
					const err = (errorResult && typeof errorResult === "object") ? errorResult : { message: String(errorResult) };
					err.error = "suspendBillingAgreement";
					this.logger.error("subscriptions.suspend - "+err.error+" error: ", JSON.stringify(err));
					self.addToHistory(ctx, subscription._id, self.newHistoryRecord("error", "user", { 
						errorMsg: err.error+" error", 
						error: err
					}));
					// Reject so callers (e.g. 15-min cron) do not treat this as a successful suspend
					return Promise.reject(err);
				});
		},

		getSubscriptionBillingRelatedId(subscription) {
			let relatedId = subscription?.data?.agreementId || null;
			if (!relatedId && subscription?.data?.stripe?.id) {
				relatedId = subscription.data.stripe.id;
			}
			if (!relatedId && subscription?.history?.length > 0) {
				subscription.history.some(record => {
					if (record?.action === "agreed" && record.data?.agreement?.id) {
						relatedId = record.data.agreement.id;
						return true;
					}
				});
			}
			return relatedId || null;
		},

		findBillingRelatedIdInOriginOrder(ctx, subscription) {
			if (!subscription?.orderOriginId) {
				return Promise.resolve(null);
			}
			const subscriptionId = this.idToString(subscription._id || subscription.id);
			return ctx.call("orders.find", {
				query: {
					_id: this.fixStringToId(subscription.orderOriginId)
				},
				limit: 1
			})
				.then(ordersFound => {
					let relatedId = null;
					const ids = ordersFound?.[0]?.data?.subscription?.ids;
					if (ids) {
						ids.some(subscr => {
							if (subscr && String(subscr.subscription) === String(subscriptionId)) {
								relatedId = subscr.supplier?.stripe?.id || subscr.supplier?.id || null;
								return Boolean(relatedId);
							}
						});
					}
					return relatedId;
				})
				.catch(error => {
					this.logger.error("subscriptions.findBillingRelatedIdInOriginOrder - error:", error);
					return null;
				});
		},

		resolveSubscriptionBillingRelatedId(ctx, subscription) {
			const relatedId = this.getSubscriptionBillingRelatedId(subscription);
			if (relatedId) {
				return Promise.resolve(relatedId);
			}
			return this.findBillingRelatedIdInOriginOrder(ctx, subscription);
		},

		getSubscriptionPaymentSupplier(subscription) {
			let paymentType = "online_stripe";
			if (subscription?.data?.order?.data?.paymentData?.codename) {
				paymentType = subscription.data.order.data.paymentData.codename;
			}
			if (paymentType === "online_stripe") {
				return "stripe";
			}
			return "stripe";
		},

		notifyUserSubscriptionReactivated(ctx, subscription) {
			const siteName = ctx.meta?.siteSettings?.name || process.env.SITE_NAME || "StretchShop";
			return this.sendSubscriptionEmail(ctx, subscription, "subscription/reactivated", {
				subject: siteName + " - Subscription reactivated"
			})
				.catch(err => {
					this.logger.error(
						"subscriptions.notifyUserSubscriptionReactivated - email failed:",
						err?.message || err
					);
					return false;
				});
		},

		updateOriginOrderStripeSubscriptionId(ctx, subscription, stripeSubscriptionId) {
			if (!subscription?.orderOriginId || !stripeSubscriptionId) {
				return Promise.resolve(null);
			}
			const subscriptionId = this.idToString(subscription._id || subscription.id);
			return ctx.call("orders.find", {
				query: { _id: this.fixStringToId(subscription.orderOriginId) },
				limit: 1
			})
				.then(ordersFound => {
					const order = ordersFound?.[0];
					if (!order?.data?.subscription?.ids) {
						return null;
					}
					let changed = false;
					order.data.subscription.ids.forEach((idItem, i) => {
						if (String(idItem.subscription) === String(subscriptionId)) {
							if (!order.data.subscription.ids[i].supplier) {
								order.data.subscription.ids[i].supplier = {};
							}
							order.data.subscription.ids[i].supplier.id = stripeSubscriptionId;
							order.data.subscription.ids[i].supplier.status = "active";
							order.data.subscription.ids[i].updated = new Date();
							changed = true;
						}
					});
					if (!changed) {
						return null;
					}
					if (!order.id && order._id) {
						order.id = order._id;
					}
					return ctx.call("orders.updateOrder", { order });
				})
				.catch(error => {
					this.logger.error("subscriptions.updateOriginOrderStripeSubscriptionId - error:", error);
					return null;
				});
		},

		reactivateSubscription(ctx, subscription, relatedId) {
			const result = { success: false, url: null, message: "error" };
			const altUser = (ctx.params.altUser && ctx.params.altUser.trim() !== "") ? ctx.params.altUser : "user";
			const altMessage = ctx.params.altMessage ? ctx.params.altMessage : "";
			const supplier = this.getSubscriptionPaymentSupplier(subscription);

			return ctx.call("orders.paymentReactivate", {
				supplier,
				relatedId,
				subscription
			})
				.then(reactivateResult => {
					if (!reactivateResult?.subscription) {
						return Promise.reject({
							message: "paymentReactivate returned empty result — reactivate not confirmed"
						});
					}

					const stripeSub = reactivateResult.subscription;
					subscription.history.push(
						this.newHistoryRecord("reactivated", altUser, {
							relatedOrder: null,
							message: altMessage,
							stripeId: stripeSub.id,
							resumed: Boolean(reactivateResult.resumed),
							recreated: Boolean(reactivateResult.recreated)
						})
					);

					if (!subscription.data.stripe) {
						subscription.data.stripe = {};
					}
					subscription.data.stripe = stripeSub;
					subscription.status = ["active", "trialing"].includes(stripeSub.status) ? "active" : "agreed";
					subscription.dates = subscription.dates || {};
					subscription.dates.dateUpdated = new Date();
					subscription.dates.dateStopped = null;
					subscription.id = this.idToString(subscription._id || subscription.id);
					delete subscription._id;

					result.success = true;
					result.message = reactivateResult.recreated
						? "reactivate created"
						: (reactivateResult.resumed ? "reactivate resumed" : "reactivate existing");
					result.data = {
						subscription,
						agreement: stripeSub
					};

					return ctx.call("subscriptions.save", {
						entity: subscription
					})
						.then(updated => {
							this.logger.info("subscriptions.reactivate - subscriptions.save:", updated);
							result.data.subscription = updated;
							delete result.data.subscription.history;
							return this.updateOriginOrderStripeSubscriptionId(ctx, updated, stripeSub.id)
								.then(() => result);
						})
						.then(subResult => {
							if (subResult) {
								return this.restoreSubscriptionContentDependencies(ctx, subResult.data.subscription)
									.then(updatedUser => {
										this.logger.info("subscriptions.reactivate - contentDependencies restored:", updatedUser?._id);
										return subResult;
									})
									.catch(error => {
										this.logger.error("subscriptions.reactivate - restore contentDependencies error:", error);
										return subResult;
									});
							}
							return subResult;
						});
				})
				.catch(errorResult => {
					const err = (errorResult && typeof errorResult === "object") ? errorResult : { message: String(errorResult) };
					err.error = "reactivateBillingAgreement";
					this.logger.error("subscriptions.reactivate - " + err.error + " error: ", JSON.stringify(err));
					this.addToHistory(ctx, subscription._id || subscription.id, this.newHistoryRecord("error", "user", {
						errorMsg: err.error + " error",
						error: err
					}));
					return Promise.reject(err);
				});
		}
	}
};
