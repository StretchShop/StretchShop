"use strict";

require("dotenv").config();
const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("moleculer-cron");

const passGenerator = require("generate-password");
const fetch 		= require("node-fetch");
const paypal = require("paypal-rest-sdk");
const payments = paypal.v1.payments;

const DbService = require("../mixins/db.mixin");
const HelpersMixin = require("../mixins/helpers.mixin");
const pathResolve = require("path").resolve;
const FileHelpers = require("../mixins/file.helpers.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

const sppf = require("../mixins/subprojpathfix");
let resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojpathfix(__dirname, "/../resources");
const orderSettings = require(resourcesDirectory+"/settings/orders");

const { writeFileSync, ensureDir, createReadStream } = require("fs-extra");
let pdfMake = require("pdfmake/build/pdfmake");
let pdfFonts = require("pdfmake/build/vfs_fonts");
pdfMake.vfs = pdfFonts.pdfMake.vfs;
let htmlToPdfmake = require("html-to-pdfmake");
let jsdom = require("jsdom");
let { JSDOM } = jsdom;
let { window } = new JSDOM("");
const handlebars = require("handlebars");
const businessSettings = require( resourcesDirectory+"/settings/business");

module.exports = {
	name: "orders",
	mixins: [
		DbService("orders"),
		HelpersMixin,
		FileHelpers,
		CacheCleanerMixin([
			"cache.clean.orders"
		]),
		Cron
	],

	crons: [{
		name: "OrdersCleaner",
		cronTime: "10 1 * * *",
		onTick: function() {

			console.log("Starting to Clean up the Orders");

			this.getLocalService("orders")
				.actions.cleanOrders()
				.then((data) => {
					console.log("Orders Cleaned up", data);
				});
		}
	}],

	/**
	 * Default settings
	 */
	settings: {
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
					couponData: { type: "object" }
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
			paypal: {
				environment: (process.env.PAYPAL_ENV==="production" || process.env.PAYPAL_ENV==="live") ? "live" : "sandbox",
				merchantId: process.env.PAYPAL_CLIENT_ID,
				publicKey: null,
				privateKey: process.env.PAYPAL_SECRET,
				gateway: null
			}
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
		 * @returns {Object} cart entity with items
		 */
		progress: {
			// auth: "required",
			cache: false,
			params: {
				orderParams: { type: "object", optional: true },
			},
			handler(ctx) {
				let updateResult = this.settings.emptyUpdateResult;
				console.log("\n\n"+"order.progress - intro (IN):", ctx.meta, "\n\n");

				return ctx.call("cart.me")
					.then(cart => {
						console.log("\n\n"+"order.progress - cart result (CR):", cart, "\n\n");
						if (cart.order && cart.order.toString().trim()!="") { // order exists, get it
							return this.adapter.findById(cart.order)
								.then(order => {
									console.log("\n\n"+"order.progress - order result (OR):", cart, "\n\n");
									if ( order && order.status=="cart" ) {
										// update order items
										if ( cart.items ) {
											order.items = cart.items;
										}

										// run processOrder(orderParams) to proces user input and
										// update order data according to it
										this.settings.orderTemp = order;
										updateResult = this.processOrder(ctx);
										this.getAvailableOrderSettings();
										console.log("\n\n"+"order.progress - cart order found updated (COFU):", updateResult, "\n\n");
										// if no params (eg. only refreshed), return original order
										if ( !ctx.params.orderParams || Object.keys(ctx.params.orderParams).length<1 ) {
											let orderProcessedResult = {};
											orderProcessedResult.order = order;
											orderProcessedResult.result = updateResult;
											if ( !updateResult.success ) {
												orderProcessedResult.errors = this.settings.orderErrors;
											}
											return orderProcessedResult;
										}
										// if order check returns success, order can be saved
										if ( updateResult.success ) {
											this.settings.orderTemp.status = "saved";
										}
										// order ready to save and send - update order data in related variables
										order = this.settings.orderTemp;
										cart.order = order._id;
										return ctx.call("cart.updateCartItemAmount", {cartId: cart._id, cart: cart})
											.then(() => { //(cart2)
												return this.adapter.updateById(order._id, this.prepareForUpdate(order))
													.then(orderUpdated => {
														this.entityChanged("updated", orderUpdated, ctx);
														// if order was processed with errors, add them to result for frontend
														let orderProcessedResult = {};
														orderProcessedResult.order = orderUpdated;
														orderProcessedResult.result = updateResult;
														if ( !updateResult.success ) {
															orderProcessedResult.errors = this.settings.orderErrors;
														} else {
															// order was processed without errors, run afterSaveActions
															orderProcessedResult = this.orderAfterSaveActions(ctx, orderProcessedResult);
														}
														return orderProcessedResult;
													});
											});
									} else { // cart has order id, but order with 'cart' status not found
										console.log("\n\n"+"CREATE order - orderId from cart not found"+"\n\n");

										if (
											(
												!this.settings.orderTemp.user ||
												(typeof this.settings.orderTemp.user.id==="undefined" || this.settings.orderTemp.user.id===null || this.settings.orderTemp.user.id=="")
											) &&
											(ctx.params.orderParams.addresses && ctx.params.orderParams.addresses.invoiceAddress && ctx.params.orderParams.addresses.invoiceAddress.email)
										) {
											if ( ctx.meta.user && ctx.meta.user._id && ctx.meta.user._id.toString().trim()!="" ) {
												this.settings.orderTemp.user = ctx.meta.user._id;
											} else { // user not set in meta data

												return ctx.call("users.checkIfEmailExists", {
													email: ctx.params.orderParams.addresses.invoiceAddress.email
												})
													.then((exists) => { // promise #1
														if (exists) {
															this.settings.orderErrors.orderErrors.push({"value": "Email", "desc": "already exists"});
															if ( this.settings.orderErrors.userErrors.length>0 ) {
																return null;
															}
														} else {
															let userData = this.getDataToCreateUser(ctx);
															return ctx.call("users.create", userData)
																.then(newUser => {  // promise #2
																	// new user created, add his data to order and create special variable to process it with createOrderAction
																	if ( newUser && newUser.user && newUser.user._id && newUser.user._id!="" ) {
																		ctx.params.orderParams.user.id = newUser.user._id;
																		ctx.params.orderParams.user.email = newUser.user.email;
																		ctx.params.orderParams.user.token = newUser.user.token;
																		ctx.meta.userNew = true;
																	}
																	return this.createOrderAction(cart, ctx, this.adapter);
																})
																.catch(userCreateRej => {
																	console.log("new user rejected: ", userCreateRej);
																	return null;
																});
														}
													});

											}
										} else { // default option, creates new order if none found - TODO - add auto clear
											return this.createOrderAction(cart, ctx, this.adapter);
										}
									}
								});
						} else { // order does not exist, create it
							console.log("\n\n"+"CREATE order - no order (NO):"+"\n\n");
							return this.createOrderAction(cart, ctx, this.adapter);
						}
					}); // cart end
			}
		},


		cancel: {
			params: {
				itemId: { type: "string", min: 3, optional: true },
				amount: { type: "number", positive: true, optional: true }
			},
			handler(ctx) {
				// get cart
				return ctx.call("cart.me")
					.then(cart => {
						// check if there are any items inside
						if ( cart.items.length>0 ) {
							if ( ctx.params.itemId ) {
								// find product in cart
								let productInCart = -1;
								for (let i=0; i<cart.items.length; i++) {
									if (cart.items[i]._id == ctx.params.itemId) {
										productInCart = i;
										break;
									}
								}
								// if found, remove one product from cart
								if (productInCart>-1) {
									if ( ctx.params.amount && ctx.params.amount>0 ) {
										// remove amount from existing value
										cart.items[productInCart].amount = cart.items[productInCart].amount - ctx.params.amount;
										if (cart.items[productInCart].amount<=0) {
											// if new amount less or equal to 0, remove whole product
											cart.items.splice(productInCart, 1);
										}
									} else {
										// remove whole product from cart
										cart.items.splice(productInCart, 1);
									}
								}
							} else {
								// no ID, remove all items from cart
								cart.items = [];
							}
							// update cart in variable and datasource
							ctx.meta.cart = cart;
							return this.adapter.updateById(ctx.meta.cart._id, cart);
						}
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
				// check if we have logged user
				if ( ctx.meta.user._id ) { // we have user
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

					// send query
					return ctx.call("orders.find", filter)
						.then(found => {
							if (found) { // cart found in datasource, save to meta
								return found;
							} else { // no cart found in datasource, create one
								return Promise.reject(new MoleculerClientError("Orders not found!", 400, "", [{ field: "orders", message: "not found"}]));
							}
						});
				}

			}
		},

		/**
		 * Send payment info to PayPal and get redirect url  or error message
		 *
		 * @actions
		 * 
		 * @returns {Object} Result from PayPal order checkout
		 */
		paypalOrderCheckout: {
			params: {
				orderId: { type: "string", min: 3 },
				checkoutData: { type: "object", optional: true }
			},
			handler(ctx) {
				let result = { success: false, url: null, message: "error" };

				// get order data
				return this.adapter.findById(ctx.params.orderId)
					.then(order => {
						if ( order ) {
							let paymentType = order.data.paymentData.codename.replace("online_paypal_","");

							let items = [];
							for (let i=0; i<order.items.length; i++ ) {
								items.push({
									"name": order.items[i].name[order.lang.code],
									"sku": order.items[i].orderCode,
									"price": this.formatPrice(order.items[i].price),
									"currency": order.prices.currency.code,
									"quantity": order.items[i].amount
								});
							}
							items.push({
								"name": order.data.paymentData.name[order.lang.code],
								"sku": order.data.paymentData.name[order.lang.code],
								"price": this.formatPrice(order.prices.pricePayment),
								"currency": order.prices.currency.code,
								"quantity": 1
							});
							let deliveryName = "Delivery - ";
							if (order.data.deliveryData.codename && order.data.deliveryData.codename.physical) {
								deliveryName += order.data.deliveryData.codename.physical.value;
							}
							if (order.data.deliveryData.codename && order.data.deliveryData.codename.digital) {
								deliveryName += order.data.deliveryData.codename.digital.value;
							}
							items.push({
								"name": deliveryName,
								"sku": deliveryName,
								"price": this.formatPrice(order.prices.priceDelivery),
								"currency": order.prices.currency.code,
								"quantity": 1
							});

							let client = this.createPayPalHttpClient();

							let url = ctx.meta.siteSettings.url;
							if ( process.env.NODE_ENV=="development" ) {
								url = "http://localhost:3000";
							}

							let payment = {
								"intent": "sale",
								"payer": {
									"payment_method": paymentType
								},
								"redirect_urls": {
									"cancel_url": url +"/backdirect/order/paypal/cancel",
									"return_url": url +"/backdirect/order/paypal/return"
								},
								"transactions": [{
									"item_list": {
										"items": items
									},
									"amount": {
										"currency": order.prices.currency.code,
										"total": this.formatPrice(order.prices.priceTotal)
									},
									// "note_to_payer": "Order ID "+order._id,
									"soft_descriptor": process.env.SITE_NAME.substr(0,22) // maximum length of accepted string
								}]
							};
							console.log("\n\n PAYMENT:\n", payment, "\n", payment.transactions[0].item_list.items, "\n", payment.transactions[0].amount, "\n\n");

							let request = new payments.PaymentCreateRequest();
							request.requestBody(payment);

							return client.execute(request).then((response) => {
								order.data.paymentData.paymentRequestId = response.result.id;
								return this.adapter.updateById(order._id, this.prepareForUpdate(order))
									.then(orderUpdated => {
										this.entityChanged("updated", orderUpdated, ctx);
										console.log(orderUpdated);
										return { order: orderUpdated, payment: response };
									});
							})
								.then(responses => {
									console.log("response.statusCode", responses.payment.statusCode, "\n\n");
									console.log("response.result", responses.payment.result, "\n\n");

									if (responses.payment.result) {
										for (let i=0; i<responses.payment.result.links.length; i++) {
											if (responses.payment.result.links[i].rel=="approval_url") {
												result.url = responses.payment.result.links[i].href;
												break;
											}
										}
									}
									if ( result.url!=null && typeof result.url=="string" && result.url.trim()!="" ) {
										result.success = true;
									}
									return result;
								}).catch((error) => {
									console.error(error.statusCode);
									console.error(error.message);
									result.message = error.message;
									return result;
								});
						} // if order
					});
			}
		},

		/**
		 * process PayPal result after user paid and returned to website
		 */
		paypalResult: {
			params: {
				result: { type: "string", min: 3 },
				PayerID: { type: "string" },
				paymentId: { type: "string" }
			},
			handler(ctx) {
				console.log("paypalResult:", ctx.params);
				if ( ctx.params.result == "return" ) {
					// get order data
					return ctx.call("orders.find", {
						"query": {
							"data.paymentData.paymentRequestId": ctx.params.paymentId
						}
					})
						.then(orders => {
							if ( orders && orders.length>0 && orders[0] ) {
								let order = orders[0];

								const execute_payment_json = {
									"payer_id": ctx.params.PayerID,
									"transactions": [{
										"amount": {
											"currency": order.prices.currency.code,
											"total": this.formatPrice(order.prices.priceTotal)
										}
									}]
								};

								let client = this.createPayPalHttpClient();
								let request = new payments.PaymentExecuteRequest(ctx.params.paymentId);
								request.requestBody(execute_payment_json);

								return client.execute(request).then((response) => {
									console.log("\n\n---------- PAYPAL RESPONSE ----------\npaypalResult response:", response);
									console.log("\n\npaypalResult response.result.payer.payer_info:", response.result.payer.payer_info);
									console.log("\n\npaypalResult response.result.transactions:", response.result.transactions);
									console.log("\n\npaypalResult response.result.links:", response.result.links);

									order.dates.datePaid = new Date();
									order.status = "paid";
									order.data.paymentData.lastStatus = response.result.state;
									order.data.paymentData.lastDate = new Date();
									order.data.paymentData.paidAmountTotal = 0;
									if ( !order.data.paymentData.lastResponseResult ) {
										order.data.paymentData.lastResponseResult = [];
									}
									order.data.paymentData.lastResponseResult.push(response.result);
									// calculate total amount paid
									for ( let i=0; i<order.data.paymentData.lastResponseResult.length; i++ ) {
										if (order.data.paymentData.lastResponseResult[i].state && 
											order.data.paymentData.lastResponseResult[i].state == "approved" && 
											order.data.paymentData.lastResponseResult[i].transactions) {
											for (let j=0; j<order.data.paymentData.lastResponseResult[i].transactions.length; j++) {
												if (order.data.paymentData.lastResponseResult[i].transactions[j].amount && 
													order.data.paymentData.lastResponseResult[i].transactions[j].amount.total) {
													order.data.paymentData.paidAmountTotal += parseFloat(
														order.data.paymentData.lastResponseResult[i].transactions[j].amount.total
													);
												}
											}
										}
									}
									// calculate how much to pay
									order.prices.priceTotalToPay = order.prices.priceTotal - order.data.paymentData.paidAmountTotal;
									return this.generateInvoice(order, ctx)
										.then(invoice => {
											order.invoice["html"] = invoice.html;
											order.invoice["path"] = invoice.path;
											return this.adapter.updateById(order._id, this.prepareForUpdate(order))
												.then(orderUpdated => {
													this.entityChanged("updated", orderUpdated, ctx);
													let urlPathPrefix = "/";
													if ( process.env.NODE_ENV=="development" ) {
														urlPathPrefix = "http://localhost:8080/";
													}
													console.log( { success: true, response: response, redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id } );
													return { success: true, response: response, redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id };
												});
										});
								}).catch((error) => {
									console.error(error.statusCode);
									console.error(error.message);
								});
							}
						});
				} else {
					// payment not finished
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
				console.log("ctx.params.invoice:", ctx.params.invoice);
				console.log("ctx.meta.user:", ctx.meta.user);
				let invoiceData = ctx.params.invoice.split(".");
				if ( invoiceData[1] && ctx.meta.user._id && ctx.meta.user._id==invoiceData[0] ) {
					let assets = process.env.PATH_PUBLIC || "./public";
					let dir = assets +"/"+ process.env.ASSETS_PATH +"invoices/"+ invoiceData[0];
					let path = dir + "/" + invoiceData[1] + ".pdf";
					console.log("path:", path);
					console.log("pathResolve:", pathResolve(path));
					let readStream = createReadStream( pathResolve(path) );
					// console.log("ctx", ctx.options.parentCtx.params.res);
					// We replaced all the event handlers with a simple call to readStream.pipe()
					// readStream.pipe(ctx.options.parentCtx.params.res);
					return readStream;
				}
			}
		}, 

		invoiceGenerate: {
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
								return this.generateInvoice(order, ctx)
									.then(invoice => {
										order.invoice["html"] = invoice.html;
										order.invoice["path"] = invoice.path;
										return this.adapter.updateById(order._id, this.prepareForUpdate(order))
											.then(orderUpdated => {
												this.entityChanged("updated", orderUpdated, ctx);
												return orderUpdated.invoice;
											});
									});
							});
					}
				}
			}
		}

	},

	/**
	 * Methods
	 */
	methods: {

		createEmptyOrder(ctx) {
			let order = {
				"externalId": null,
				"externalCode": null,
				"status": "cart",
				"user": {
					"id": (ctx.meta.user && ctx.meta.user._id) ? ctx.meta.user._id : null,
					"externalId": (ctx.meta.user && ctx.meta.user.externalId) ? ctx.meta.user.externalId : null,
					"username": (ctx.meta.user && ctx.meta.user.username) ? ctx.meta.user.username : null,
					"email": (ctx.meta.user && ctx.meta.user.email) ? ctx.meta.user.email : null,
				},
				"ip": ctx.meta.remoteAddress,
				"dates": {
					"dateCreated": new Date(),
					"dateChanged": null,
					"dateSent": null,
					"datePaid": null,
					"dateExpeded": null,
					"userConfirmation": null
				},
				"lang": this.getValueByCode(ctx.meta.localsDefault.langs,ctx.meta.localsDefault.lang),
				"country": this.getValueByCode(ctx.meta.localsDefault.countries,ctx.meta.localsDefault.country),
				"addresses": {
					"invoiceAddress": null,
					"deliveryAddress": null
				},
				"prices": {
					"currency": this.getValueByCode(ctx.meta.localsDefault.currencies,ctx.meta.localsDefault.currency),
					"priceTotal": null,
					"priceTotalNoTax": null,
					"priceItems": null,
					"priceItemsNoTax": null,
					"priceTaxTotal": null,
					"priceDelivery": null,
					"pricePayment": null
				},
				"items": [],
				"data": {
					"deliveryData": null,
					"paymentData": null,
					"couponData": null,
				},
				"notes": {
					"customerNote": null,
					"sellerNote": null,
				}
			};

			return order;
		},


		createOrderAction(cart, ctx, adapter){
			let updateResult = this.settings.emptyUpdateResult;
			let order = this.createEmptyOrder(ctx);
			// update order items
			if ( cart.items ) {
				order.items = cart.items;
			}
			// run processOrder(orderParams) to update order data
			this.settings.orderTemp = order;
			this.getAvailableOrderSettings();
			if ( ctx.params.orderParams ) {
				console.log("createOrderAction -> before updateResult");
				updateResult = this.processOrder(ctx);
				console.log("createOrderAction -> updateResult: ", updateResult);
				if ( !updateResult.success ) {
					console.log( "Order NO SUCCESS: ", this.settings.orderErrors );
				}
			}
			// update order data in related variables
			order = this.settings.orderTemp;
			console.log("\n\n----------order before save--------", order);
			cart.order = order._id;
			// save new order
			return adapter.insert(order)
				.then(orderNew => {
					this.entityChanged("updated", orderNew, ctx);
					cart.order = orderNew._id; // order id is not saved to cart
					console.log("\n\n order after save (OAS) -----: ", orderNew);
					return ctx.call("cart.updateMyCart", {"cartNew": cart})
						.then(() => { //(cart2)
							let orderProcessedResult = {};
							orderProcessedResult.order = orderNew;
							orderProcessedResult.result = updateResult;
							if ( !updateResult.success ) {
								orderProcessedResult.errors = this.settings.orderErrors;
							}
							return orderProcessedResult;
						});
				});
		},


		/**
		 * Main service to call on order updates from
		 * Returns these states:
		 * 0: missing cart items
		 * 1: missing user data
		 * 2: missing order data
		 * 3: order ready but not confirmed
		 * 4: order confirmed, ready to save with "saved" status
		 */
		processOrder(ctx) {
			if (this.settings.orderTemp) {
			// update order params
				if ( typeof ctx.params.orderParams !== "undefined" && ctx.params.orderParams ) {
					this.settings.orderTemp = this.updateBySentParams(this.settings.orderTemp, ctx.params.orderParams);
					// console.log("\n processOrder ctx.meta \n", ctx.meta);
					if ( ctx.meta.userNew && ctx.meta.userNew===true ) {
						console.log( "\n\n setting new user data \n\n" );
						this.settings.orderTemp.user.id = ctx.params.orderParams.user.id;
						this.settings.orderTemp.user.email = ctx.params.orderParams.user.email;
						this.settings.orderTemp.user.token = ctx.params.orderParams.user.token;
					}
				}
				this.settings.orderTemp.dates.dateChanged = new Date();
				console.log( "processOrder orderTemp: ", this.settings.orderTemp );

				if (this.checkCartItems()) {
					if (this.checkUserData(ctx)) { // check if (invoice address) is set and valid
						if (this.checkOrderData()) { // check if order data (delivery, payment) are set and done
							if (this.checkConfirmation()) {
								return { "id": 4, "name": "confirmed", "success": true };
							} else {
								return { "id": 3, "name": "missing confirmation", "success": false };
							}
						} else {
							return { "id": 2, "name": "missing order data", "success": false };
						}
					} else {
						return { "id": 1, "name": "missing user data", "success": false };
					}
				} else {
					return { "id": 0, "name": "missing cart items", "success": false };
				}
			}

			return false;
		},


		/**
		 * Updates order parameters using parameters from request
		 * according to template created with createEmptyOrder().
		 * From level 2 it enables to create objects by request.
		 */
		updateBySentParams(orderParams, updateParams, level) {
			level = (typeof level !== "undefined") ?  level : 0;
			let self = this;
			let level1protectedProps = ["user", "id"];
			// loop updateParams and check, if they exist in orderParams
			Object.keys(updateParams).forEach(function(key) {
				if ( !(level==0 && level1protectedProps.includes(key)) ) {
					if ( ((orderParams && Object.prototype.hasOwnProperty.call(orderParams,key)) || level>=2) ) { // order has this property
						// update it
						if ( orderParams===null ) {
							orderParams = {};
						}
						if ( typeof updateParams[key] === "object" ) {
							if ( !orderParams[key] || orderParams[key]===null ) {
								orderParams[key] = {};
							}
							if (updateParams[key]!==null) {
								orderParams[key] = self.updateBySentParams(orderParams[key], updateParams[key], level+1);
							} else {
								orderParams[key] = null;
							}
						} else {
							orderParams[key] = updateParams[key];
						}
					}
				}
			});

			return orderParams;
		},


		/**
		 * Check if there are cart items set
		 */
		checkCartItems() {
			if ( this.settings.orderTemp && this.settings.orderTemp.items ) {
				if ( this.settings.orderTemp.items.length>0 ) {
					return true;
				} else {
					this.settings.orderErrors.itemErrors.push({"value": "Cart items", "desc": "no items"});
				}
			} else {
				this.settings.orderErrors.itemErrors.push({"value": "Cart items", "desc": "not set"});
			}
			return false;
		},


		/**
		 * Check if all items to register user and make order on his name are set
		 */
		checkUserData(ctx) {
			let requiredFields = ["email", "phone", "nameFirst", "nameLast", "street", "zip", "city", "country"];
			if ( ctx.meta.userID && ctx.meta.userID.toString().trim()!=="" ) {
				requiredFields = ["phone", "nameFirst", "nameLast", "street", "zip", "city", "country"];
			}
			// let optionalFileds = ["state", "street2"];
			this.settings.orderErrors.userErrors = [];
			let self = this;

			if ( !this.settings.orderTemp || !this.settings.orderTemp.addresses ||
			!this.settings.orderTemp.addresses.invoiceAddress ) {
				this.settings.orderErrors.userErrors.push({"value": "Invoice address", "desc": "not set"});
				return false;
			}

			// split name
			if ( this.settings.orderTemp.addresses && this.settings.orderTemp.addresses.invoiceAddress ) {
				if ( this.settings.orderTemp.addresses.invoiceAddress.name && this.settings.orderTemp.addresses.invoiceAddress.name.indexOf(" ") ) {
					let nameSplit = this.settings.orderTemp.addresses.invoiceAddress.name.split(" ");
					this.settings.orderTemp.addresses.invoiceAddress.nameFirst = nameSplit[0];
					if ( nameSplit.length>1 ) {
						this.settings.orderTemp.addresses.invoiceAddress.nameLast = nameSplit[nameSplit.length-1];
					}
				}
			}

			if ( this.settings.orderTemp.addresses.invoiceAddress && this.settings.orderTemp.addresses.invoiceAddress!==null ) {
				let hasErrors = false;
				requiredFields.forEach(function(value){
					if ( !self.settings.orderTemp.addresses.invoiceAddress[value] || self.settings.orderTemp.addresses.invoiceAddress[value].toString().trim()=="" ) {
						self.settings.orderErrors.userErrors.push({"value": "Invoice address value '"+value+"'", "desc": "not found"});
						hasErrors = true;
					}
				});
				if (hasErrors) {
					return false;
				}
			} else {
				this.settings.orderErrors.userErrors.push({"value": "Invoice address", "desc": "not set"});
				return false;
			}

			return true;
		},


		checkIfUserEmailExists(ctx) {
			console.log("CTX:", ctx.params);
			if ( ctx.params.orderParams && ctx.params.orderParams.addresses && ctx.params.orderParams.addresses.invoiceAddress ) {
				console.log(" --- -- - 3.1 - ");
			}
		},


		/**
		 * Check that define basic options of order - delivery and payment types
		 * Get prices of delivery and payment from settings
		 */
		checkOrderData() {
			this.settings.orderErrors.orderErrors = [];
			let self = this;

			// check if delivery type is set
			if ( this.settings.orderTemp.data.deliveryData && this.settings.orderTemp.data.deliveryData.codename ) {
				let deliveryType = this.settings.orderTemp.data.deliveryData.codename;
				this.settings.orderTemp.data.deliveryData = { "codename": deliveryType };
				let deliveryMethodExists = false;

				Object.keys(deliveryType).forEach(function(typeKey){
					if (deliveryType[typeKey]!=null) {
						self.settings.order.deliveryMethods.some(function(value){
							if ( !deliveryType[typeKey].value ) {
								let valueTemp = deliveryType[typeKey];
								deliveryType[typeKey] = { value: valueTemp };
							}
							if ( value && value.codename==deliveryType[typeKey].value ) {
								self.settings.orderTemp.data.deliveryData.codename[typeKey] = {};
								// need to filter language later
								self.settings.orderTemp.data.deliveryData.codename[typeKey].value = value.codename;
								console.log("deliveryValue: ", value);
								// count item prices to get count for delivery
								self.settings.orderTemp.prices.priceItems = 0;
								self.countOrderPrices("items");
								if ( self.settings.orderTemp.prices.priceItems>0 ) {
									// TODO - check if all items in cart are physical / digital and change delivery according to it
									value.prices.some(function(deliveryPrice){
										if ( self.settings.orderTemp.prices.priceItems>=deliveryPrice.range.from && self.settings.orderTemp.prices.priceItems<deliveryPrice.range.to ) {
											// have match set the delivery price
											self.settings.orderTemp.prices.priceDelivery = deliveryPrice.price;
											self.settings.orderTemp.data.deliveryData.codename[typeKey].price = deliveryPrice.price;
											return true;
										}
									});
								}
								deliveryMethodExists = true;
								return true;
							}
						});
					}
				});
				if (!deliveryMethodExists) {
					this.settings.orderErrors.orderErrors.push({"value": "Deliverry type", "desc": "not found"});
				}
			} else {
				this.settings.orderErrors.orderErrors.push({"value": "Deliverry type", "desc": "not set"});
			}

			// check if payment type is set
			if ( this.settings.orderTemp.data.paymentData && this.settings.orderTemp.data.paymentData.codename ) {
				let paymentType = this.settings.orderTemp.data.paymentData.codename;
				this.settings.orderTemp.data.paymentData = { "codename": paymentType };
				let paymentMethodExists = false;

				this.settings.order.paymentMethods.some(function(value){
					if ( value && value.codename==paymentType ) {
						// need to filter language later
						self.settings.orderTemp.data.paymentData.name = value.name;
						console.log("paymentValue: ", value);
						//--
						if ( self.settings.orderTemp.prices.priceItems <= 0 ) {
							self.countOrderPrices(false);
						}
						value.prices.some(function(paymentPrice){
							if ( self.settings.orderTemp.prices.priceItems>=paymentPrice.range.from && self.settings.orderTemp.prices.priceItems<paymentPrice.range.to ) {
								// have match set the delivery price
								self.settings.orderTemp.prices.pricePayment = paymentPrice.price;
								self.settings.orderTemp.data.paymentData.price = paymentPrice.price;
								return true;
							}
						});
						paymentMethodExists = true;
						return true;
					}
				});
				if (!paymentMethodExists) {
					this.settings.orderErrors.orderErrors.push({"value": "Payment type", "desc": "not found"});
				}
			} else {
				this.settings.orderErrors.orderErrors.push({"value": "Payment type", "desc": "not set"});
			}

			if ( this.settings.orderErrors.orderErrors.length>0 ) {
				return false;
			} else {
				this.countOrderPrices("totals");
			}
			return true;
		},


		/**
		 * Count cart items total price and order total prices
		 */
		countOrderPrices(calculate) {
			let calcTypes = ["all", "items", "totals"];
			calculate = (typeof calculate !== "undefined" && calcTypes.includes(calculate)) ?  calculate : "all";
			let self = this;
			// use default VAT if not custom eg. for product
			let tax = self.settings.defaultConstants.tax;

			// prices of items
			if ( calculate=="all" || calculate=="items" ) {
				this.settings.orderTemp.prices.priceItems = 0;
				this.settings.orderTemp.prices.priceItemsNoTax = 0;
				this.settings.orderTemp.items.forEach(function(value){
					self.settings.orderTemp.prices.priceItems += (value.price * value.amount);
					if ( value.tax && value.tax!=null ) {
						tax = value.tax;
					}
					let priceNoTax = value.price / (1 + tax);
					self.settings.orderTemp.prices.priceItemsNoTax += priceNoTax;
					let taxOnly = value.price / (1 + tax);
					self.settings.orderTemp.prices.priceTaxTotal += taxOnly;
				});
				this.settings.orderTemp.prices.priceItems = this.formatPrice(this.settings.orderTemp.prices.priceItems);
				this.settings.orderTemp.prices.priceItemsNoTax = this.formatPrice(this.settings.orderTemp.prices.priceItemsNoTax);
				this.settings.orderTemp.prices.priceTaxTotal = this.formatPrice(this.settings.orderTemp.prices.priceTaxTotal);
			}

			// count other totals
			if ( calculate=="all" || calculate=="totals" ) {
				this.settings.orderTemp.prices.priceTotal = this.settings.orderTemp.prices.priceItems +
					this.settings.orderTemp.prices.priceDelivery +
					this.settings.orderTemp.prices.pricePayment;
				this.settings.orderTemp.prices.priceTotal = this.formatPrice(this.settings.orderTemp.prices.priceTotal);
				let priceDeliveryNoTax = this.settings.orderTemp.prices.priceDelivery / (1 + tax);
				let pricePaymentNoTax = this.settings.orderTemp.prices.pricePayment / (1 + tax);
				this.settings.orderTemp.prices.priceTotalNoTax = this.settings.orderTemp.prices.priceItemsNoTax +
					priceDeliveryNoTax + pricePaymentNoTax;
				this.settings.orderTemp.prices.priceTotalNoTax = this.formatPrice(this.settings.orderTemp.prices.priceTotalNoTax);
			}
		},


		/**
		 * Check that define basic options of order - delivery and payment types
		 * Get prices of delivery and payment from settings
		 */
		checkConfirmation() {
			console.log( this.settings.orderTemp.dates.userConfirmation, this.settings.orderTemp.dates.userConfirmation, Date.now() );
			if ( this.settings.orderTemp.dates.userConfirmation && this.settings.orderTemp.dates.userConfirmation < Date.now() ) {
				return true;
			} else {
				this.settings.orderErrors.orderErrors.push({"value": "Confirmation", "desc": "missing"});
			}

			return false;
		},


		/**
		 * Get Delivery and Payment settings
		 */
		getAvailableOrderSettings() {
			if ( typeof this.settings.orderTemp.settings == "undefined" ) {
				this.settings.orderTemp.settings = {};
			}
			this.getAvailableDeliveries();
			this.getAvailablePayments();
		},


		/**
		 * Loop available delivery types
		 */
		getAvailableDeliveries() {
			let self = this;
			let usedProductTypes = [];

			if (this.settings.orderTemp.items && this.settings.orderTemp.items.length>0) {
				Object.keys(this.settings.orderTemp.items).forEach((itemKey) => { // loop items
					if ( usedProductTypes.indexOf(self.settings.orderTemp.items[itemKey].subtype)<0 ) {
						usedProductTypes.push( self.settings.orderTemp.items[itemKey].subtype );
					}
				}); // loop items end
			}

			console.log("orders.getAvailableDeliveries.usedProductTypes:", usedProductTypes);

			if ( usedProductTypes.length>0 ) {
				if ( typeof this.settings.orderTemp.settings == "undefined" ) {
					this.settings.orderTemp.settings = {};
				}
				this.settings.orderTemp.settings.deliveryMethods = [];
				Object.keys(this.settings.order.deliveryMethods).forEach((deliveryKey) => { // loop deliveries
					if ( usedProductTypes.indexOf(this.settings.order.deliveryMethods[deliveryKey].type)>-1  ) {
						this.settings.orderTemp.settings.deliveryMethods.push( this.settings.order.deliveryMethods[deliveryKey] );
					}
				}); // loop deliveries end
			}
		},


		/**
		 * Loop available payment types
		 */
		getAvailablePayments() {
			if ( typeof this.settings.orderTemp.settings === "undefined" ) {
				this.settings.orderTemp.settings = {};
			}
			this.settings.orderTemp.settings.paymentMethods = this.settings.order.paymentMethods;
		},


		/**
		 * Run Actions that should follow After Order was checked and Saved
		 *
		 * @returns {Object} order complete result with result, errors
		 */
		orderAfterSaveActions(ctx, orderProcessedResult) {
			let self = this;

			// 1. if set url, send order. If no url or send was success, set status to Sent.
			console.log("this.settings.order.sendingOrder: ", this.settings.order.sendingOrder);
			if ( this.settings.order.sendingOrder && this.settings.order.sendingOrder.url && this.settings.order.sendingOrder.url.toString().trim()!="" ) {
				let auth = "Basic " + Buffer.from(this.settings.order.sendingOrder.login + ":" + this.settings.order.sendingOrder.password).toString("base64");
				return fetch(this.settings.order.sendingOrder.url+"?action=order", {
					method: "post",
					body:    JSON.stringify({"shopId": "StretchShop","order":orderProcessedResult.order}),
					headers: { "Content-Type": "application/json", "Authorization": auth },
				})
					.then(res => res.json()) // expecting a json response, checking it
					.then(orderSentResponse => {
						console.log("orderSentResponse: ", orderSentResponse);
						// check if response has the most important information about how order was processed
						console.log( orderSentResponse.type , orderSentResponse.type=="success" ,
							orderSentResponse.result.status );
						if ( orderSentResponse.type && orderSentResponse.type=="success" &&
						orderSentResponse.result && orderSentResponse.result.status &&
						orderSentResponse.result.order ) {
							// order SENT, response type is success
							// if response is SUCCESS, nothing has to be changed by user, return original order
							if ( orderSentResponse.result.status=="accepted" ) {
								// process response
								let updatedOrder = this.processResponseOfOrderSent(orderProcessedResult.order, orderSentResponse.result.order);
								// 2. clear cart + 3. send email
								return self.orderAfterAcceptedActions(ctx, orderProcessedResult)
									.then(success => {
										if ( success ) {
											orderProcessedResult.order = updatedOrder;
											orderProcessedResult.order.status = "sent";
											orderProcessedResult.order.dates.emailSent = new Date();
											// save with sent status and email sent date after it
											return this.adapter.updateById(orderProcessedResult.order._id, self.prepareForUpdate(orderProcessedResult.order))
												.then(() => { //(orderUpdated)
													this.entityChanged("updated", orderProcessedResult, ctx);
													return orderProcessedResult;
												});
										}
									});
							} else {
								// response is CHANGED or REJECTED - send response without changes to front-side so user makes decision
								return orderProcessedResult;
							}
						} else { // something is wrong with order data or server
							// return original response, but add error
							if ( !orderSentResponse.errors ) {
								orderSentResponse.errors = [];
							}
							orderSentResponse.errors.push({"value": "Server", "desc": "bad response"});
							return orderSentResponse;
						}
					});
			} else { // no url to send
				// 2. clear cart + 3. send email
				return self.orderAfterAcceptedActions(ctx, orderProcessedResult)
					.then(success => {
						if ( success ) {
							orderProcessedResult.order.dates.emailSent = new Date();
							// save after it
							return orderProcessedResult;
						}
					});
			}
		},


		/**
		 * This function verifies data from sent response, and if they were
		 * updated, it defines the logic of what new data will be used and what
		 * remains same.
		 * This implementation represents the most conservative version - changes
		 * only amount of cart items. It's up to business model if any more liberal
		 * approach is needed. But be carefull to not create backdoors.
		 */
		processResponseOfOrderSent(orderOriginal, orderResponse) {
			if ( orderOriginal && orderResponse ) {
				// update externalIds
				if ( orderResponse.externalId && orderResponse.externalId.toString().trim()!="" ) {
					orderOriginal.externalId = orderResponse.externalId;
				}
				if ( orderResponse.externalCode && orderResponse.externalCode.toString().trim()!="" ) {
					orderOriginal.externalCode = orderResponse.externalCode;
				}
				// update items
				if ( orderOriginal.items && orderOriginal.items.length>0 &&
				orderResponse.items && orderResponse.items.length>0 &&
				orderOriginal.items.length==orderResponse.items.length ) {
					Object.keys(orderOriginal.items).forEach(function(key){
						/** items of both orders must satisfy these rules:
						 *   - response must have items,
	 					 *   - both orders' items must have same value of ._id property on same array position,
						 *   - both orders' items must have .amount property
						 */
						if ( orderResponse.items[key] &&
						orderOriginal.items[key]._id && orderResponse.items[key]._id &&
						orderResponse.items[key]._id==orderResponse.items[key]._id &&
						orderOriginal.items[key].amount && orderResponse.items[key].amount ) {
							// if it has responseAction set
							if ( orderOriginal.items[key].responseAction ) {
								if ( orderOriginal.items[key].responseAction=="updated" ) {
									orderOriginal.items[key].amount = orderResponse.items[key].amount;
								} else if ( orderOriginal.items[key].responseAction=="rejected" ) {
									orderOriginal.items[key].amount = 0;
								}
							}
						}
					});
				}
			}

			return orderOriginal;
		},



		/**
		 * actions to perform after order was sent and accepted
		 *
		 * @returns {Boolean}
		 */
		orderAfterAcceptedActions(ctx, orderResult) {
			let self = this;
			console.log("orderAfterAcceptedActions (OrderResult):", orderResult);
			// 1. clear the cart
			return ctx.call("cart.delete")
				.then(() => { //(cart)
					// 2. send email about order
					let userEmail = "";
					if ( typeof ctx.meta.user.email !== "undefined" && ctx.meta.user.email ) {
						userEmail = ctx.meta.user.email;
					}
					if ( typeof self.settings.orderTemp.addresses.invoiceAddress.email !== "undefined" && self.settings.orderTemp.addresses.invoiceAddress.email ) {
						userEmail = self.settings.orderTemp.addresses.invoiceAddress.email;
					}
					console.log("\n\norders.service.orderAfterAcceptedActions:", userEmail, ctx.meta.user, self.settings.orderTemp.addresses.invoiceAddress);
					ctx.call("users.sendEmail",{ // return 
						template: "ordered",
						data: {
							order: self.settings.orderTemp
						},
						settings: {
							subject: "StretchShop - Your Order #"+self.settings.orderTemp._id,
							to: userEmail
						}
					})
						.then(booleanResult => {
							console.log("Email order SENT:", booleanResult);
							//return true;
						});
					return true;
				});
		},


		/**
		 * Generate invoice PDF from order
		 * 
		 * @param {*} order 
		 * @param {*} ctx 
		 */
		generateInvoice(order, ctx) {
			if (order) {
				let parentDir = this.settings.paths.resources+"/pdftemplates/";
				parentDir = this.removeParentTraversing(parentDir);
				let filepath = parentDir +"invoice-"+order.lang.code+".html";
				filepath = pathResolve(filepath);

				return this.getCorrectFile(filepath)
					.then( (template) => {
						let lastInvoiceNumber = 0;
						return this.adapter.find({
							sort: "-invoice.num",
							limit: 1
						})
							.then(lastDbInvoiceNum => {
								if (lastDbInvoiceNum && lastDbInvoiceNum.length>0 && 
									lastDbInvoiceNum[0].invoice && 
									lastDbInvoiceNum[0].invoice.id) {
									lastInvoiceNumber = lastDbInvoiceNum[0].invoice.num;
								}
								return lastInvoiceNumber + 1;
							})
							.then(newInvoiceNum => {
								// get invoice number
								let needToUpdate = true;
								if ( order.invoice && order.invoice.num && order.invoice.num>0 ) {
									newInvoiceNum = order.invoice.num;
									needToUpdate = false;
								}
								let newInvoiceIdCode = this.generateInvoiceNumber(newInvoiceNum, new Date());
								// set invoice data to order to update
								order["invoice"] = { 
									num: newInvoiceNum,
									id: newInvoiceIdCode
								};
								order.dates["dateInvoiceIssued"] = new Date();
								if (!needToUpdate) {
									// update order
									return this.adapter.updateById(order._id, this.prepareForUpdate(order))
										.then(orderUpdated => {
											this.entityChanged("updated", orderUpdated, ctx);
											return template;
										});
								}
								// no need to update
								return template;
							});
					})
					.then( (html) => {
						// compile html from template and data
						let template = handlebars.compile(html);
						try {
							template();
						}	catch (error) {
							console.log("handlebars ERROR:", error);
						}
						let data = {
							order: order, 
							business: businessSettings
						};
						data = this.buildDataForTemplate(data);
						html = template(data);
						return html;
					})
					.then( (html) => {
						let logo1 = "./public/assets/_site/logo-words-horizontal.svg";
						return this.readFile(logo1)
							.then( (logoCode) => {
								logoCode = logoCode.replace(/(width\s*=\s*["'](.*?)["'])/, 'width="240"').replace(/(height\s*=\s*["'](.*?)["'])/, 'height="53"');
								return html.toString().replace("<!-- company_logo //-->",logoCode);
							})
							.catch(logoCodeErr => {
								console.log("logoCodeErr1:", logoCodeErr);
								return html;
							});
					})
					.then( (html) => {
						let template = htmlToPdfmake(html, {window:window});
						let docDefinition = {
							content: [
								template
							],
							styles:{
							}
						};

						let pdfDocGenerator = pdfMake.createPdf(docDefinition);
						let publicDir = process.env.PATH_PUBLIC || "./public";
						let dir = publicDir +"/"+ process.env.ASSETS_PATH +"/invoices/"+ order.user.id;
						let path = dir + "/" + order.invoice.id + ".pdf";
						let sendPath = "invoices/"+ order.user.id + "/" + order.invoice.id + ".pdf";
						pdfDocGenerator.getBuffer(function(buffer) {
							return ensureDir(dir, 0o2775)
								.then(() => {
									console.log("path:", path);
									writeFileSync(path, buffer);
									console.log("--> " + path);
								})
								.catch(orderEnsureDirErr => {
									console.log("orderEnsureDirErr:", orderEnsureDirErr);
								})
								.then(() => {
									ctx.call("users.sendEmail",{ // return 
										template: "orderpaid",
										data: {
											order: order, 
											html: html
										},
										settings: {
											subject: "StretchShop - We received Payment for Your Order #"+order._id,
											to: order.user.email,
											attachments: [{
												path: path
											}]
										}
									})
										.then(booleanResult => {
											console.log("Email order PAID SENT:", booleanResult);
											//return true;
										});
								});
						});
						return { html: html, path: sendPath };
					});
			}
		},


		/**
		 * Generate invoice number = max 10x numeral characters
		 * 1. number (1x) - eshop code (eg. "5")
		 * 2.-7. number (6x) - date with year and month
		 * 8.-10. number (3x) - number increasing +1
		 * Date and increasing number summed into base of invoice number, 
		 * prefixed with eshop code.
		 * 
		 * @param {*} newInvoiceNum 
		 * @param {*} date 
		 */
		generateInvoiceNumber(newInvoiceNum, date) {
			let eshopNumberCode = businessSettings.invoiceData.eshop.numberCodePrefix;
			let newInvoiceNumBase = date.getFullYear()*100 + (date.getMonth()+1); // 4 + 2 chars
			let zerosAppend = 9 - newInvoiceNumBase.toString().length;
			let zeros = "";
			for (let i=0; i<zerosAppend; i++) {
				zeros += "0";
			}
			newInvoiceNumBase = newInvoiceNumBase + zeros;
			let newInvoiceId = parseInt(newInvoiceNumBase) + newInvoiceNum;
			return eshopNumberCode + newInvoiceId.toString();
		},

		
		/**
		 * Create "Ready" values for items, 
		 * that need to be extracted or generated - eg. localized strings, numbers, ...
		 * 
		 * @param {*} data 
		 */
		buildDataForTemplate(data) {
			let lang = data.order.lang.code;
			data.order.data.paymentData.nameReady = data.order.data.paymentData.name[lang];
			for(let i=0; i<data.order.items.length; i++) {
				data.order.items[i].nameReady = data.order.items[i].name[lang];
				data.order.items[i].itemTotal = data.order.items[i].price * data.order.items[i].amount;
			}
			// reformat dates
			Object.keys(data.order.dates).forEach(function(key) {
				if ( data.order.dates[key] instanceof Date ) {
					data.order.dates[key] = data.order.dates[key].toISOString();
				}
			});
			// set delivery types
			let deliveryDataCodenames = {};
			let deliveryDataReady = [];
			if ( data.order.data.deliveryData.codename.physical ) {
				deliveryDataCodenames[data.order.data.deliveryData.codename.physical.value] = data.order.data.deliveryData.codename.physical.price;
			}
			if ( data.order.data.deliveryData.codename.digital ) {
				deliveryDataCodenames[data.order.data.deliveryData.codename.digital.value] = data.order.data.deliveryData.codename.digital.price;
			}
			Object.keys(data.order.settings.deliveryMethods).forEach(function(key) {
				// check if delivery codename exists in order
				if ( data.order.settings.deliveryMethods[key].codename && 
					deliveryDataCodenames[data.order.settings.deliveryMethods[key].codename] ) {
					let deliveryDataRow = {
						name: data.order.settings.deliveryMethods[key].name[lang],
						price: deliveryDataCodenames[data.order.settings.deliveryMethods[key].codename]
					};
					deliveryDataReady.push(deliveryDataRow);
				}
			});
			data.order.data["deliveryDataReady"] = deliveryDataReady;
			// set payment name
			data.order.data.paymentData.nameReady = data.order.data.paymentData.name[lang];
			// return updated order data
			return data;
		},


		/**
		 * Removing _id and wrapping into "$set"
		 * 
		 * @param {*} object 
		 */
		prepareForUpdate(object) {
			let objectToSave = JSON.parse(JSON.stringify(object));
			if ( typeof objectToSave._id !== "undefined" && objectToSave._id ) {
				delete objectToSave._id;
			}
			return { "$set": objectToSave };
		},


		/**
		 * Collecting data for creating user on order of unregistered user
		 * 
		 * @param {*} ctx 
		 */
		getDataToCreateUser(ctx) {
			let userName = ctx.params.orderParams.addresses.invoiceAddress.nameFirst;// +""+ this.settings.orderTemp.addresses.invoiceAddress.nameLast;
			let userPassword = passGenerator.generate({
				length: 10,
				numbers: true
			});
			if ( ctx.params.orderParams.password ) {
				userPassword = ctx.params.orderParams.password;
			}
			let userData = {
				user: {
					username: userName,
					email: ctx.params.orderParams.addresses.invoiceAddress.email,
					password: userPassword,
					type: "user",
					addresses: [ctx.params.orderParams.addresses.invoiceAddress],
					activated: new Date()
				}
			};
			return userData;
		},


		/**
		 * Setting up PayPal HttpClient for specific transaction
		 */
		createPayPalHttpClient() {
			let env;
			if (this.settings.paymentsConfigs.paypal.environment === "live") {
				// Live Account details
				env = new paypal.core.LiveEnvironment(this.settings.paymentsConfigs.paypal.merchantId, this.settings.paymentsConfigs.paypal.privateKey);
			} else {
				env = new paypal.core.SandboxEnvironment(this.settings.paymentsConfigs.paypal.merchantId, this.settings.paymentsConfigs.paypal.privateKey);
			}

			return new paypal.core.PayPalHttpClient(env);
		}
	},

	events: {
		"cache.clean.order"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
