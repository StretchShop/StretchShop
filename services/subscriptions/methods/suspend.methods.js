"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	methods: {
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
		}
	}
};
