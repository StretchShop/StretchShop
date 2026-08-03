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
				let altUser = (ctx.params.altUser && ctx.params.altUser.trim()!=="") ? ctx.params.altUser : "user";
				let altMessage = ctx.params.altMessage ? ctx.params.altMessage : "";
				let self = this;
				let filter = { 
					query: { 
						_id: this.fixStringToId(ctx.params.subscriptionId) 
					}, 
					limit: 1
				};

				// update filter acording to user
				if ( ctx.meta.user?.type == "admin" ) {
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
							this.logger.info("subscriptions.suspend stripe.id:", found.data.stripe, (found.data.stripe && found.data.stripe?.id), ( !relatedId || relatedId==null ));

							if ( !relatedId || relatedId==null ) {
								if (found.data.stripe?.id) {
									relatedId = found.data.stripe.id;
								} else if (found.history && found.history.length>0) {
									found.history.some(record => {
										if (record?.action == "agreed" && record.record.data?.agreement?.id) {
											relatedId = record.data.agreement.id;
											return true;
										}
									});
								}
							}
							if ( !relatedId || relatedId==null ) {
								ctx.call("orders.find", {
									query: {
										_id: self.fixStringToId(found.orderOriginId)
									},
									limit: 1
								})
									.then(ordersFound => {
										if (ordersFound?.[0]?.data?.subscription?.ids) {
											ordersFound[0].data.subscription.ids.some(subscr => {
												if (subscr && subscr.subscription==found._id.toString() && subscr.supplier && subscr.supplier.stripe && subscr.supplier.stripe.id) {
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
								return self.suspendSubscription(ctx, found, relatedId);
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
										errorMsg: result.error+" error"
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



		/**
		 * 
		 * @param {String} period 
		 * @param {Number} duration 
		 * 
		 * @returns {Date} date of next order
		 */
	}
};
