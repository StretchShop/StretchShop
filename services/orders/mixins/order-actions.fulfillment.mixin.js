"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const path = require("path");
const pathResolve = path.resolve;
const { createReadStream } = require("fs-extra");
const { ReadStream } = require("fs");
const jwt = require("jsonwebtoken");
const fetch = require("cross-fetch");

module.exports = {
	actions: {
		cleanOrders: {
			cache: false,
			handler(ctx) {
				let promises = [];
				const d = new Date();
				d.setMonth(d.getMonth() - 1);
				return this.adapter.find({
					query: {
						"dates.dateChanged": { "$lt": d },
						status: "cart"
					}
				})
					.then(found => {
						found.forEach(order => {
							promises.push(
								ctx.call("orders.remove", { id: order._id })
									.then(removed => {
										return "Removed orders: " + JSON.stringify(removed);
									})
									.catch(err => {
										console.error("order.cleanOrders remove error: ", err);
										return this.Promise.reject(new MoleculerClientError("Order clean remove error", 422, "", []));
									})
							);
						});
						// return all delete results
						return Promise.all(promises).then((result) => {
							return result;
						})
							.catch(err => {
								console.error("order.cleanOrders promises error: ", err);
								return this.Promise.reject(new MoleculerClientError("Orders clean error", 422, "", []));
							});
					})
					.catch(err => {
						console.error("order.cleanOrders find error: ", err);
						return this.Promise.reject(new MoleculerClientError("Order clean find error", 422, "", []));
					});
			}
		},

		/**
		 * Download invoice PDF
		 * 
		 * @actions
		 * 
		 * @param {String} invoice - id of invoice
		 * 
		 * @returns {ReadStream} Stream of invoice PDF file
		 */
		invoiceDownload: {
			cache: false,
			auth: "required",
			params: {
				invoice: { type: "string", min: 3 }
			},
			handler(ctx) {
				this.logger.info("orders.invoiceDownload - id #" + ctx.params.invoice + " request by user: ", ctx.meta.user);
				const sepIndex = ctx.params.invoice.indexOf(".");
				if (sepIndex < 1) {
					return Promise.reject(new MoleculerClientError("Invalid invoice", 400));
				}
				const userId = ctx.params.invoice.slice(0, sepIndex);
				const invoiceId = ctx.params.invoice.slice(sepIndex + 1);
				const isAdmin = ctx.meta.user.type === "admin";
				const isOwner = ctx.meta.user._id && ctx.meta.user._id.toString() === userId;

				if (!isAdmin && !isOwner) {
					return Promise.reject(new MoleculerClientError("Forbidden", 403));
				}
				// Allow only safe basename characters (generated invoice ids are alphanumeric)
				if (!invoiceId || !/^[\w-]+$/.test(invoiceId)) {
					return Promise.reject(new MoleculerClientError("Invalid invoice", 400));
				}

				const assets = process.env.PATH_PUBLIC || "./public";
				const assetsPath = process.env.ASSETS_PATH || "";
				const root = pathResolve(assets, assetsPath, "invoices", userId);
				const filePath = pathResolve(root, invoiceId + ".pdf");
				const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

				if (filePath !== root && !filePath.startsWith(rootWithSep)) {
					return Promise.reject(new MoleculerClientError("Invalid invoice", 400));
				}

				this.logger.info("orders.invoiceDownload - path:", { path: filePath, resolvedPath: filePath });
				try {
					return createReadStream(filePath);
				} catch (e) {
					this.logger.error("orders.invoiceDownload - id #" + ctx.params.invoice + " error:", JSON.stringify(e));
					return null;
				}
			}
		},


		/**
		 * Admin only action
		 * Change order state to paid
		 * 
		 * @actions
		 * 
		 * @param {String} orderId - id of order to pay
		 * 
		 * @returns {Object} Unified result from related action
		 */
		paid: {
			cache: false,
			auth: "required",
			params: {
				orderId: { type: "string", min: 3 }
			},
			handler(ctx) {
				// only admin can generate invoices
				if (ctx.meta.user.type == "admin") {
					if (ctx.params.orderId.trim() != "") {
						this.logger.info("orders.paid - marking order as paid, id: ", ctx.params.orderId);
						return this.adapter.findById(ctx.params.orderId)
							.then(order => {
								// specific for admin
								order.status = "paid";
								order.dates.datePaid = new Date();
								if (!order.data.paymentData.paidAmountTotal) { order.data.paymentData["paidAmountTotal"] = 0; }
								order.data.paymentData.paidAmountTotal = order.prices.priceTotal;
								if (!order.data.paymentData.lastResponseResult) { order.data.paymentData["lastResponseResult"] = []; }
								order.data.paymentData.lastResponseResult.push({
									description: "Marked as Paid by Admin by Generating Invoice",
									date: new Date(),
									userId: ctx.meta.user._id.toString()
								});
								// do actions that happen after payment
								return this.orderPaymentReceived(ctx, order, "admin")
									.then(result => {
										return result;
									})
									.catch(err => {
										console.error("order.paid paymentReceived error: ", err);
										return this.Promise.reject(new MoleculerClientError("Order payR error", 422, "", []));
									});
							})
							.catch(err => {
								console.error("order.paid find error: ", err);
								return this.Promise.reject(new MoleculerClientError("Order pay find error", 422, "", []));
							});
					}
				}
			}
		},


		/**
		 * Admin only action
		 * Change order state to expeded
		 * 
		 * @actions
		 * 
		 * @param {String} orderId - id of order to expede
		 * 
		 * @returns {Object} Unified result from related action
		 */
		expede: {
			cache: false,
			auth: "required",
			params: {
				orderId: { type: "string", min: 3 }
			},
			handler(ctx) {
				let result = { success: false, order: null, message: null };
				const self = this;
				// only admin can mark order as expeded
				if (ctx.meta.user.type == "admin") {
					if (ctx.params.orderId.trim() != "") {
						return this.adapter.findById(ctx.params.orderId)
							.then(order => {
								if (!order) {
									result.message = "error: Order not found";
									return result;
								}
								// specific for admin
								order.status = "expeded";
								order.dates.dateChanged = new Date();
								order.dates.dateExpeded = new Date();
								if (!order.data) { order.data = {}; }
								if (!order.data.paymentData) { order.data.paymentData = {}; }
								if (!order.data.paymentData.lastResponseResult) {
									order.data.paymentData.lastResponseResult = [];
								}
								order.data.paymentData.lastResponseResult.push({
									description: "Marked as Expeded by Admin",
									date: new Date(),
									userId: ctx.meta.user._id.toString()
								});

								let orderId = order._id.toString();
								delete order.id;
								delete order._id;
								const update = {
									"$set": order
								};

								// update order document
								return self.adapter.updateById(orderId, update)
									.then(doc => {
										return this.transformDocuments(ctx, {}, doc);
									})
									.then(json => {
										return this.entityChanged("updated", json, ctx)
											.then(() => {
												self.logger.info("order.expede - expede success: ");
												result.success = true;
												result.order = json;
												return result;
											});
									})
									.catch(error => {
										self.logger.error("order.expede - update error: ", error);
										result.message = "error: " + (error?.message || JSON.stringify(error));
										return result;
									});
							})
							.catch(error => {
								self.logger.error("order.expede - not found: ", error);
								result.message = "error: " + (error?.message || JSON.stringify(error));
								return result;
							});
					}
				}
			}
		},

		/**
		 * Admin only action
		 * Batch update orders
		 * 
		 * @actions
		 * 
		 * @param {Array} orderIds - ids of orders to update
		 * @param {Object} action - action to perform
		 * @param {String} action.name - name of action
		 * @param {String} action.value - value of action
		 * 
		 * @returns {Array} results of updates
		 */
		batch: {
			cache: false,
			auth: "required",
			params: {
				orderIds: { type: "array", items: { type: "string", min: 3 } },
				action: {
					type: "object", required: true,
					properties: {
						name: { type: "string", enum: ["status"] },
						value: { type: "string", min: 3 }
					}
				}
			},
			handler(ctx) {
				if (!ctx.params.orderIds || ctx.params.orderIds.length === 0) {
					return this.Promise.reject(new MoleculerClientError("Orders not found", 404, "", []));
				}
				ctx.params.orderIds = ctx.params.orderIds.map(id => this.fixStringToId(id));
				return this.adapter.find({ query: { _id: { $in: ctx.params.orderIds } } })
					.then(found => {
						if (found.length === 0) {
							return this.Promise.reject(new MoleculerClientError("Orders not found", 404, "", []));
						}
						let update = {};
						if (ctx.params.action.name === "status") {
							update["$set"] = {};
							update["$set"]["status"] = ctx.params.action.value;
							update["$set"]["dates.dateChanged"] = new Date();
							if (ctx.params.action.value === "expeded") {
								update["$set"]["dates.dateExpeded"] = new Date();
							}
							if (ctx.params.action.value === "paid") {
								update["$set"]["dates.datePaid"] = new Date();
							}
							if (ctx.params.action.value === "cancelled") {
								update["$set"]["dates.dateCancelled"] = new Date();
							}
						} else {
							return this.Promise.reject(new MoleculerClientError("Invalid action", 400, "", []));
						}
						this.logger.info("order.batch - update: ", { _id: { $in: ctx.params.orderIds } }, update);
						return this.adapter.updateMany({ _id: { $in: ctx.params.orderIds } }, update)
							.then(result => {
								return result;
							})
							.catch(error => {
								this.logger.error("order.batch - error: ", error);
								return this.Promise.reject(new MoleculerClientError("Order batch error", 422, "", []));
							});
					});
			}
		},


		/**
		 * SUBSCRIPTION FLOW - 2.1 (BE->API)
		 * Call API related to payment type supplier
		 * 
		 * @actions
		 * 
		 * @param {String} supplier - supplier codename (eg. stripe)
		 * @param {String} relatedId - id related to subscription (like API object id)
		 * @param {String} subscription - related subscription object
		 * 
		 * @returns {Object} response from service
		 * 
		 */
	}
};
