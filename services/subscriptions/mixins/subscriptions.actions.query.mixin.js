"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
		find: {
			cache: false
		},


		/**
		 * Get currently active user's subscriptions
		 *
		 * @actions
		 * @param {Object} query - Main query
		 * @param {Number} limit - Limit
		 * @param {Number} offset - Offset
		 * @param {String} sort - Sorting string
		 * @param {Boolean} fullData - Return data for all users
		 *
		 * @returns {Object} - with results and count
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
	}
};
