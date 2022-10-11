"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("@stretchshop/moleculer-cron");

// global mixins
const DbService = require("../../mixins/db.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");

// methods
const SubscriptionsMethodsCore = require("./methods/core.methods");

module.exports = {
	name: "subscriptions",
	mixins: [
		DbService("subscriptions"),
		CacheCleanerMixin([
			"cache.clean.subscriptions"
		]),
		Cron,
		HelpersMixin,
		// methods
		SubscriptionsMethodsCore,
	],

	crons: [{
		name: "SubscriptionsCheck",
		cronTime: "5 0 * * *",
		onTick: function() {

			this.logger.info("Starting to Clean up the Subscriptions");

			this.getLocalService("subscriptions")
				.actions.checkSubscriptions()
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
		fields: ["_id", "userId", "ip", "type", "period", "duration", "cycles", "status", "orderOriginId", "orderItemName", "dates", "price", "data", "history"],

		/** Validator schema for entity */
		entityValidator: {
			userId: { type: "string", min: 3 },
			ip: { type: "string", min: 4 },
			period: {type: "string", min: 3 }, // year, month, week, day, ...
			duration: {type: "number", positive: true }, // 1, 3, 9.5, ...
			cycles: {type: "number"}, // number of repeats, for infinity use 0 and less
			status: { type: "string", min: 3 }, // inactive, active, finished, ...
			orderOriginId: { type: "string", min: 3 },
			orderItemName: { type: "string", min: 3 },
			dates: { type: "object", props: {
				dateStart: { type: "date" },
				dateOrderNext: { type: "date", optional: true },
				dateEnd: { type: "date", optional: true },
				dateCreated: { type: "date" },
				dateUpdated: { type: "date" },
			}},
			price: { type: "number" },
			data: { type: "object", props:
				{
					product: { type: "object" },
					order: { type: "object", optional: true },
					remoteData: { type: "object", optional: true },
					agreementId: { type: "string", optional: true },
					agreement: { type: "any", optional: true }
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
		listSubscriptions: {
			cache: false,
			auth: "required",
			// cache: {
			// 	keys: ["dates.dateUpdated"],
			// 	ttl: 30
			// },
			params: {
				query: { type: "object", optional: true },
				limit: { type: "number", optional: true },
				offset: { type: "number", optional: true },
				sort: { type: "string", optional: true },
				fullData: { type: "boolean", optional: true }
			},
			handler(ctx) {
				let self = this;

				if ( ctx.meta.user && ctx.meta.user._id ) {
					let filter = { query: {}, limit: 20};
					if (typeof ctx.params.query !== "undefined" && ctx.params.query) {
						filter.query = ctx.params.query;
					}
					// update filter acording to user
					if ( ctx.meta.user.type=="admin" && typeof ctx.params.fullData!=="undefined" && ctx.params.fullData==true ) {
						// admin can browse all orders
					} else {
						filter.query["userId"] = ctx.meta.user._id.toString();
					}
					// set offset
					if (ctx.params.offset && ctx.params.offset>0) {
						filter.offset = ctx.params.offset;
					}
					// set max of results
					if (typeof ctx.params.limit !== "undefined" && ctx.params.limit) {
						filter.limit = ctx.params.limit;
					}
					if (filter.limit>20) {
						filter.limit = 20;
					}
					// sort
					filter.sort = "-dates.dateCreated";
					if (typeof ctx.params.sort !== "undefined" && ctx.params.sort) {
						filter.sort = ctx.params.sort;
					}

					if ( filter.query && filter.query._id && filter.query._id.trim()!="" ) {
						filter.query._id = this.fixStringToId(filter.query._id);
						filter.limit = 1;
					}

					return ctx.call("subscriptions.find", filter)
						.then(found => {
							if (found && found.constructor===Array ) {
								return self.transformDocuments(ctx, {}, found);
							} else {
								return self.Promise.reject(new MoleculerClientError("Subscriptions not found!", 400));
							}
						})
						.then(subscriptions => {
							// delete history for user
							if (filter.limit>1) {
								subscriptions.forEach(s => {
									delete s.history;
								});
							}
							return ctx.call("subscriptions.count", filter)
								.then(count => {
									return {
										total: count,
										results: subscriptions
									};
								})
								.catch(error => {
									self.logger.error("orders.listOrders count error", error);
									return Promise.reject(new MoleculerClientError("Orders not found!..", 400, "", [{ field: "orders", message: "not found"}]));
								});
							// return self.transformEntity(subscriptions, true, ctx);
						})
						.catch((error) => {
							self.logger.error("orders.listOrders find error", error);
							return Promise.reject(new MoleculerClientError("Orders not found!", 400, "", [{ field: "orders", message: "not found"}]));
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
				let promises = [];
				
				// 2. create subscription for every subscribe item
				if (subscriptions && subscriptions.length>0) {
					for (let i=0; i<subscriptions.length; i++) {
						let subscription = this.createEmptySubscription();
						// 3. get subscription order
						let order = this.prepareOrderForSubscription(ctx.params.order, subscriptions[i]);

						subscription.data.product = subscriptions[i];
						subscription.data.order = order;
						// fill in data from product - period & duration & cycles
						if (subscriptions[i].data && subscriptions[i].data.subscription) {
							if (subscriptions[i].data.subscription.period) {
								subscription.period = subscriptions[i].data.subscription.period;
							}
							if (subscriptions[i].data.subscription.duration) {
								subscription.duration = subscriptions[i].data.subscription.duration;
							}
							if (subscriptions[i].data.subscription.cycles) {
								subscription.cycles = subscriptions[i].data.subscription.cycles;
							}
						}
						// basics
						subscription.userId = order.user.id;
						subscription.ip = ctx.meta.remoteAddress+":"+ctx.meta.remotePort;
						// this is just for development debuging needs
						if (ctx.params.order._id["$oid"]) {
							ctx.params.order._id = ctx.params.order._id["$oid"];
						}
						subscription.orderOriginId = ctx.params.order._id.toString();
						subscription.orderItemName = subscriptions[i].name[order.lang.code];
						subscription.dates.dateStart = new Date();
						/* dateOrderNext set to now, because first payment is done 
						   right after customer accepts agreement to billing plan */
						subscription.dates.dateOrderNext = new Date();
						subscription.price = subscriptions[i].price;

						subscription.history.push( 
							this.newHistoryRecord("created", "user", {
								type: "from order",
								relatedOrder: ctx.params.order._id.toString()
							}) 
						);

						// setting up date when subscription ends
						let dateEnd = this.calculateDateEnd(
							subscription.dates.dateStart,
							subscription.period,
							subscription.duration,
							subscription.cycles
						);
						subscription.dates.dateEnd = dateEnd;
						this.logger.info("subscriptions.orderToSubscription subscription 2 save:", subscription);

						// 4. save subscription
						promises.push(
							ctx.call("subscriptions.save", {entity: subscription} )
								.then((saved) => {
									this.logger.info("subscriptions.orderToSubscription - added subscription["+i+"]: ", saved);
									return saved;
								})); // push with save end
					}
				}

				// return multiple promises results
				return Promise.all(promises).then(savedSubscriptions => {
					this.logger.info("subscriptions.orderToSubscription Promise.all(promises):", promises);
					// save IDs into related order
					let subscrIds = [];
					let productSubscriptions = {};
					savedSubscriptions.forEach(function(sasu){
						// get ID or subscription and related product
						subscrIds.push({
							subscription: sasu._id.toString(),
							product: sasu.data.product._id.toString()
						});
						productSubscriptions[sasu.data.product._id.toString()] = sasu._id.toString();
					});
					if ( !ctx.params.order.data.subscription ) {
						ctx.params.order.data["subscription"] = {
							created: new Date(),
							ids: []
						};
					}
					ctx.params.order.data.subscription.ids = subscrIds;
					// add subscription ID also into product in order list
					for (let i=0; i<ctx.params.order.items.length; i++) {
						ctx.params.order.items[i].subscriptionId = productSubscriptions[ctx.params.order.items[i]._id.toString()];
					}
					this.logger.info("subscriptions.orderToSubscription Promise.all(promises) subscrIds:", subscrIds);
					// add ID parameter
					ctx.params.order.id = ctx.params.order._id;
					// saving ids into related order
					return ctx.call("orders.updateOrder", {
						order: Object.assign({}, ctx.params.order)
					})
						.then(order => {
							// save IDs
							if (order) {
								return savedSubscriptions;
							}
						});
				});
			}
		},


		/**
		 * CRON action (see crons.cronTime setting for time to process):
		 *  1. find all subscriptions that need to processed
		 *  2. check if:
		 *     2.1. all payments in subscription have been received
		 *     2.2. stripe paid subscriptions were suspended 
		 *  3. if not, make them inactive
		 * 
		 * to debug you can use - mol $ call subscriptions.checkSubscriptions
		 * 
		 * @actions
		 */
		checkSubscriptions: {
			cache: false,
			handler(ctx) {
				let promises = [];
				let self = this;
				let checkDate = new Date();
				const daysTolerance = 1; // TODO outsource to settings
				checkDate.setDate(checkDate.getDate() - daysTolerance);
				// set user as admin so "subscription.suspend" action can be done
				if (typeof ctx.meta.user === "undefined") {
					ctx.meta.user = { type: "admin" };
				}
				if (typeof ctx.meta.user.type === "undefined" || ctx.meta.user.type == null) {
					ctx.meta.user.type = "admin";
				}
				
				// get dateOrder for today (- days of tolerance) and less
				// TODO - add $or for case we have subscription, that ended but is active
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
								status: "stopped"
							}
						]
					}
				})
					.then(subscriptions => {
						this.logger.info("subscriptions.checkSubscriptions - subscriptions found", subscriptions);
						if (subscriptions && subscriptions.length>0) {
							subscriptions.forEach(s => {
								promises.push( 
									ctx.call("subscriptions.suspend", {
										subscriptionId: s._id.toString(),
										altUser: "checkSubscription CRON",
										altMessage: "subscription suspended because no payment received"
									})
										.catch(err => {
											this.logger.error("users.checkSubscriptions - subscriptions.suspend error:", err);
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
							return Promise.all(promises).then((result) => {
								return result;
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
		 * @actions
		 * 
		 * @param {Object} entity - entity to save, must contain ".id" parameter for identification
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
								.catch(error => {
									self.logger.error("subscriptions.save update validation error: ", error);
								});
						} else { // no product found, create one
							return self.validateEntity(entity)
								.then(() => {
									// check if user doesn't have same subscription in that time
									return ctx.call("subscriptions.find", {
										"query": {
											userId: entity.userId,
											orderItemName: entity.orderItemName,
											status: "active"
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
					})
					.catch(err => {
						self.logger.error("subscriptions.save findById error: ", err);
					});
			}
		},


		/**
		 * Save subscription:
		 *  - if no ID, create new;
		 *  - if has ID, update;
		 * 
		 * @actions
		 * 
		 * @param {Object} updateObject - subscription entity to update, with data to update, must contain ".id" parameter for identification
		 *
		 * @returns {Object} updated subscription entity
		 */
		update: {
			cache: false,
			params: {
				updateObject: { type: "object" },
				historyRecordToAdd: { type: "object", optional: true }
			},
			handler(ctx) {
				let self = this;

				return this.adapter.findById(ctx.params.updateObject.id)
					.then(found => {
						if (found) {
							let original = Object.assign({}, found);
							original.data = JSON.parse(JSON.stringify(original.data));
							delete original._id;
							let updatedOriginal = self.updateObject(original, ctx.params.updateObject);
							
							// add history record if set
							if (ctx.params.historyRecordToAdd) {
								updatedOriginal.history.push(
									JSON.parse(JSON.stringify(ctx.params.historyRecordToAdd))
								);
							}

							return ctx.call("subscriptions.save", {
								entity: updatedOriginal
							})
								.then(updated => {
									this.logger.info("subscriptions.save updated:", updated);
									return updated;
								})
								.catch(error => {
									this.logger.error("subscriptions.save update error: ", error);
									return null;
								});
						}
					})
					.catch(err => {
						self.logger.error("subscriptions.save update validation error: ", err);
						return null;
					});

			}
		},


		/**
		 * SUBSCRIPTION FLOW - 1.1 (FE->BE)
		 * Suspend (pause) active subscription
		 * 
		 * @actions
		 * 
		 * @param {String} subscriptionId - id of subscription to suspend
		 *
		 * @returns {Object} result with subscription
		 */
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
				if ( ctx.meta.user && ctx.meta.user.type=="admin" ) {
					// admin can browse all orders
				} else {
					filter.query["user.id"] = ctx.meta.user._id.toString();
				}

				// find subscription
				return ctx.call("subscriptions.find", filter)
					.then(found => {
						this.logger.info("subscriptions.suspend found:", filter, found);
						if (found && found[0]) {
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
							this.logger.info("subscriptions.suspend stripe.id:", found.data.stripe, found.data.stripe.id, (found.data.stripe && found.data.stripe.id), ( !relatedId || relatedId==null ));

							if ( !relatedId || relatedId==null ) {
								if (found.data.stripe && found.data.stripe.id) {
									relatedId = found.data.stripe.id;
								} else if (found.history && found.history.length>0) {
									found.history.some(record => {
										if (record && record.action=="agreed" && record.data && 
										record.data.agreement && record.data.agreement.id) {
											relatedId = record.data.agreement.id;
											return true;
										}
									});
								}
							}
							this.logger.info("subscriptions.suspend relatedId:", relatedId);

							// FIX - NO relatedId with Stripe 
							if (relatedId && relatedId!=null) {
								// update agreement
								let paymentType = "online_paypal_paypal";
								if (found.data && found.data.order && found.data.order.data && 
								found.data.order.data.paymentData && 
								found.data.order.data.paymentData.codename) {
									paymentType = found.data.order.data.paymentData.codename;
								}
								// using suspendPayment to be more universal call
								// TODO - need to setup rules for creating payment names
								let supplier = "paypal";
								if (paymentType=="online_stripe") {
									supplier = "stripe";
								}
								// call suspend action that calls related API
								return ctx.call("orders.paymentSuspend", {
									supplier: supplier,
									relatedId: relatedId,
									subscription: found
								})
									.then(suspendResult => {
										// return suspendResult

										found.history.push(
											this.newHistoryRecord("suspended", altUser, {
												relatedOrder: null,
												message: altMessage
											})
										);

										result.success = true;
										result.message = "suspend sent";
										result.data = {
											subscription: found,
											agreement: suspendResult
										};

										found.id = found._id.toString();
										found.status = "suspend sent";
										delete found._id;
										
										return ctx.call("subscriptions.save", {
											entity: found
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
													return ctx.call("users.removeContentDependencies")
														.then(updatedUser => {
															this.logger.info("subscriptions.suspend - users.removeContentDependencies updatedUser:", updatedUser);
															return subResult;
														})
												}
											});

									})
									.catch(error => {
										result.error = "paypalSuspendBillingAgreement";
										this.logger.error("subscriptions.suspend - "+result.error+" error: ", JSON.stringify(error));
										self.addToHistory(ctx, found._id, self.newHistoryRecord("error", "user", { 
											errorMsg: result.error+" error", 
											error: error
										}));
										return result;
									});
							} else {
								result.error = "relatedId not found";
								this.logger.error("subscriptions.suspend - " + result.error);
								self.addToHistory(ctx, found._id, self.newHistoryRecord("error", "user", { 
									errorMsg: result.error+" error"
								}));
								return result;
							}
						}
					})
					.catch(error => {
						this.logger.error("subscriptions.suspend - subscriptions.find error: ", error);
						return null;
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
		calculateDates: {
			cache: false,
			params: {
				period: { type: "string" }, 
				duration: { type: "number" }, 
				dateStart: { type: "string" }, //type: "date" },
				cycles: { type: "number" },
				withDateEnd: { type: "boolean", optional: true }
			},
			handler(ctx) {
				ctx.params.withDateEnd = typeof withDateEnd === "undefined" ? true : ctx.params.withDateEnd;
				ctx.params.dateStart = new Date(ctx.params.dateStart);
				const dateOrderNext = this.calculateDateOrderNext(
					ctx.params.period,
					ctx.params.duration,
					ctx.params.dateStart
				);
				let dateEnd = null;
				if (ctx.params.withDateEnd) {
					dateEnd = this.calculateDateEnd(
						ctx.params.dateStart,
						ctx.params.period,
						ctx.params.duration,
						ctx.params.cycles
					);
				}
				return {
					dateOrderNext: dateOrderNext,
					dateEnd: dateEnd
				};
			}
		},


		/**
		 * 
		 * @param {Object} subscription
		 * 
		 * @returns {Object} date of next order
		 */
		createPaidSubscriptionOrder: {
			cache: false,
			params: {
				subscription: { type: "object" } 
			},
			handler(ctx) {
				return this.createPaidSubscriptionOrder(ctx, ctx.params.subscription);
			}
		},

	},



	/**
	 * Core methods required by this service are located in
	 * /methods/code.methods.js
	 */
	methods: {
	},

	events: {
		"cache.clean.subscriptions"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
