"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const pathResolve = require("path").resolve;
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
								ctx.call("orders.remove", {id: order._id} )
									.then(removed => {
										return "Removed orders: " +JSON.stringify(removed);
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
				this.logger.info("orders.invoiceDownload - id #"+ctx.params.invoice+" request by user: ", ctx.meta.user);
				let invoiceData = ctx.params.invoice.split(".");
				if ( invoiceData[1] && ctx.meta.user._id && ctx.meta.user._id==invoiceData[0] ) {
					let assets = process.env.PATH_PUBLIC || "./public";
					let dir = assets +"/"+ process.env.ASSETS_PATH +"invoices/"+ invoiceData[0];
					let path = dir + "/" + invoiceData[1] + ".pdf";
					this.logger.info("orders.invoiceDownload - path:", {path: path, resolvedPath: pathResolve(path)});
					try {
						let readStream = createReadStream( pathResolve(path) );
						// We replaced all the event handlers with a simple call to readStream.pipe()
						// readStream.pipe(ctx.options.parentCtx.params.res);
						return readStream;
					} catch(e) {
						this.logger.error("orders.invoiceDownload - id #"+ctx.params.invoice+" error:", JSON.stringify(e));
						return null;
					}
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
				if ( ctx.meta.user.type=="admin" ) {
					if ( ctx.params.orderId.trim() != "" ) {
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
				if ( ctx.meta.user.type=="admin" ) {
					if ( ctx.params.orderId.trim() != "" ) {
						return this.adapter.findById(ctx.params.orderId)
							.then(order => {
								// specific for admin
								order.status = "expeded";
								order.dates.dateChanged = new Date();
								order.dates.dateExpeded = new Date();
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
										result.message = "error: " + JSON.stringify(error);
										return result;
									});
							})
							.catch(error => {
								self.logger.error("order.expede - not found: ", error);
								result.message = "error: " + JSON.stringify(error);
								return result;
							});
					}
				}
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
