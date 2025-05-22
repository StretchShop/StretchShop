"use strict";

const { MoleculerClientError } = require("moleculer").Errors;


module.exports = {

	/**
	 * Methods
	 */
	methods: {

		
		/**
		 * Remove _id and return object wrapped for mongoDB
		 * 
		 * @param {Object} object - subscription to update
		 * 
		 * @returns {Object}
		 */
		prepareForUpdate(object) {
			let objectToSave = Object.assign({}, object); //JSON.parse(JSON.stringify(object));
			if ( typeof objectToSave._id !== "undefined" && objectToSave._id ) {
				delete objectToSave._id;
			}
			return { "$set": objectToSave };
		},


		/**
		 * 
		 * @param {Object} order 
		 * 
		 * @returns Object
		 */
		prepareOrderForSubscription(order, item) {
			item = (typeof item !== "undefined") ? item : null;
			let subscriptionOrder = Object.assign({}, order);
			// remove unwanted attributes
			delete subscriptionOrder._id;
			subscriptionOrder.externalId = null;
			subscriptionOrder.externalCode = null;

			subscriptionOrder.dates.datePaid = null;
			subscriptionOrder.dates.emailSent = null;

			subscriptionOrder.status = "cart";

			delete subscriptionOrder.data.paymentData.paymentRequestId;
			delete subscriptionOrder.data.paymentData.supplier;
			delete subscriptionOrder.data.paymentData.lastStatus;
			delete subscriptionOrder.data.paymentData.lastDate;
			delete subscriptionOrder.data.paymentData.paidAmountTotal;
			subscriptionOrder.data.paymentData.lastResponseResult = [];
			delete subscriptionOrder.invoice;
			
			subscriptionOrder.prices.priceTotal = 0;
			subscriptionOrder.prices.priceTotalNoTax = 0;
			subscriptionOrder.prices.priceItems = 0;
			subscriptionOrder.prices.priceItemsNoTax = 0;
			subscriptionOrder.prices.priceTaxTotal = 0;
			subscriptionOrder.prices.priceDelivery = 0;
			subscriptionOrder.prices.pricePayment = 0;

			if ( !subscriptionOrder.data.subscription ) {
				subscriptionOrder.data.subscription = {
					created: new Date(),
					ids: []
				};
			}
			
			// define items
			subscriptionOrder.items = [];
			if (item && item!=null) {
				// add the item
				subscriptionOrder.items.push(item);
				// subscriptionOrder.items[0].id = subscriptionOrder.items[0]._id;
				// delete subscriptionOrder.items[0]._id;
				// count the prices
			}
			// do NOT set the dates
			return subscriptionOrder;
		},

		
		/**
		 * 
		 * @param {Object} order 
		 * 
		 * @returns Array - subscriptions in order
		 */
		getOrderSubscriptions(order) {
			let subscriptions = [];

			if (order.items && order.items.length>0) {
				order.items.forEach(item => {
					if (item.type === "subscription") {
						subscriptions.push(item);
					}
				});
			}

			return subscriptions;
		},


		/**
		 * Create template for subscription 
		 * with properties, that it should have
		 * NOTE: you may have problem to insert properties that 
		 * are not in this object and settings.fields && settings.entityValidator
		 * 
		 * @returns {Object} - empty subscription object
		 */
		createEmptySubscription() {
			const nextYear = new Date();
			nextYear.setFullYear( nextYear.getFullYear() + 1);

			return {
				userId: null,
				ip: null,
				type: "autorefresh", // autorefresh, singletime, ...
				period: "month", // year, month, week, day, ...
				duration: 1, // 1, 3, 9.5, ...
				cycles: 0,
				status: "inactive", // active, inactive, ...
				orderOriginId: null,
				orderItemName: null,
				dates: {
					dateStart: new Date(),
					dateOrderNext: null,
					dateEnd: nextYear,
					dateCreated: new Date(),
					dateUpdated: new Date(),
				},
				price: null,
				data: { // create here if you want to have it after helpers.mixin.js updateObject()
					product: null,
					order: null,
					agreement: null
				},
				history: [],
			};
		},


		/**
		 * Calculate when subscriptions ends
		 * For infinity (durationMax==0) it calculates date to nex
		 * 
		 * @param {Date} dateStart 
		 * @param {String} period 
		 * @param {Number} duration 
		 * @param {Number} durationMax 
		 */
		calculateDateEnd(dateStart, period, duration, durationMax) {
			let dateEnd = new Date(dateStart.getTime());
			const maxDuration = 1000; // eternity does not exist and it prevents infinite loops
			if (!durationMax || durationMax<=0 || durationMax>maxDuration) {
				dateEnd.setFullYear(dateEnd.getFullYear() + maxDuration);
			} else {
				for (let i=0; i<durationMax; i++) {
					dateEnd = this.calculateDateOrderNext(period, duration, dateEnd);
				}
			}
			return dateEnd;
		},


		/**
		 * 
		 * @param {String} period 
		 * @param {Number} duration 
		 * @param {Date} dateStart
		 * 
		 * @returns {Date} 
		 */
		calculateDateOrderNext(period, duration, dateStart) {
			this.logger.info("subscriptions.calculateDateOrderNext() - period, duration, datestart", period, duration, dateStart);
		
			let dateOrderNext = dateStart || new Date();
			switch (period) {
			case "day":
				dateOrderNext = this.addDays(dateOrderNext, duration); // add a day(s)
				break;
			case "week": 
				dateOrderNext = this.addDays(dateOrderNext, duration * 7); // add a week(s)
				return;
			case "month":
				dateOrderNext = this.addMonths(dateOrderNext, duration); // add month(s)
				break;
			default: // year
				dateOrderNext.setFullYear(dateOrderNext.getFullYear() + duration); // add years
				break;
			}
			this.logger.info("subscriptions.calculateDateOrderNext() - dateOrderNext", dateOrderNext);

			return dateOrderNext;
		},


		/**
		 * Helper to create history record
		 * 
		 * @param {String} action // created, prolonged, stopped, paused, ...
		 * @param {String} type // user, automatic, ...
		 * @param {Object} data 
		 */
		newHistoryRecord(action, type, data) {
			action = action ? action : "created";
			type = type ? type : "user";
			let result = {
				action,
				type,
				date: new Date()
			};
			if (data) {
				result.data = JSON.parse(JSON.stringify(data));
			}
			return result;
		},


		addToHistory(ctx, subscriptionId, historyRecord) {
			return ctx.call("subscriptions.update", 
				{
					updateObject: { id: subscriptionId },
					historyRecordToAdd: historyRecord 
				})
				.then(updated => {
					return updated;
				})
				.catch(error => {
					this.logger.error("subscriptions.addToHistory() - error: ", JSON.stringify(error));
					return null;
				});
		},


		/**
		 * create order of paid subscription
		 * 
		 * @param {Object} ctx 
		 * @param {Object} subscription 
		 * 
		 * @returns {Object}
		 */
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
			// configuring email message
			let emailSetup = {
				settings: {
					to: [subscription.data.order.user.email, process.env.SITE_SUPPORT_EMAIL]
				},
				functionSettings: {
					language: subscription.data.order.user.settings.language
				},
				template: template,
				data: {
					webname: ctx.meta.siteSettings?.name || process.env.SITE_NAME || "StretchShop",
					username: subscription.data.order.user.username,
					email: subscription.data.order.user.email, 
					subscription: subscription, 
					support_email: ctx.meta.siteSettings?.supportEmail || process.env.SITE_SUPPORT_EMAIL
				}
			};
			// sending email
			ctx.call("users.sendEmail", emailSetup).then(json => {
				this.logger.info("users.cancelDelete - email sent:", json);
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
							status: "active"
						},
						{
							"dates.dateEnd": { "$lte": new Date() },
							status: "agreed"
						},
						{
							"dates.dateEnd": { "$lte": new Date() },
							status: "stopped"
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
										this.logger.error("users.stopEndedActiveSubscriptions - subscriptions.suspend error:", err);
									})
									.then(result => {
										// send email to customer
										self.sendSubscriptionEmail(
											ctx, s, 
											"subscription/suspended"
										);
										return result;
									})
							);
						});
						// return all runned subscriptions
						return Promise.all(promises)
							.then((result) => {
								return result;
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
