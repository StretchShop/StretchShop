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
					const { sanitizeMongoQuery, allowlistQueryFields } = require("../../../mixins/mongo.security");
					const queryOptions = { allowedOperators: ["$in", "$gte", "$lte", "$gt", "$lt", "$regex"] };
					let filter = { query: {}, limit: 20};
					if (typeof ctx.params.query !== "undefined" && ctx.params.query) {
						if (ctx.meta.user.type === "admin" && ctx.params.fullData === true) {
							filter.query = sanitizeMongoQuery(ctx.params.query, queryOptions);
						} else {
							filter.query = allowlistQueryFields(ctx.params.query, [
								"_id", "status", "type", "productCode", "orderItemName", "dates.dateCreated"
							], queryOptions);
						}
					}
					// update filter acording to user
					if ( ctx.meta.user.type=="admin" ) {
						// admin can browse all subscriptions
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

					const idQuery = filter.query._id;
					if (typeof idQuery === "string" && idQuery.trim() !== "") {
						filter.query._id = this.fixStringToId(idQuery.trim());
						filter.limit = 1;
					} else if (idQuery && Array.isArray(idQuery.$in)) {
						const ids = idQuery.$in
							.filter((id) => typeof id === "string" && id.trim() !== "")
							.map((id) => this.fixStringToId(id.trim()));
						if (ids.length > 0) {
							filter.query._id = { $in: ids };
						} else {
							delete filter.query._id;
						}
					} else if (idQuery) {
						delete filter.query._id;
					}

					const dateQuery = filter.query["dates.dateCreated"];
					if (dateQuery && typeof dateQuery === "object" && !Array.isArray(dateQuery)) {
						["$gte", "$gt", "$lte", "$lt"].forEach((op) => {
							if (dateQuery[op] == null) {
								return;
							}
							const parsed = new Date(dateQuery[op]);
							if (Number.isNaN(parsed.getTime())) {
								delete dateQuery[op];
							} else {
								dateQuery[op] = parsed;
							}
						});
						if (Object.keys(dateQuery).length === 0) {
							delete filter.query["dates.dateCreated"];
						}
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
							return Promise.all([
								ctx.call("subscriptions.count", filter),
								self.getDistinctSubscriptionValues().catch(error => {
									self.logger.error("subscriptions.listSubscriptions distinct error", error);
									return {
										status: [],
										type: [],
										period: [],
										orderItemName: []
									};
								})
							])
								.then(([count, distinct]) => {
									return {
										total: count,
										results: subscriptions,
										distinct
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
