"use strict";

const { MoleculerClientError } = require("moleculer").Errors;


module.exports = {
	methods: {
		createPaidSubscriptionOrder(ctx, subscription) {
			let newOrder = Object.assign({}, subscription.data.order);
			newOrder.status = "paid";
			const today = new Date();

			return ctx.call("orders.create", {order: newOrder} )
				.then(orderResult => {
					this.logger.info("subscriptions.service createPaidSubscriptionOrder orderResult: ", JSON.stringify(orderResult));
					let dateEnd = new Date(subscription.dates.dateEnd);
					orderResult.dates.datePaid = today;
					if ( dateEnd > today ) {
						// set new value for dateOrderNext
						subscription.dates.dateOrderNext = this.calculateDateOrderNext(
							subscription.period,
							subscription.duration
						);
					} else {
						subscription.status = "finished";
					}
					subscription.history.push( 
						{
							action: "prolonged",
							type: "automatic",
							date: new Date(),
							relatedOrder: orderResult._id.toString()
						} 
					);
					return this.adapter.updateById(subscription._id, this.prepareForUpdate(subscription))
						.then(subscriptionUpdated => {
							return {
								subscription: subscriptionUpdated,
								order: orderResult
							};
						});
				});
		},


		/**
		 * 
		 * @param {Object} ctx 
		 * @param {Object} subscription 
		 */
		sendSubscriptionEmail(ctx, subscription, template) {
			const siteName = ctx.meta.siteSettings?.name || process.env.SITE_NAME || "StretchShop";
			// configuring email message
			let emailSetup = {
				settings: {
					to: [subscription.data.order.user.email, process.env.SITE_SUPPORT_EMAIL],
					subject: siteName + " - Subscription update"
				},
				functionSettings: {
					language: subscription.data.order.user.settings.language
				},
				template: template,
				data: {
					webname: siteName,
					username: subscription.data.order.user.username,
					email: subscription.data.order.user.email, 
					subscription: subscription, 
					support_email: ctx.meta.siteSettings?.supportEmail || process.env.SITE_SUPPORT_EMAIL
				}
			};
			// Return the promise so callers can stop a batch after SMTP auth failure
			return ctx.call("users.sendEmail", emailSetup)
				.then(json => {
					this.logger.info("subscriptions.sendSubscriptionEmail - email sent:", json);
					return json;
				})
				.catch(err => {
					this.logger.error(
						"subscriptions.sendSubscriptionEmail - failed:",
						err?.message || err
					);
					return Promise.reject(err);
				});
		},


		setDateOrderNextAfterTrial(
			dateOrderNext,
			period,
			duration,
			cyclesTrial
		) {
			switch (period) {
				case "day":
					dateOrderNext = this.addDays(dateOrderNext, duration * cyclesTrial); // add a day(s)
					break;
				case "week": 
					dateOrderNext = this.addDays(dateOrderNext, duration * 7 * cyclesTrial); // add a week(s)
					return;
				case "month":
					dateOrderNext = this.addMonths(dateOrderNext, duration); // add month(s)
					break;
				default: // year
					dateOrderNext.setFullYear(dateOrderNext.getFullYear() + (duration * dateOrderNext) ); // add years
					break;
				}

			return dateOrderNext;
		},


		/**
		 * For CRON - check for ended but active subscriptions and stop them
		 * 
		 * @param {Object} ctx
		 * 
		 * @returns {Promise}
		 */
		stopEndedActiveSubscriptions(ctx) {
			let promises = [];
			let self = this;
			let checkDate = new Date();
			const daysTolerance = process?.env?.SUBS_DAYS_TOLERANCE || 1;
			checkDate.setDate(checkDate.getDate() - daysTolerance);
			// NOTE: set user as admin so "subscription.suspend" action can be done
			if (typeof ctx.meta.user === "undefined") {
				ctx.meta.user = { type: "admin" };
			}
			if (typeof ctx.meta.user.type === "undefined" || ctx.meta.user.type == null) {
				ctx.meta.user.type = "admin";
			}
			// get dateOrder for today (- days of tolerance) and less
			// NOTE - $or for case we have subscription, that ended but is active
			return this.adapter.find({
				query: {
					"$or": [
						{
							"dates.dateOrderNext": { "$lte": checkDate },
							"dates.dateEnd": { "$gte": checkDate },
							status: "active"
						},
						{
							"dates.dateEnd": { "$lte": new Date() },
							status: { "$in": ["active", "trial", "agreed"] }
						}
					]
				}
			})
				.then(subscriptions => {
					this.logger.info("subscriptions.stopEndedActiveSubscriptions - subscriptions found", subscriptions);
					if (subscriptions && subscriptions.length>0) {
						subscriptions.forEach(s => {
							promises.push( 
								ctx.call("subscriptions.suspend", {
									subscriptionId: s._id.toString(),
									altUser: "checkSubscription CRON",
									altMessage: "subscription suspended because no payment received"
								})
									.catch(err => {
										this.logger.error("subscriptions.stopEndedActiveSubscriptions - subscriptions.suspend error:", err);
										return null;
									})
									.then(result => ({ subscription: s, result }))
							);
						});
						// Suspend in parallel, then notify sequentially — only after confirmed
						// payment-provider suspend, and abort further emails on SMTP auth failure.
						return Promise.all(promises)
							.then(async (pairs) => {
								for (const { subscription, result } of pairs) {
									// "suspend sent" = payment provider confirmed; local-only
									// cleanup (relatedId missing) must not trigger customer email.
									if (result?.success && result?.message === "suspend sent") {
										try {
											await self.sendSubscriptionEmail(
												ctx,
												subscription,
												"subscription/suspended"
											);
										} catch (err) {
											const msg = String(err?.message || err || "");
											if (
												err?.code === "EAUTH" ||
												err?.code === "EAUTH_BLOCKED" ||
												err?.emailTransportBlocked ||
												err?.responseCode === 535 ||
												err?.responseCode === 403 ||
												/authentication failed|EAUTH|rate limited/i.test(msg)
											) {
												this.logger.warn(
													"subscriptions.stopEndedActiveSubscriptions - " +
													"stopping further emails after SMTP auth failure"
												);
												break;
											}
										}
									}
								}
								return pairs.map(p => p.result);
							})
							.catch(err => {
								this.logger.error("subscriptions.stopEndedActiveSubscriptions all error:", err);
								return this.Promise.reject(new MoleculerClientError("Subscriptions checkS all error", 422, "", []));
							});
					} else {
						return "No results";
					}
				})
				.then(suspendedSubs => {
					// set status to finished to those, with dateEnd in past
					return self.adapter.updateMany(
						{
							"dates.dateEnd": { "$lte": checkDate },
							status: "active"
						},
						{
							"$set": {
								status: "finished"
							}
						}
					)
						.then(subscriptions => {
							return {
								suspended: suspendedSubs,
								finished: subscriptions
							};	
						})
						.catch(err => {
							this.logger.error("subscriptions.stopEndedActiveSubscriptions updateMany error:", err);
							return this.Promise.reject(new MoleculerClientError("Subscriptions checkS updateM error", 422, "", []));
						});
				})
				.catch(err => {
					this.logger.error("subscriptions.stopEndedActiveSubscriptions find error:", err);
					// return this.Promise.reject(new MoleculerClientError("Subscriptions checkS find error", 422, "", []));
				});			
		},

		/**
		 * For CRON - check for subscritiptions with ended trial period
		 * and ask for first payment
		 * 
		 * @param {Object} ctx
		 * 
		 * @returns {Promise}
		 */
		firstPaymentAfterTrial(ctx) {	
			let checkDate = new Date();
			const daysTolerance = process?.env?.SUBS_DAYS_TOLERANCE || 1;
			checkDate.setDate(checkDate.getDate() - daysTolerance);
			// NOTE: set user as admin so "subscription.suspend" action can be done
			if (typeof ctx.meta.user === "undefined") {
				ctx.meta.user = { type: "admin" };
			}
			if (typeof ctx.meta.user.type === "undefined" || ctx.meta.user.type == null) {
				ctx.meta.user.type = "admin";
			}
			this.logger.info("subscriptions.firstPaymentAfterTrial - query", {
				"dates.dateOrderNext": { "$lte": checkDate },
				"dates.dateEnd": { "$gte": checkDate },
				status: "trial"
			});
			// get trial with dateOrder for today (- days of tolerance) and less, not ended
			return this.adapter.find({
				query: {
					"dates.dateOrderNext": { "$gte": checkDate },
					"dates.dateEnd": { "$gte": checkDate },
					status: "trial"
				}
			})
				.then(subscriptions => {
					this.logger.info("subscriptions.firstPaymentAfterTrial - subscriptions found", subscriptions);
				})
				.catch(err => {
					this.logger.error("subscriptions.firstPaymentAfterTrial find error:", err);
					// return this.Promise.reject(new MoleculerClientError("Subscriptions checkS find error", 422, "", []));
				});
		}, 


		setSubscriptionStatus(subscriptionId, status) {
			
		},
	}
};
