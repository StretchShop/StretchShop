"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
		suspend: {
			cache: false,
			auth: "required",
			params: {
				subscriptionId: { type: "string" },
				altUser: { type: "string", optional: true },
				altMessage: { type: "string", optional: true }
			},
			handler(ctx) {
				let result = { success: false, url: null, message: "error" };
				let altUser = (ctx.params.altUser && ctx.params.altUser.trim() !== "") ? ctx.params.altUser : "user";
				let altMessage = ctx.params.altMessage ? ctx.params.altMessage : "";
				let self = this;
				let filter = {
					query: {
						_id: this.fixStringToId(ctx.params.subscriptionId)
					},
					limit: 1
				};

				// update filter acording to user
				if (ctx.meta.user?.type == "admin") {
					// admin can browse all orders
				} else {
					filter.query["user.id"] = ctx.meta.user._id.toString();
				}

				// find subscription
				return ctx.call("subscriptions.find", filter)
					.then(found => {
						this.logger.info("subscriptions.suspend found:", filter, found);
						if (found?.[0]) {
							found = found[0];
							// set status to "suspend request"
							found.status = "suspend request";
							found.dates["dateStopped"] = new Date();
							found.history.push(
								this.newHistoryRecord(found.status, altUser, {
									relatedOrder: null,
									message: altMessage
								})
							);

							let relatedId = found.data.agreementId;
							// get agreement ID from history
							this.logger.info("subscriptions.suspend stripe.id:", found.data.stripe, (found.data.stripe && found.data.stripe?.id), (!relatedId || relatedId == null));

							if (!relatedId || relatedId == null) {
								if (found.data.stripe?.id) {
									relatedId = found.data.stripe.id;
								} else if (found.history && found.history.length > 0) {
									found.history.some(record => {
										if (record?.action == "agreed" && record.record.data?.agreement?.id) {
											relatedId = record.data.agreement.id;
											return true;
										}
									});
								}
							}
							if (!relatedId || relatedId == null) {
								ctx.call("orders.find", {
									query: {
										_id: self.fixStringToId(found.orderOriginId)
									},
									limit: 1
								})
									.then(ordersFound => {
										if (ordersFound?.[0]?.data?.subscription?.ids) {
											ordersFound[0].data.subscription.ids.some(subscr => {
												if (subscr && subscr.subscription == found._id.toString() && subscr.supplier && subscr.supplier.stripe && subscr.supplier.stripe.id) {
													relatedId = subscr.supplier.stripe.id;
													return self.suspendSubscription(ctx, found, relatedId);
												}
											});
										}
									})
									.catch(error => {
										this.logger.error("subscriptions.suspend - orders.find error: ", error);
									});
							}
							this.logger.info("subscriptions.suspend relatedId:", relatedId);

							// FIX - NO relatedId with Stripe 
							if (relatedId && relatedId !== null) {
								return self.suspendSubscription(ctx, found, relatedId)
									.then(result => {
										if (
											self.isUserInitiatedSubscriptionCancel(altUser) &&
											result?.success &&
											result?.message === "suspend sent"
										) {
											const subscriptionForEmail = result.data?.subscription || found;
											return self.notifyUserSubscriptionCancelled(ctx, subscriptionForEmail)
												.then(() => result);
										}
										return result;
									});
							} else {
								result.error = "relatedId not found";

								const subscriptionId = this.idToString(found._id) || ctx.params.subscriptionId;

								return ctx.call("subscriptions.update", {
									updateObject: {
										id: subscriptionId,
										status: "suspend cleanup"
									},
									historyRecordToAdd: self.newHistoryRecord("suspend cleanup", altUser, {
										relatedOrder: null,
										message: altMessage,
										errorMsg: result.error + " error"
									})
								})
									.then(updated => {
										this.logger.info("subscriptions.suspend - relatedId not found - subscription updated:", updated);
										result.success = true;
										result.message = "subscription suspended, as it was expired and relatedId was not found";
										return result;
									})
									.catch(error => {
										this.logger.error("subscriptions.suspend - subscriptions.update error: ", error);
									});
							}
						}
					});
			}
		},


		reactivate: {
			cache: false,
			auth: "required",
			params: {
				subscriptionId: { type: "string" },
				altUser: { type: "string", optional: true },
				altMessage: { type: "string", optional: true }
			},
			handler(ctx) {
				const result = { success: false, url: null, message: "error" };
				const altUser = (ctx.params.altUser && ctx.params.altUser.trim() !== "") ? ctx.params.altUser : "user";
				const altMessage = ctx.params.altMessage ? ctx.params.altMessage : "";
				const self = this;
				const filter = {
					query: {
						_id: this.fixStringToId(ctx.params.subscriptionId)
					},
					limit: 1
				};

				if (ctx.meta.user?.type !== "admin") {
					filter.query["userId"] = ctx.meta.user._id.toString();
				}

				return ctx.call("subscriptions.find", filter)
					.then(found => {
						this.logger.info("subscriptions.reactivate found:", filter, found);
						if (!found?.[0]) {
							return this.Promise.reject(new MoleculerClientError("Subscription not found", 404, "", []));
						}
						found = found[0];
						const reactivatable = [
							"suspend sent", "suspend request", "suspend cleanup",
							"stopped", "canceled", "paused"
						];
						if (
							(found.status === "active" || found.status === "trialing") &&
							!found.data?.stripe?.pause_collection
						) {
							result.success = true;
							result.message = "already active";
							result.data = { subscription: found };
							return result;
						}
						if (!reactivatable.includes(found.status) && !found.data?.stripe?.pause_collection) {
							return this.Promise.reject(new MoleculerClientError(
								"Subscription cannot be reactivated from status " + found.status,
								422,
								"INVALID_STATUS",
								[]
							));
						}

						found.status = "reactivate request";
						found.dates = found.dates || {};
						found.dates.dateUpdated = new Date();
						found.history = found.history || [];
						found.history.push(
							this.newHistoryRecord(found.status, altUser, {
								relatedOrder: null,
								message: altMessage
							})
						);

						return self.resolveSubscriptionBillingRelatedId(ctx, found)
							.then(relatedId => {
								this.logger.info("subscriptions.reactivate relatedId:", relatedId);
								if (!relatedId) {
									return this.Promise.reject(new MoleculerClientError(
										"Stripe billing id not found — cannot reactivate",
										422,
										"RELATED_ID_NOT_FOUND",
										[]
									));
								}
								return self.reactivateSubscription(ctx, found, relatedId)
									.then(reactivateResult => {
										if (
											self.isUserInitiatedSubscriptionCancel(altUser) &&
											reactivateResult?.success
										) {
											const subscriptionForEmail = reactivateResult.data?.subscription || found;
											return self.notifyUserSubscriptionReactivated(ctx, subscriptionForEmail)
												.then(() => reactivateResult);
										}
										return reactivateResult;
									});
							});
					});
			}
		},


		pause: {
			cache: false,
			auth: "required",
			params: {
				subscriptionId: { type: "string" },
				altUser: { type: "string", optional: true },
				altMessage: { type: "string", optional: true }
			},
			handler(ctx) {
				const result = { success: false, url: null, message: "error" };
				const altUser = (ctx.params.altUser && ctx.params.altUser.trim() !== "") ? ctx.params.altUser : "user";
				const altMessage = ctx.params.altMessage ? ctx.params.altMessage : "";
				const self = this;
				const filter = {
					query: {
						_id: this.fixStringToId(ctx.params.subscriptionId)
					},
					limit: 1
				};

				if (ctx.meta.user?.type !== "admin") {
					filter.query["userId"] = ctx.meta.user._id.toString();
				}

				return ctx.call("subscriptions.find", filter)
					.then(found => {
						this.logger.info("subscriptions.pause found:", filter, found);
						if (!found?.[0]) {
							return this.Promise.reject(new MoleculerClientError("Subscription not found", 404, "", []));
						}
						found = found[0];
						if (found.status === "paused") {
							result.success = true;
							result.message = "already paused";
							result.data = { subscription: found };
							return result;
						}
						const pausable = ["active", "trialing", "agreed"];
						if (!pausable.includes(found.status)) {
							return this.Promise.reject(new MoleculerClientError(
								"Subscription cannot be paused from status " + found.status,
								422,
								"INVALID_STATUS",
								[]
							));
						}

						found.status = "pause request";
						found.dates = found.dates || {};
						found.dates.dateUpdated = new Date();
						found.history = found.history || [];
						found.history.push(
							this.newHistoryRecord(found.status, altUser, {
								relatedOrder: null,
								message: altMessage
							})
						);

						return self.resolveSubscriptionBillingRelatedId(ctx, found)
							.then(relatedId => {
								this.logger.info("subscriptions.pause relatedId:", relatedId);
								if (!relatedId) {
									return this.Promise.reject(new MoleculerClientError(
										"Stripe billing id not found — cannot pause",
										422,
										"RELATED_ID_NOT_FOUND",
										[]
									));
								}
								return self.pauseSubscription(ctx, found, relatedId)
									.then(pauseResult => {
										if (
											self.isUserInitiatedSubscriptionCancel(altUser) &&
											pauseResult?.success
										) {
											const subscriptionForEmail = pauseResult.data?.subscription || found;
											return self.notifyUserSubscriptionPaused(ctx, subscriptionForEmail)
												.then(() => pauseResult);
										}
										return pauseResult;
									});
							});
					});
			}
		},


	}
};
