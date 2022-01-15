"use strict";

require("dotenv").config();
const pathResolve = require("path").resolve;
const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("@stretchshop/moleculer-cron");
const { createReadStream } = require("fs-extra");

// global mixins
const DbService = require("../../mixins/db.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");
const priceLevels = require("../../mixins/price.levels.mixin");
const FileHelpers = require("../../mixins/file.helpers.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");

// methods
const OrdersMethodsBasic = require("./methods/core.methods");
const OrdersMethodsHelpers = require("./methods/helpers.methods");
const OrdersMethodsSubscription = require("./methods/subscription.methods");
// service specific mixins
const paymentWebhook = require("./mixins/payments.webhook.mixin");
const paymentsPaypal = require("./mixins/payments.paypal1.mixin"); // Paypal API v1
const paymentsStripe = require("./mixins/payments.stripe.mixin");

// settings
const sppf = require("../../mixins/subproject.helper");
let resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../resources");
const orderSettings = require(resourcesDirectory+"/settings/orders");



module.exports = {
	name: "orders",
	mixins: [
		DbService("orders"),
		HelpersMixin,
		priceLevels,
		FileHelpers,
		// methods
		OrdersMethodsBasic,
		OrdersMethodsHelpers,
		OrdersMethodsSubscription,
		// mixins
		paymentWebhook,
		paymentsPaypal,
		paymentsStripe,
		// events
		CacheCleanerMixin([
			"cache.clean.orders"
		]),
		Cron
	],

	crons: [{
		name: "OrdersCleaner",
		cronTime: "10 1 * * *",
		onTick: function() {

			this.logger.info("Starting to Clean up the Orders");

			this.getLocalService("orders")
				.actions.cleanOrders()
				.then((data) => {
					this.logger.info("Orders Cleaned up", data);
				});
		}
	}],

	/**
	 * Default settings
	 */
	settings: {
		/** Secret for JWT */
		JWT_SECRET: process.env.JWT_SECRET || "jwt-stretchshop-secret",

		/** Public fields */
		fields: [
			"_id", "externalId", "externalCode",
			"status", "user", "ip",
			"dates",
			"lang", "country", "addresses",
			"prices", "items",
			"data",
			"notes",
			"settings",
			"invoice"
		],

		/** Validator schema for entity */
		entityValidator: {

			externalId: { type: "string", min: 3 },
			externalCode: { type: "string", min: 3 },
			status: { type: "string", min: 3 },
			user: {
				type: "object", props: {
					id: { type: "string", min: 3 },
					externalId: { type: "string", min: 3 },
					username: { type: "string", min: 2 },
					email: { type: "email" },
				}
			},
			ip: { type: "string", min: 4 },
			dates: {
				type: "object", props: {
					dateCreated: { type: "date" },
					dateChanged: { type: "date" },
					dateSent: { type: "date" },
					datePaid: { type: "date" },
					dateExpeded: { type: "date" },
					emailSent: { type: "date" }
				}
			},
			lang: { type: "string", min: 2 },
			country: { type: "string", min: 2 },
			addresses: {
				type: "object", props: {
					invoiceAddress: { type: "object" },
					deliveryAddress: { type: "object" },
				}
			},
			prices: {
				type: "object", props: {
					currency: { type: "string" },
					priceTotal: { type: "number" },
					priceTotalNoTax: { type: "number" },
					priceGoods: { type: "number" },
					priceGoodsNoTax: { type: "number" },
					priceDelivery: { type: "number" },
					pricePayment: { type: "number" }
				}
			},
			items: { type: "array", items: { type: "object", props:
				{
					id: { type: "string", min: 2 },
					externalId: { type: "string", min: 1 },
					orderCode: { type: "string", min: 1 },
					amount: { type: "number", positive: true },
					parentId: { type: "number", positive: true },
					itemDesc: {
						type: "object", props: {
							name: { type: "string", min: 1, optional: true },
							description: { type: "string", min: 1, optional: true },
						}
					},
					properties: {
						type: "object", props: { // size, color, upgrades, serial number, ...
						}
					},
					prices: {
						type: "object", props: {
							price: { type: "number", positive: true },
							priceNoTax: { type: "number", positive: true },
							priceTotal: { type: "number", positive: true },
							priceTotalNoTax: { type: "number", positive: true },
							tax: { type: "number", positive: true },
						}
					},
					url: { type: "string", min: 2 },
				}
			}},
			data: {
				type: "object", props: {
					deliveryData: { type: "object" },
					paymentData: { type: "object" },
					couponData: { type: "object", optional: true },
					requirements: { type: "object", optional: true },
					optional: { type: "object", optional: true }
				}
			},
			notes: {
				type: "object", props: {
					customerNote: { type: "string" },
					sellerNote: { type: "string" },
				}
			},
			settings: { type: "object" },
			invoice: { type: "object", optional: true }
		},

		// ------------- ORDER VARIABLES AND SETTINGS -------------
		defaultConstants: {
			tax: 0.2
		},

		order: orderSettings,

		orderTemp: {},
		orderErrors: {
			"itemErrors": [],
			"userErrors": [],
			"orderErrors": []
		},
		emptyUpdateResult: { "id": -1, "name": "order not processed", "success": false },

		paymentsConfigs: {
		}, 

		paths: {
			resources: process.env.PATH_RESOURCES || resourcesDirectory
		}
	},


	/**
	 * Actions
	 */
	actions: {
		/**
		 * Get current order progress according to cart
		 *
		 * @returns {Object} order entity of active user
		 */
		progress: {
			// auth: "required",
			cache: false,
			params: {
				orderParams: { type: "object", optional: true },
			},
			handler(ctx) {
				this.logger.info("order.progress - ctx.params: ", ctx.params);
				ctx.params.orderParams = (typeof ctx.params.orderParams === "undefined" || !ctx.params.orderParams) ? {} : ctx.params.orderParams;
				this.logger.info("order.progress - ctx.params.orderParams: ", ctx.params.orderParams);
				// remove stripeKey if forgotten
				if (
					ctx.params.orderParams && ctx.params.orderParams.settings && 
					ctx.params.orderParams.settings.stripeKey
				) {
					delete ctx.params.orderParams.settings.stripeKey;
				}
				// this.logger.info("orders.progress - ctx.meta: ", ctx.meta);
				return ctx.call("cart.me")
					.then(cart => {
						this.logger.info("order.progress - Cart Result:", cart);
						if (cart.order && cart.order.toString().trim()!="") { // order exists, get it
							return this.adapter.findById(cart.order)
								.then(order => {
									this.logger.info("order.progress - Order Result:", order);
									return this.getOrderProgressAction(ctx, cart, order);
								}); // order found in db END

						} else { // order does not exist, create it
							this.logger.info("order.progress - no order found, CREATE order");
							return this.createOrderAction(cart, ctx, this.adapter);
						}
					}); // cart end
			}
		},


		/**
		 * Insert order from object sent - with recalculating the prices
		 * 
		 * @param {Object} order
		 * 
		 * @returns {Object} saved order
		 */
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
		update: {
			params: {
				order: { type: "object" },
				params: { type: "object", optional: true }
			},
			handler(ctx) {
				let self = this;
				let entity = ctx.params.order;
				// count order prices
				this.logger.info("order.update - order:", entity);

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
						}
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
				fullData: { type: "boolean", optional: true }
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
					filter.query["$or"] = [{"status":"sent"}, {"status":"paid"}];
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

					if ( filter.query && filter.query._id && filter.query._id.trim()!="" ) {
						filter.query._id = this.fixStringToId(filter.query._id);
						filter.limit = 1;
					}

					// send query
					return ctx.call("orders.find", filter)
						.then(found => {
							if (found && found.constructor===Array) { // order found in datasource, return it
								// remove html render of invoice if more than 1 result
								if (found && found.length>1) {
									for (let i=0; i<found.length; i++) {
										if (found[i] && found[i].invoice && found[i].invoice.html) {
											delete found[i].invoice.html;
										}
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
     * @param {String} supplier - supplier name (eg. paypal)
     * @param {String} action - action name (eg. geturl)
     * @param {String} orderId - id of order to pay
     * @param {Object} data - data specific for payment
		 * 
		 * @returns {Object} Unified result from related action
		 */
		payment: {
			params: {
				supplier: { type: "string", min: 3 },
				action: { type: "string", min: 3 },
				orderId: { type: "string", min: 3 },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				// get action to call - get its name from supplier & action params
				let supplier = ctx.params.supplier.toLowerCase();
				let action = ctx.params.action.charAt(0).toUpperCase();
				action += ctx.params.action.slice(1);
				let actionName = supplier+"Order"+action;

				// using resources/settings/orders.js check if final payment action can be called
				this.logger.info("order.payment - calling payment: ", actionName, this.settings.order.availablePaymentActions.indexOf(actionName)>-1);
				if ( this.settings.order.availablePaymentActions &&
				this.settings.order.availablePaymentActions.indexOf(actionName)>-1 ) {
					return ctx.call("orders."+actionName, {
						orderId: ctx.params.orderId,
						data: ctx.params.data
					})
						.then(result => {
							return result;
						})
						.catch(error => {
							this.logger.error("order.payment - calling payment error: ", error);
							return null;
						});
				}
			}
		},


		/**
		 * process result after user paid or agreed and returned to website
		 */
		paymentResult: {
			params: {
				supplier: { type: "string", min: 3 },
				result: { type: "string", min: 3 },
				PayerID: { type: "string", optional: true },
				paymentId: { type: "string", optional: true }
			},
			handler(ctx) {
				let supplier = ctx.params.supplier.toLowerCase();
				let actionName = supplier+"Result";
				let params = {
					result: ctx.params.result,
					PayerID: ctx.params.PayerID,
					paymentId: ctx.params.paymentId
				};
				// token params
				if (ctx.params.token) {
					params.token = ctx.params.token;
				}
				if (ctx.params.ba_token) {
					params.ba_token = ctx.params.ba_token;
				}

				// using resources/settings/orders.js check if final payment action can be called
				if ( this.settings.order.availablePaymentActions &&
				this.settings.order.availablePaymentActions.indexOf(actionName)>-1 ) {
					return ctx.call("orders."+actionName, params)
						.then(result => {
							return result;
						});
				}
			}
		},



		/**
		 * Remove orders that have not changed from cart status 
		 * for more than a month
		 */
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
							);
						});
						// return all delete results
						return Promise.all(promises).then((result) => {
							return result;
						});
					});
			}
		}, 

		
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
									});
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
		 * @param {String} supplier - supplier codename (eg. paypal, stripe)
		 * @param {String} relatedId - id related to subscription (like API object id)
		 * @param {String} subscription - related subscription object
		 * 
		 * @returns {Object} response from service
		 * 
		 */
		paymentSuspend: {
			cache: false,
			auth: "required",
			params: {
				supplier: { type: "string", min: 3 },
				relatedId: { type: "string", min: 3 },
				subscription: { type: "object" }
			},
			handler(ctx) {
				let supplier = (ctx.params.supplier) ? ctx.params.supplier : "paypal";
				
				this.logger.info("orders.paymentSuspend params: ", ctx.params);

				// get name of action to call for this supplier
				return ctx.call("orders."+supplier+"SuspendBillingAgreement", {
					billingRelatedId: ctx.params.relatedId
				} )
					.then(suspendResult => {
						this.logger.info("orders.paymentSuspend supplier call response: ", suspendResult);
						return suspendResult;
					})
					.catch(error => {
						this.logger.error("order.paymentSuspend - error: ", error, JSON.stringify(error));
						return null;
					});
			}
		} 


	},

	/**
	 * Core methods required by this service are located in
	 * /methods/code.methods.js
	 */
	methods: {

		/**
		 * Update this function as you need after project created using npm install
		 */
		afterPaidActions() {
			// replace this action with your own
			this.logger.info("afterPaidActions default");
		},

	},

	events: {
		"cache.clean.order"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
