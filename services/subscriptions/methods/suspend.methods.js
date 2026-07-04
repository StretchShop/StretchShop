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
					// return suspendResult

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
					errorResult.error = "suspendBillingAgreement";
					this.logger.error("subscriptions.suspend - "+errorResult.error+" error: ", JSON.stringify(errorResult));
					self.addToHistory(ctx, subscription._id, self.newHistoryRecord("error", "user", { 
						errorMsg: errorResult.error+" error", 
						error: errorResult
					}));
					return errorResult;
				});
		}
	}
};
