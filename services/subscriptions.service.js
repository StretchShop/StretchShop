"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("moleculer-cron");

const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

module.exports = {
	name: "subscriptions",
	mixins: [
		DbService("subscriptions"),
		CacheCleanerMixin([
			"cache.clean.subscriptions"
		]),
		Cron
	],

	crons: [{
		name: "SubscriptionsCleaner",
		cronTime: "0 0 * * *",
		onTick: function() {

			this.logger.info("Starting to Clean up the Subscriptions");

			this.getLocalService("subscriptions")
				.actions.runSubscriptions()
				.then((data) => {
					this.logger.info("Subscriptions runned", data);
				});
		}
	}],

	/**
	 * Default settings
	 */
	settings: {
		/** Public fields */
		fields: ["_id", "userId", "ip", "type", "period", "duration", "status", "orderOriginId", "orderItemName", "dates", "price", "data", "history"],

		/** Validator schema for entity */
		entityValidator: {
			userId: { type: "string", min: 3 },
			ip: { type: "string", min: 4 },
			type: {type: "string", min: 3 }, // autorefresh, singletime, ...
			period: {type: "string", min: 3 }, // year, month, week, day, ...
			duration: {type: "number", positive: true }, // 1, 3, 9.5, ...
			status: { type: "string", min: 3 }, // active, finished, ...
			orderOriginId: { type: "string", min: 3 },
			orderItemName: { type: "string", min: 3 },
			dates: { type: "object", props: {
				dateStart: { type: "date" },
				dateOrderNext: { type: "date" },
				dateEnd: { type: "date" },
				dateCreated: { type: "date" },
				dateUpdated: { type: "date" },
			}},
			price: { type: "number" },
			data: { type: "object", props:
				{
					product: { type: "object" },
					order: { type: "object", optional: true }
				}
			},
			history: { type: "array", optional: true, items:
				{ type: "object", props: {
					action: { type: "string" }, // created, prolonged, stopped, paused, ...
					type: { type: "string" }, // user, automatic, ...
					date: { type: "date" },
					data: { type: "object", optional: true }
				} }
			}
		}
	},


	/**
	 * Actions
	 */
	actions: {

		/**
		 * disable cache for find action
		 */
		find: {
			cache: false
		},


		/**
		 * Get currently active user's subscriptions
		 *
		 * @actions
		 *
		 * @returns {Object} User entity
		 */
		mySubscriptions: {
			auth: "required",
			cache: {
				keys: ["dates.dateUpdated"],
				ttl: 30
			},
			handler(ctx) {
				if ( ctx.meta.user && ctx.meta.user._id ) {
					return ctx.call("subscriptions.find", {
						"query": {
							userId: ctx.meta.user._id
						}
					})
						.then(found => {
							if (found && found.constructor===Array ) {
								return this.transformDocuments(ctx, {}, found);
							} else {
								return this.Promise.reject(new MoleculerClientError("Subscriptions not found!", 400));
							}
						})
						.then(subscriptions => {
							// delete history for user
							subscriptions.forEach(s => {
								delete s.history;
							});
							return this.transformEntity(subscriptions, true, ctx);
						})
						.catch((error) => {
							this.logger.error("subscriptions.me error", error);
							return null;
						});
				}

			}
		},


		/**
		 * Converts order with subscription items to subscription records
		 * 
		 * @actions
		 * 
		 * @param {Object} - order object to get subscriptions from
		 * 
		 * @returns {Object} 
		 */
		orderToSubscription: {
			// auth: "required",
			cache: false,
			params: {
				order: { type: "object" }
			},
			handler(ctx) {
				// 1. get subscription items from order
				const subscriptions = this.getOrderSubscriptions(ctx.params.order);
				
				// 2. create subscription for every subscribe item
				if (subscriptions && subscriptions.length>0) {
					for (let i=0; i<subscriptions.length; i++) {
						let subscription = this.createEmptySubscription();
						// 3. get subscription order
						let order = this.prepareOrderForSubscription(ctx.params.order, subscriptions[i]);

						subscription.data.product = subscriptions[i];
						subscription.data.order = order;
						let durationMax = 12; // maximum count of period repeats
						// type & period & duration & durationMax
						if (subscriptions[i].data && subscriptions[i].data.subscription) {
							if (subscriptions[i].data.subscription.type) {
								subscription.type = subscriptions[i].data.subscription.type;
							}
							if (subscriptions[i].data.subscription.period) {
								subscription.period = subscriptions[i].data.subscription.period;
							}
							if (subscriptions[i].data.subscription.duration) {
								subscription.duration = subscriptions[i].data.subscription.duration;
							}
							if (subscriptions[i].data.subscription.durationMax) {
								durationMax = subscriptions[i].data.subscription.durationMax;
							}
						}
						// basics
						subscription.userId = order.user.id;
						subscription.ip = ctx.meta.remoteAddress+":"+ctx.meta.remotePort;
						// this is just for development debuging needs
						if (ctx.params.order._id["$oid"]) {
							ctx.params.order._id = ctx.params.order._id["$oid"];
						}
						subscription.orderOriginId = ctx.params.order._id || ctx.params.order._id.toString();
						subscription.orderItemName = ctx.params.order.items[0].name[order.lang.code];
						subscription.dates.dateStart = new Date();
						subscription.dates.dateOrderNext = this.calculateDateOrderNext(
							subscription.period,
							subscription.duration
						);
						subscription.price = ctx.params.order.items[0].price;

						subscription.history.push( 
							this.newHistoryRecord("created", "user", ctx.params.order) 
						);

						// setting up date when subscription ends
						let dateEnd = this.calculateDateEnd(
							subscription.dates.dateStart,
							subscription.period,
							subscription.duration,
							durationMax
						);
						subscription.dates.dateEnd = dateEnd;

						// 4. save subscription
						return ctx.call("subscriptions.save", {entity: subscription} )
							.then((saved) => {
								this.logger.info("subscriptions.orderToSubscription - added subscription: ", saved);
								return saved;
							})
							.catch(err => {
								this.logger.error("subscriptions.orderToSubscription - err: ", err);
							});
					}
				}
			}
		},


		/**
		 * CRON action (see crons.cronTime setting for time to process):
		 *  1. find all subscriptions that need to processed
		 *  2. create and process new order for these subscriptions
		 *  3. update subscriptions
		 */
		runSubscriptions: {
			cache: false,
			handler(ctx) {
				let promises = [];
				const today = new Date();
				return this.adapter.find({
					query: {
						"dates.dateOrderNext": { "$lte": today },
						"dates.dateEnd": { "$gte": today },
						status: "active"
					}
				})
					.then(found => {
						this.logger.info("subsp found ", found);
						found.forEach(subscription => {
							let newOrder = Object.assign({}, subscription.data.order);
							promises.push( 
								ctx.call("orders.create", {order: newOrder} )
									.then(orderResult => {
										this.logger.info("Created new subscription order ", JSON.stringify(orderResult));
										let dateEnd = new Date(subscription.dates.dateEnd);
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
											this.newHistoryRecord("prolonged", "automatic") 
										);
										return this.adapter.updateById(subscription._id, this.prepareForUpdate(subscription))
											.then(subscriptionUpdated => {
												return subscriptionUpdated;
											});
									})
							);
						});
						// return all runned subscriptions
						return Promise.all(promises).then((result) => {
							return result;
						});
					});
			}
		},


		/**
		 * Import subscriptions data:
		 *
		 * @actions
		 * 
		 * @param {Array} - array of subscription to import
		 *
		 * @returns {Object} Category entity
		 */
		import: {
			auth: "required",
			params: {
				subscriptions: { type: "array", items: "object", optional: true },
			},
			// cache: {
			// 	keys: ["#subscriptionID"]
			// },
			handler(ctx) {
				this.logger.info("subscriptions.import - ctx.meta");
				let subscriptions = ctx.params.subscriptions;
				let promises = [];

				if (ctx.meta.user.type=="admin") {
					if ( subscriptions && subscriptions.length>0 ) {
						// loop products to import
						subscriptions.forEach(function(entity) {
							promises.push(
								// add subscription results into result variable
								ctx.call("subscriptions.save", {entity})
							); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises).then(prom => {
						return prom;
					});
				} else { // not admin user
					return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
				}	
			}
		},


		/**
		 * Save subscription:
		 *  - if no ID, create new;
		 *  - if has ID, update;
		 *
		 * @returns {Object} subscription entity with items
		 */
		save: {
			cache: false,
			params: {
				entity: { type: "object" } // su
			},
			handler(ctx) {
				let self = this;
				let entity = ctx.params.entity;

				return this.adapter.findById(entity.id)
					.then(found => {
						if (found) { // entity found, update it
							if ( entity ) {
								if ( entity.dates ) {
									// convert strings to Dates
									Object.keys(entity.dates).forEach(function(key) {
										let date = entity.dates[key];
										if ( date && date!=null && !(date instanceof Date) && 
										date.toString().trim()!="" ) {
											entity.dates[key] = new Date(entity.dates[key]);
										}
									});
								}
							}

							return self.validateEntity(entity)
								.then(() => {
									if (!entity.dates) {
										entity.dates = {};
									}
									entity.dates.dateUpdated = new Date();
									entity.dates.dateSynced = new Date();
									self.logger.info("subscription.save found - update entity:", entity);
									let entityId = entity.id;
									delete entity.id;
									delete entity._id;
									const update = {
										"$set": entity
									};

									return self.adapter.updateById(entityId, update)
										.then(doc => self.transformDocuments(ctx, {}, doc))
										.then(json => self.entityChanged("updated", json, ctx).then(() => json));
								})
								.catch(err => {
									self.logger.error("subscriptions.save update validation error: ", err);
								});
						} else { // no product found, create one
							return self.validateEntity(entity)
								.then(() => {
									// check if user doesn't have same subscription in that time
									return ctx.call("subscriptions.find", {
										"query": {
											userId: entity.userId,
											orderItemName: entity.orderItemName,
											// "dates.dateStart": {"$le": entity.dates.dateStart} // TODO - set date range
										}
									})
										.then(entityFound => {
											if (entityFound && entityFound.constructor === Array && 
											entityFound.length>0) {
												self.logger.warn("subscriptions.save - insert - found similar entity:", entityFound);
											}
											if (!entity.dates) {
												entity.dates = {};
											}
											// convert strings to Dates
											Object.keys(entity.dates).forEach(function(key) {
												let date = entity.dates[key];
												if ( date && date!=null && !(date instanceof Date) && 
												date.toString().trim()!="" ) {
													entity.dates[key] = new Date(entity.dates[key]);
												}
											});
											self.logger.info("subscriptions.save - insert entity:", entity);

											return self.adapter.insert(entity)
												.then(doc => self.transformDocuments(ctx, {}, doc))
												.then(json => self.entityChanged("created", json, ctx).then(() => json));
										});
								})
								.catch(err => {
									self.logger.error("subscriptions.save insert validation error: ", err);
								});
						} // else end
					});
			}
		},

		// add delete action

	},



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

			subscriptionOrder.data.subscription = new Date();
			
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
				status: "active", // active, inactive, ...
				orderOriginId: null,
				orderItemName: null,
				dates: {
					dateStart: new Date(),
					dateEnd: nextYear,
					dateCreated: new Date(),
					dateUpdated: new Date(),
				},
				price: null,
				data: { 
					product: null,
					order: null
				},
				history: [],
			};
		},


		/**
		 * 
		 * @param {Date} dateStart 
		 * @param {String} period 
		 * @param {Number} duration 
		 * @param {Number} durationMax 
		 */
		calculateDateEnd(dateStart, period, duration, durationMax) {
			let dateEnd = new Date(dateStart.getTime());
			for (let i=0; i<durationMax; i++) {
				dateEnd = this.calculateDateOrderNext(period, duration, dateEnd);
			}
			return dateEnd;
		},


		/**
		 * 
		 * @param {String} period 
		 * @param {Number} duration 
		 */
		calculateDateOrderNext(period, duration, dateStart) {
			Date.prototype.addDays = function(days) {
				let date = new Date(this.valueOf());
				date.setDate(date.getDate() + days);
				return date;
			};
			const addMonths = (date, months) => {
				let d = date.getDate();
				date.setMonth(date.getMonth() + +months);
				if (date.getDate() != d) {
					date.setDate(0);
				}
				return date;
			};

			let dateOrderNext = dateStart || new Date();
			switch (period) {
			case "day":
				dateOrderNext.addDays(duration); // add a day(s)
				break;
			case "week": 
				dateOrderNext.addDays(duration * 7); // add a week(s)
				return;
			case "month":
				dateOrderNext = addMonths(dateOrderNext, duration); // add month(s)
				break;
			default: // year
				dateOrderNext.setFullYear(dateOrderNext.getFullYear() + duration); // add years
				break;
			}
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
				result.data = data;
			}
			return result;
		},


	},

	events: {
		"cache.clean.subscriptions"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
