"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const pathResolve = require("path").resolve;
const { createReadStream } = require("fs-extra");
const { ReadStream } = require("fs");
const jwt = require("jsonwebtoken");
const fetch = require("cross-fetch");

module.exports = {
	actions: {
		create: {
			params: {
				order: { type: "object" },
			},
			handler(ctx) {
				let self = this;
				// count order prices
				ctx.params.order = this.countOrderPrices("all", null, ctx.params.order);
				// update dates
				ctx.params.order.dates.dateCreated = new Date();
				ctx.params.order.dates.dateChanged = new Date();

				return this.adapter.insert(ctx.params.order)
					.then(doc => this.transformDocuments(ctx, {}, doc))
					.then(json => {
						return this.entityChanged("created", json, ctx)
							.then(() => {
								this.logger.info("order.create - created do afterSaveActions:", json);
								self.orderAfterSaveActions(ctx, {order: json});
								return json;
							});
					})
					.catch(error => {
						self.logger.error("order.create - insert error: ", error);
						return null;
					});

			}
		},


		/**
		 * Update order with object sent - with recalculating the prices
		 * 
		 * @param {Object} order
		 * 
		 * @returns {Object} saved order
		 */
		updateOrder: {
			params: {
				order: { type: "object" },
				params: { type: "object", optional: true }
			},
			handler(ctx) {
				let self = this;
				let entity = ctx.params.order;
				// count order prices
				this.logger.info("order.update - order:", entity?.id, entity);

				return this.adapter.findById(entity.id)
					.then(found => {
						if (found) { // entity found, update it
							if ( entity ) {
								entity = this.countOrderPrices("all", null, entity);
								// update dates
								entity.dates.dateChanged = new Date();

								let entityId = entity.id;
								delete entity.id;
								delete entity._id;
								const update = {
									"$set": entity
								};

								return self.adapter.updateById(entityId, update)
									.then(doc => this.transformDocuments(ctx, {}, doc))
									.then(json => {
										return this.entityChanged("updated", json, ctx)
											.then(() => {
												this.logger.info("order.update - updated order:", json);
												self.orderAfterSaveActions(ctx, {order: json});
												return json;
											});
									})
									.catch(error => {
										self.logger.error("order.create - insert error: ", error);
										return null;
									});
							}
						} else {
							self.logger.warn("order.update - order not found:", entity.id);
							return null;
						}
					})
					.catch(err => {
						console.error("order.create find error: ", err);
						return this.Promise.reject(new MoleculerClientError("Order create error", 422, "", []));
					});

			}
		},


		/**
		 * Cancel order
		 * 
		 * @actions
		 * 
		 * @param {String} orderId - id of order to cancel
		 * 
		 * @returns {Object} saved order
		 */
		cancel: {
			cache: false,
			auth: "required",
			params: {
				orderId: { type: "string", min: 3 },
				items: { type: "array", optional: true }
			},
			handler(ctx) {
				let result = { success: false, order: null, message: null };
				let self = this;

				return this.adapter.findById(ctx.params.orderId)
					.then(order => {
						order.status = "canceled";
						order.dates.dateChanged = new Date();
						if (order.dates["dateCanceled"]) { order.dates["dateCanceled"] = null; }
						order.dates.dateCanceled = new Date();
						if (order.data["canceledUserId"]) { order.dates["canceledUserId"] = null; }
						order.data.canceledUserId = ctx.meta.user._id.toString();
						
						let orderId = order._id.toString();
						delete order.id;
						delete order._id;
						order.invoice = {};
						const update = {
							"$set": order
						};

						return self.adapter.updateById(orderId, update)
							.then(doc => {
								return this.transformDocuments(ctx, {}, doc);
							})
							.then(json => {
								return this.entityChanged("updated", json, ctx)
									.then(() => {
										self.logger.info("order.cancel - cancel success: ");
										result.success = true;
										result.order = json;
										return result;
									});
							})
							.catch(error => {
								self.logger.error("order.cancel - update error: ", error);
								result.message = "error: " + JSON.stringify(error);
								return result;
							});
					})
					.catch(error => {
						self.logger.error("order.cancel - not found: ", error);
						result.message = "error: " + JSON.stringify(error);
						return result;
					});
			}
		},


		/**
		 * List user orders if logged in
		 *
		 * @actions
		 *
		 * @returns {Object} Orders list
		 */
		listOrders: {
			// cache: {
			// 	keys: ["#cartID"]
			// },
			cache: false,
			auth: "required",
			params: {
				query: { type: "object", optional: true },
				limit: { type: "number", optional: true },
				offset: { type: "number", optional: true },
				sort: { type: "string", optional: true },
				fullData: { type: "boolean", optional: true },
				paymentStatus: { type: "boolean", optional: true } // add payment status to every order
			},
			handler(ctx) {
				let self = this;

				// check if we have logged user
				if ( ctx.meta.user && ctx.meta.user._id ) { // we have user
					let filter = { query: {}, limit: 20};
					if (typeof ctx.params.query !== "undefined" && ctx.params.query) {
						filter.query = ctx.params.query;
					}
					// update filter acording to user
					if ( ctx.meta.user.type=="admin" && typeof ctx.params.fullData!=="undefined" && ctx.params.fullData==true ) {
						// admin can browse all orders
					} else {
						filter.query["user.id"] = ctx.meta.user._id.toString();
					}
					filter.query["$or"] = [{"status":"saved"}, {"status":"sent"}, {"status":"paid"}, {"status":"expeded"}];
					// set offset
					if (ctx.params.offset && ctx.params.offset>0) {
						filter.offset = ctx.params.offset;
					}
					// set max of results
					if (typeof ctx.params.limit !== "undefined" && ctx.params.limit) {
						filter.limit = ctx.params.limit;
					}
					if (filter.limit>10) {
						filter.limit = 10;
					}
					// sort
					filter.sort = "-dates.dateCreated";
					if (typeof ctx.params.sort !== "undefined" && ctx.params.sort) {
						filter.sort = ctx.params.sort;
					}

					if ( filter?.query?._id && filter.query._id.trim()!="" ) {
						filter.query._id = this.fixStringToId(filter.query._id);
						filter.limit = 1;
					}

					// send query
					return ctx.call("orders.find", filter)
						.then(found => {
							if (found?.constructor===Array) { // order found in datasource, return it
								// remove html render of invoice if more than 1 result
								if (found.length>1) {
									for (const element of found) {
										if (element?.invoice?.html) {
											delete element.invoice.html;
											delete element.data;
											delete element.user.data.stripe;
										}
									}
								}
								// add payment status if requested
								if (ctx.params.paymentStatus) {
									for (const element of found) {
										element.data["paymentStatus"] = self.getOrderPaymentStatus(element);
									}
								}
								return ctx.call("orders.count", filter)
									.then(count => {
										return {
											total: count,
											results: found
										};
									})
									.catch(error => {
										self.logger.error("orders.listOrders count error", error);
										return Promise.reject(new MoleculerClientError("Orders not found!..", 400, "", [{ field: "orders", message: "not found"}]));
									});
							} else { // no order found in datasource
								self.logger.error("orders.listOrders find error", found);
								return Promise.reject(new MoleculerClientError("Orders not found!.", 400, "", [{ field: "orders", message: "not found"}]));
							}
						})
						.catch(error => {
							self.logger.error("orders.listOrders find error", error);
							return Promise.reject(new MoleculerClientError("Orders not found!", 400, "", [{ field: "orders", message: "not found"}]));
						});
				}

			}
		},


		/**
		 * Payment router - call action related to request and 
		 * allowed in the order settings
		 * 
		 * @actions
		 * 
     * @param {String} supplier - supplier name (eg. stripe)
     * @param {String} action - action name (eg. geturl)
     * @param {String} orderId - id of order to pay
     * @param {Object} data - data specific for payment
		 * 
		 * @returns {Object} Unified result from related action
		 */
	}
};
