"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
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
						if (subscriptions[i]?.data?.subscription) {
							if (subscriptions[i].data.subscription.period) {
								subscription.period = subscriptions[i].data.subscription.period;
							}
							if (subscriptions[i].data.subscription.duration) {
								subscription.duration = subscriptions[i].data.subscription.duration;
							}
							if (subscriptions[i].data.subscription.cycles) {
								subscription.cycles = subscriptions[i].data.subscription.cycles;
							}
							if (subscriptions[i].data.subscription.cyclesTrial) {
								subscription.cyclesTrial = subscriptions[i].data.subscription.cyclesTrial;
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
						// if trial period is set, set dateEnd to trial end
						if (subscription.cyclesTrial && subscription.cyclesTrial>0) {
							// set dateEnd to trial end	
							subscription.status = "trial";
							subscription.dates.dateOrderNext = this.setDateOrderNextAfterTrial(
								subscription.dates.dateOrderNext, 
								subscription.period, 
								subscription.duration,
								subscription.cyclesTrial
							);
						}
						subscription.price = subscriptions[i].price;

						subscription.history.push( 
							this.newHistoryRecord("created", "user", {
								type: "from order",
								relatedOrder: ctx.params.order._id.toString()
							}) 
						);

						// setting up date when subscription ends
						console.log("calling calculateDateEnd #1", subscription);
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
								})
								.catch(err => {
									this.logger.error("subscriptions.orderToSubscription subscriptions.save error:", err);
									return this.Promise.reject(new MoleculerClientError("Subscriptions Ssave error", 422, "", []));
								})); // push with save end
					}
				}

				// return multiple promises results
				return Promise.all(promises)
					.then(savedSubscriptions => {
						this.logger.info("subscriptions.orderToSubscription Promise.all(promises):", promises);
						// save IDs into related order
						let subscrIds = [];
						let productSubscriptions = {};
						savedSubscriptions.forEach(function(sasu){
							// collect important information into order.subscription.ids
							// this will be important for order detail and decision making
							subscrIds.push({
								created: new Date(),
								updated: null,
								lastPaidDate: null,
								subscription: sasu._id.toString(),
								product: sasu.data.product._id.toString(),
								status: "saved",
								supplier: {}
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
						for (const element of ctx.params.order.items) {
							element.subscriptionId = productSubscriptions[element._id.toString()];
						}
						this.logger.info("subscriptions.orderToSubscription Promise.all(promises) subscrIds:", subscrIds);
						// add ID parameter
						ctx.params.order.id = ctx.params.order._id;
						// saving ids into related order
						return ctx.call("orders.updateOrder", {
							order: { ...ctx.params.order}
						})
							.then(order => {
								// save IDs
								if (order) {
									return savedSubscriptions;
								}
							})
							.catch(err => {
								this.logger.error("subscriptions.orderToSubscription orders.updateOrder error:", err);
								return this.Promise.reject(new MoleculerClientError("Subscriptions updateO error", 422, "", []));
							});
					})
					.catch(err => {
						this.logger.error("subscriptions.orderToSubscription promises error:", err);
						return this.Promise.reject(new MoleculerClientError("Subscriptions o2s all error", 422, "", []));
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
	}
};
