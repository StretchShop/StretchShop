"use strict";

const { result } = require("lodash");
const url = require("url");
const paypal = require("paypal-rest-sdk");
const HelpersMixin = require("../mixins/helpers.mixin");
const priceLevels = require("../mixins/price.levels.mixin");
const fetch 		= require("node-fetch");

const pathResolve = require("path").resolve;

let fs = require("fs"); // only temporaly

module.exports = {
	settings: {

		paymentsConfigs: {
			paypal: {
				environment: (process.env.PAYPAL_ENV==="production" || process.env.PAYPAL_ENV==="live") ? "live" : "sandbox",
				merchantId: process.env.PAYPAL_CLIENT_ID,
				publicKey: null,
				privateKey: process.env.PAYPAL_SECRET,
				gateway: null
			}
		}

	},


	mixins: [
		HelpersMixin, 
		priceLevels
	],


	actions: {

		/**
		 * Send payment info to PayPal and get redirect url  or error message
		 *
		 * @actions
		 * 
     * @param {String} orderId - id of order to pay
     * @param {Object} data - data specific for payment
		 * 
		 * @returns {Object} Result from PayPal order checkout
		 */
		paypalOrderCheckout: {
			cache: false,
			auth: "required",
			params: {
				orderId: { type: "string", min: 3 },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				let result = { success: false, url: null, message: "error" };
				let self = this;

				// get order data
				return this.adapter.findById(ctx.params.orderId)
					.then(order => {
						if ( order ) {
							let paymentType = order.data.paymentData.codename.replace("online_paypal_","");

							let items = [];
							let priceTotalNoSubscriptions = 0;
							let priceSubscriptions = 0;
							for (let i=0; i<order.items.length; i++ ) {
								if (order.items[i].type && order.items[i].type=="subscription") {
									if (order.items[i].price && order.items[i].price>0) {
										priceSubscriptions += order.items[i].price;
									}
								} else {
									items.push({
										"name": order.items[i].name[order.lang.code],
										"sku": order.items[i].orderCode,
										"price": this.formatPrice(order.items[i].price),
										"currency": order.prices.currency.code,
										"quantity": order.items[i].amount
									});
								}
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


							let url = ctx.meta.siteSettings.url;
							if ( process.env.NODE_ENV=="development" ) {
								url = "http://localhost:3000";
							}

							priceTotalNoSubscriptions = order.prices.priceTotal - priceSubscriptions;

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
										"total": this.formatPrice(priceTotalNoSubscriptions)
									},
									// "note_to_payer": "Order ID "+order._id,
									"soft_descriptor": process.env.SITE_NAME.substr(0,22) // maximum length of accepted string
								}]
							};
							this.logger.info("payments.paypal1.mixin paypalOrderCheckout payment / items / amount:", payment, payment.transactions[0].item_list.items, payment.transactions[0].amount);

							this.paypalConfigure();

							return new Promise((resolve, reject) => {
								paypal.payment.create(payment, function(error, payment) {
									if (error) {
										self.logger.error("payments.paypal1.mixin paypalOrderCheckout error: ", error);
										reject(error);
									} else {
										self.logger.info("payments.paypal1.mixin paypalOrderCheckout result: ", payment);
										resolve(payment);
									}
								});
							})
								.then(response => {
									order.data.paymentData.paymentRequestId = response.id;
									return this.adapter.updateById(order._id, this.prepareForUpdate(order))
										.then(orderUpdated => {
											this.entityChanged("updated", orderUpdated, ctx);
											this.logger.info("orders.paypalOrderCheckout - orderUpdated after payment", orderUpdated);
											return { order: orderUpdated, payment: response };
										});
								})
								.then(responses => {
									this.logger.info("orders.paypalOrderCheckout - response.payment", responses.payment);

									if (responses.payment) {
										for (let i=0; i<responses.payment.links.length; i++) {
											if (responses.payment.links[i].rel=="approval_url") {
												result.url = responses.payment.links[i].href;
												break;
											}
										}
									}
									if ( result.url!=null && typeof result.url=="string" && result.url.trim()!="" ) {
										result.success = true;
									}
									return result;
								})
								.catch((error) => {
									this.logger.error("orders.paypalOrderCheckout - payment error: ", error);
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
			cache: false,
			auth: "required",
			params: {
				result: { type: "string", min: 3 },
				PayerID: { type: "string", optional: true },
				paymentId: { type: "string", optional: true }
			},
			handler(ctx) {
				let urlPathPrefix = "/";
				let self = this;
				if ( process.env.NODE_ENV=="development" ) {
					urlPathPrefix = "http://localhost:8080/";
				}
				/*
				subscription result:
				{ token: 'EC-0FK67327KB3942143', ba_token: 'BA-0RH05639H6174205F', result: 'return' }
				
				admin clicke subscription paid result:
				{ token: 'I-BWXCTWMVXFAU', ba_token: 'run_by_admin', result: 'adminsubscriptionpaid' }
				*/
				this.logger.info("orders.paypalResult - ctx.params:", ctx.params);
				if ( ctx.params.result == "return" ) {
					if ( ctx.params.token && ctx.params.ba_token ) { // subscription
						return self.paypalExecuteSubscription(ctx, urlPathPrefix);
					} else { // payment
						return self.paypalExecutePayment(ctx, urlPathPrefix);
					}
				} else if ( ctx.params.result == "adminsubscriptionpaid" ) {
					this.logger.info("orders.paypalResult - adminsubscriptionpaid", ctx.params.token , ctx.params.ba_token , ctx.params.ba_token=="run_by_admin" , ctx.meta.user.type=="admin");
					if ( ctx.params.paymentId && ctx.params.ba_token && 
					ctx.params.ba_token=="run_by_admin" && ctx.meta.user.type=="admin" ) { // subscription
						ctx.params["data"] = {
							type: "adminpaid",
							resource: {
								billing_agreement_id: ctx.params.paymentId
							}
						};
						// TODO - update to be more universal
						return self.paypalWebhookPaymentSaleCompleted(ctx)
							.then(result => {
								return { success: result.success, response: result.response, redirect: null };
							});
					}
				} else {
					// payment not finished -- TODO - cancel result does not get correct language
					this.logger.error("orders.paypalResult - payment canceled");
					return { success: false, response: null, redirect: urlPathPrefix + "en/user/orders/" };
				}
			}
		},



		/**
		 * Decision making action that runs action depending on order content:
		 *  1. if order contains any product, pay product first.
		 *  2. if order contains only subscriptions, confirm subscription.
		 *  3. order has no product or subscriptions, return error.
		 * 
		 * @actions
		 * 
     * @param {String} orderId - id of order to pay
     * @param {Object} data - data specific for payment
		 * 
		 * @returns {Object} Unified result from related paypal action
		 */
		paypalOrderGeturl: {
			auth: "required",
			params: {
				orderId: { type: "string", min: 3 },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				// get order data
				return this.adapter.findById(ctx.params.orderId)
					.then(order => {
						if ( order ) {
							this.logger.error("payments.paypal1.paypalOrderGeturl - having order");
							// check if order has any product
							const itemsCount = this.countOrderItemTypes(order);
							if ( itemsCount ) {
								this.logger.error("payments.paypal1.paypalOrderGeturl - itemsCount:", itemsCount);
								if ( typeof ctx.params.data == "undefined" ) {
									ctx.params["data"] = {};
								}
								if ( itemsCount.product && itemsCount.product>0 ) {
									this.logger.info("payments.paypal1.paypalOrderGeturl - orders.paypalOrderCheckout");
									// order has product, get url for paying the product
									ctx.params.data["order"] = order;
									return ctx.call("orders.paypalOrderCheckout", {
										orderId: ctx.params.orderId,
										data: ctx.params.data
									})
										.catch(error => {
											this.logger.error("payments.paypal1.paypalOrderGeturl - orders.paypalOrderCheckout error: ", error);
											return null;
										});
								} else if ( itemsCount.subscription && itemsCount.subscription>0 ) {
									this.logger.info("payments.paypal1.paypalOrderGeturl - orders.paypalOrderSubscription");
									// order has subscription, get url for confirming the subscription
									ctx.params.data["order"] = order;
									return ctx.call("orders.paypalOrderSubscription", {
										orderId: ctx.params.orderId,
										data: ctx.params.data
									})
										.catch(error => {
											this.logger.error("payments.paypal1.paypalOrderGeturl - orders.paypalOrderSubscription error: ", error);
											return null;
										});
								}
							}
						}
						// no valid items found in order, return empty
						return  { success: false, url: null, message: "error - no valid items" };
					});
			}
		},


		/**
		 * @actions
		 * 
     * @param {String} orderId - id of order to pay
     * @param {Object} data - data specific for payment
		 * 
		 * @returns {Object} Unified result from related action
		 */
		paypalOrderSubscription: {
			auth: "required",
			params: {
				orderId: { type: "string", min: 3 },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				let result = { success: false, url: null, message: "error" };
				let self = this;

				// get order subscription to process
				return this.getOrderSubscriptionsToProcess(ctx, ctx.params.data.order)
					.then(subscriptions => {
						// get first subscription if possible
						this.logger.info("payments.paypal1.paypalOrderSubscription - subscription", subscriptions.length);

						if (subscriptions && subscriptions!=null && subscriptions[0] && 
						subscriptions[0].data.product && subscriptions[0].data.product._id){
							this.logger.info("payments.paypal1.paypalOrderSubscription - product._id", subscriptions[0].data.product._id);
							// check if billing plan exists, if not, create it
							// return billing plan
							return this.paypalGetBillingPlan(ctx, subscriptions[0])
								.then(billingPlan => {
									this.logger.info("paypalOrderSubscription billingPlan: ", billingPlan);
									// 1. create billing agreement based on billing plan
									return this.paypalCreateBillingAgreement(
										ctx, billingPlan, subscriptions[0]
									)
										.then(billingAgreementUrl => {
											let parsedUrl = new URL(billingAgreementUrl.href);
											this.logger.info("paypalOrderSubscription billingAgreement billingAgreementUrl: ", billingAgreementUrl, parsedUrl);
											// get & save token from url to subscription
											let token = null;
											if (parsedUrl && parsedUrl.searchParams.has("token")) {
												token = parsedUrl.searchParams.get("token");
												if (token) {
													this.logger.info("paypalOrderSubscription billingAgreement token: ", token);
													// update subscription with token
													return ctx.call("subscriptions.update", {
														updateObject: {
															id: subscriptions[0]._id.toString(),
															data: {
																token: token,
																agreementId: ""
															}
														}
													})
														.then(updated => {
															this.logger.info("payments.paypal1.mixin - saveTokenToSubscription updated:", updated);
															return { success: true, url: billingAgreementUrl.href, message: "redirect to billing agreement confirmation" };
														})
														.catch(error => {
															this.logger.error("payments.paypal1.mixin - saveTokenToSubscription update error: ", error);
															return null;
														});
												} else { // no token
													this.logger.error("paypalOrderSubscription billingAgreement NO TOKEN FOUND: ", parsedUrl.searchParams);
												}
												return { success: false, url: null, message: "error - missing token in url 2" };
											}
											return { success: false, url: null, message: "error - missing token in url" };
										})
										.catch(error => {
											this.logger.error("paypalOrderSubscription billingAgreement error: ", error);
											return { success: false, url: null, message: "error - billing agreement problem" };
										});
								})
								.catch(error => {
									this.logger.error("paypalOrderSubscription billingPlan error: ", error);
									return { success: false, url: null, message: "error - billing plan problem" };
								});
							// 2. redirect user
							// 3. in other action - execute the billing agreement using returned token
						} else {
							this.logger.error("paypalOrderSubscription error - no valid subscription: ", subscriptions);
							return { success: false, url: null, message: "error - no valid subscription" };
						}
					});
			}
		},


		/**
		 * Suspend Billing Agreement
		 * 
		 * @actions
		 * 
		 * @param {String} billingAgreementId - id of agreement
		 *
		 * @returns {Object} response from service
		 */
		paypalSuspendBillingAgreement: {
			cache: false,
			params: {
				billingAgreementId: { type: "string" }
			},
			handler(ctx) {
				let self = this;
				let suspendNote = { note: "User canceled from StretchShop" };

				this.paypalConfigure();
				self.logger.info("payments.paypal1.mixin paypalSuspendBillingAgreement ctx.params.billingAgreementId: ", ctx.params.billingAgreementId);


				return new Promise((resolve, reject) => {
					paypal.billingAgreement.suspend(
						ctx.params.billingAgreementId, 
						suspendNote, 
						function(error, payment) {
							if (error) {
								self.logger.error("payments.paypal1.mixin paypalSuspendBillingAgreement error: ", error);
								reject(error);
							} else {
								self.logger.info("payments.paypal1.mixin paypalSuspendBillingAgreement result: ", payment);
								resolve(payment);
							}
						});
				})
					.then(response => {
						return response;
					})
					.catch(error => {
						this.logger.error("payments.paypal1.mixin - paypalSuspendBillingAgreement error: ", JSON.stringify(error));
						return null;
					});
			}
		},


		/**
		 * Reactivate Billing Agreement
		 * 
		 * @actions
		 * 
		 * @param {String} billingAgreementId - id of agreement
		 *
		 * @returns {Object} response from service
		 */
		paypalReactivateBillingAgreement: {
			cache: false,
			params: {
				billingAgreementId: { type: "string" }
			},
			handler(ctx) {
				let self = this;
				let reactivateNote = { note: "User reactivated from StretchShop" };

				this.paypalConfigure();

				return new Promise((resolve, reject) => {
					paypal.billingAgreement.reactivate(
						ctx.params.billingAgreementId, 
						reactivateNote, 
						function(error, payment) {
							if (error) {
								self.logger.error("payments.paypal1.mixin paypalReactivateBillingAgreement error: ", error);
								reject(error);
							} else {
								self.logger.info("payments.paypal1.mixin paypalReactivateBillingAgreement result: ", payment);
								resolve(payment);
							}
						});
				})
					.then(response => {
						return response;
					})
					.catch(error => {
						this.logger.error("payments.paypal1.mixin - paypalReactivateBillingAgreement error: ", JSON.stringify(error));
						return null;
					});
			}
		},

		
		/**
		 * Reactivate Billing Agreement
		 * 
		 * @actions
		 * 
		 */
		paypalWebhook: {
			cache: false,
			handler(ctx) {
				let self = this;
				let data = Object.assign({}, ctx.params.data);
				if ( data.supplier ) { delete data.supplier; }
				this.logger.info("paypalWebhook #1:", JSON.stringify(data));
				this.logger.info("path resolve:", pathResolve("./.temp/ipnlog.log"));
				let log_file = fs.createWriteStream("./.temp/ipnlog.log", {flags : "a"});
				let date = new Date();
				log_file.write( "\n\n" + date.toISOString() + " #1:\n"+ JSON.stringify(ctx.params)+"\n");

				setTimeout(() => {
					this.paypalConfigure();

					return new Promise((resolve, reject) => {
						paypal.notification.webhookEvent.getAndVerify(JSON.stringify(data), function (error, response) {
							if (error) {
								self.logger.error("payments.paypal1.mixin paypalWebhook error: ", error);
								reject(error);
							} else {
								self.logger.info("payments.paypal1.mixin paypalWebhook result: ", response);
								resolve(response);
							}
						});
					})
						.then(response => {
							self.logger.info("payments.paypal1.mixin paypalWebhook response: ", JSON.stringify(response));
							// cancel subscription in DB
							if (response && response==true && ctx.params.data && 
							ctx.params.data.event_type) {
								switch (ctx.params.data.event_type) {
								case "BILLING.PLAN.CREATED":
									self.logger.info("payments.paypal1.mixin paypalWebhook - BILLING.PLAN.CREATED notification received");
									break;
								case "BILLING.PLAN.UPDATED":
									self.logger.info("payments.paypal1.mixin paypalWebhook - BILLING.PLAN.UPDATED notification received");
									break;
								case "BILLING.SUBSCRIPTION.CANCELLED":
									self.paypalWebhookBillingSubscriptionCancelled(ctx);
									break;
								case "PAYMENT.SALE.COMPLETED":
									self.paypalWebhookPaymentSaleCompleted(ctx);
									break;
								default:
									self.logger.info("payments.paypal1.mixin paypalWebhook - notification received:", JSON.stringify(data));
								}
							}
						})
						.catch(error => {
							this.logger.error("payments.paypal1.mixin - paypalWebhook error2: ", JSON.stringify(error));
							let log_file = fs.createWriteStream("./.temp/ipnlog.log", {flags : "a"});
							let date = new Date();
							log_file.write( "\n\n" + date.toISOString() + " #1:\n"+ JSON.stringify(ctx.params)+"\n");
							return null;
						});
				}, 10000); // timeout end
			}
		},

		
		// old paypal notification system
		// TODO - always returns INVALID, need to fix
		paypalIpn: {
			cache: false,
			handler(ctx) {
				// let self = this;
				// TEMP - temporaly IPN debug
				let log_file = fs.createWriteStream("../.temp/ipnlog.log", {flags : "a"});
				let date = new Date();
				this.logger.info("paypalIpn #1:", ctx.params);
				log_file.write( "\n\n" + date.toISOString() + " #1:\n"+ JSON.stringify(ctx.params)+"\n");

				let url = "https://ipnpb.paypal.com/cgi-bin/webscr";
				if ( process.env.NODE_ENV=="development" ) {
					url = "https://ipnpb.sandbox.paypal.com/cgi-bin/webscr";
				}
				this.logger.info("paypalIpn #0:", url);


				// sending empty POST
				fetch(url, {
					method: "post",
					headers: { "User-Agent": "NODE-IPN-VerificationScript" },
				})
					.then(res => {
						this.logger.info("paypalIpn #2:", res.body);
						return res;
					}) // expecting a json response, checking it
					.then(response => {
						this.logger.info("paypalIpn #3:", response);
						log_file.write( "\n" + date.toISOString() + " #3:\n"+ response + "\n");
						let requestString = "cmd=_notify-validate";
						// Iterate the original request payload object
						// and prepend its keys and values to the post string
						Object.keys(ctx.params).map((key) => {
							requestString = requestString +"&"+ key +"="+ encodeURIComponent(ctx.params[key]).replace(/%20/g,"+");
							return key;
						});

						this.logger.info("paypalIpn #4.0:", requestString);
						return fetch(url, {
							method: "post",
							body: requestString,
							headers: { 
								"User-Agent": "NODE-IPN-VerificationScript", 
								"Content-Length": requestString.length 
							},
						})
							.then(res2 => {
								this.logger.info("paypalIpn #4:", res2);
								// log_file.write( "\n" + date.toISOString() + " #4:\n"+ res2 + "\n");
								return res2.text();
							})
							.then(result => {
								this.logger.info("paypalIpn #5:", result);//, JSON.stringify(result));
								return result;
							});
					});
			}
		},


	},


	methods: {

		paypalConfigure(){
			paypal.configure({
				"mode": this.settings.paymentsConfigs.paypal.environment, //sandbox or live
				"client_id": this.settings.paymentsConfigs.paypal.merchantId,
				"client_secret": this.settings.paymentsConfigs.paypal.privateKey,
			});
		},


		/**
		 * Finish the payment after confirmed by customer
		 * 
		 * @param {Object} ctx 
		 * 
		 * @returns {Object|null}
		 */
		paypalExecutePayment(ctx, urlPathPrefix) {
			let self = this;
			// get order data
			return ctx.call("orders.find", {
				"query": {
					"data.paymentData.paymentRequestId": ctx.params.paymentId
				}
			})
				.then(orders => {
					if ( orders && orders.length>0 && orders[0] ) {
						let order = orders[0];

						// remove amount of subscriptions, as they will be paid separately
						// after user agrees with their automated payments
						let priceTotalNoSubscriptions = 0;

						if (order.items && order.items.length>0) {
							let priceSubscriptions = 0;
							order.items.forEach(item => {
								// get the right price to remove
								self.logger.info("payments.paypal1 paypalExecutePayment() item.price:", item.price);
								if (item && item.type && item.type=="subscription") {
									let tempProduct = self.priceByUser(item, ctx.meta.user);
									if (tempProduct.price && tempProduct.price>0) {
										priceSubscriptions += tempProduct.price;
									}
								}
							});
							priceTotalNoSubscriptions = order.prices.priceTotal - priceSubscriptions;
							self.logger.info("payments.paypal1 paypalExecutePayment() priceTotalNoSubscriptions:", priceTotalNoSubscriptions, order.prices.priceTotal, priceSubscriptions);
						}

						const execute_payment_json = {
							"payer_id": ctx.params.PayerID,
							"transactions": [{
								"amount": {
									"currency": order.prices.currency.code,
									"total": self.formatPrice(priceTotalNoSubscriptions)
								}
							}]
						};

						self.paypalConfigure();

						return new Promise((resolve, reject) => {
							paypal.payment.execute(ctx.params.paymentId, execute_payment_json, function(error, payment) {
								if (error) {
									self.logger.error("payments.paypal.mixin paypalExecutePayment error: ", error);
									reject(error);
								} else {
									self.logger.info("payments.paypal.mixin paypalExecutePayment result: ", payment);
									resolve(payment);
								}
							});
						})
							.then((response) => {
								self.logger.info("payments.paypal1.mixin - paypalExecutePayment response:", response);

								order = self.paypalUpdatePaidOrderData(order, response); // find it in orders.service
								
								return self.generateInvoice(order, ctx)
									.then(invoice => {
										order.invoice["html"] = invoice.html;
										order.invoice["path"] = invoice.path;
										return self.adapter.updateById(order._id, self.prepareForUpdate(order))
											.then(orderUpdated => {
												self.entityChanged("updated", orderUpdated, ctx);
												self.logger.info("payments.paypal1.mixin - paypalExecutePayment - invoice generated", { success: true, response: response, redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id } );
												if ( order.prices.priceTotalToPay==0 && typeof self.afterPaidActions !== "undefined" ) {
													self.afterPaidActions(order, ctx); // find it in orders.service
												}
												return { success: true, response: response, redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id };
											});
									});
							})
							.catch((error) => {
								self.logger.error("payments.paypal1.mixin - paypalExecutePayment - paypal execute error: ", JSON.stringify(error));
								return { success: false, response: "payments.paypal1.mixin - paypalExecutePayment - execute error", redirect: urlPathPrefix };
							});
					}
				})
				.catch((error) => {
					self.logger.error("payments.paypal1.mixin - paypalExecutePayment - find order error: ", error);
					return { success: false, response: "payments.paypal1.mixin - paypalExecutePayment - find order error error", redirect: urlPathPrefix };
				});
		},


		/**
		 * 
		 * @param {Object} ctx 
		 * @param {Object} subscription 
		 * 
		 * @returns {Object|null}
		 */
		paypalGetBillingPlan(ctx, subscription) {
			return this.paypalCheckIfBillingPlanExists(ctx, subscription.data.product._id)
				.then(billingPlanFound => {
					if (billingPlanFound && billingPlanFound!=null) {
						return billingPlanFound;
					}
					// billing plan not found, create It
					return this.paypalCreateBillingPlan(ctx, subscription)
						.then(cratedBillingPlan => {
							return cratedBillingPlan;
						})
						.catch(error => {
							this.logger.error("payments.paypal1.paypalGetBillingPlan paypalCreateBillingPlan - error:", error, JSON.stringify(error));
						});
				})
				.catch(error => {
					this.logger.error("payments.paypal1.paypalGetBillingPlan paypalCheckIfBillingPlanExists - error:", error, JSON.stringify(error));
				});
		},


		/**
		 * Search all subscriptions if any of them contains 
		 * remote data for this product.
		 * - If they DO NOT contain Billing plan in remote data, that means this PayPal 
		 *   Billing plan is NOT created, so create it.
		 * - If they DO contain Billing plan in remote data, that means this PayPal Billing 
		 *   plan IS already created - return .
		 * 
		 * @param {*} ctx 
		 * @param {*} productId 
		 * 
		 * @returns {Object|null}
		 */
		paypalCheckIfBillingPlanExists(ctx, productId) {
			return ctx.call("subscriptions.find", {
				query: {
					"data.product._id": productId,
					"data.remoteData.billingPlan.id": {"$exists": true}
				},
				limit: 1
			})
				.then(found => {
					if (found && found.length>0 && found[0].data.remoteData.billingPlan) {
						return found[0].data.remoteData.billingPlan;
					}
					return null;
				})
				.catch(error => {
					this.logger.error("payments.paypal1.mixin error", error);
					return null;
				});
		},


		/**
		 * 
		 * @param {*} ctx 
		 * @param {*} subscription 
		 */
		paypalCreateBillingPlan(ctx, subscription) {
			let self = this;
			let siteUrl = ctx.meta.siteSettings.url;
			if ( process.env.NODE_ENV=="development" ) {
				siteUrl = "http://localhost:3000";
			}
			// const lang = subscription.data.order.lang.code;
			let url = ctx.meta.siteSettings.url;
			if ( process.env.NODE_ENV=="development" ) {
				url = "http://localhost:3000";
			}
			let billingPlanAttributes = {
				"name": subscription.orderItemName,
				"description": subscription.orderItemName + " - " + subscription.period + " - " + subscription.duration,
				"merchant_preferences": {
					"auto_bill_amount": "yes",
					"cancel_url": url +"/backdirect/order/paypal/cancel",
					"return_url": url +"/backdirect/order/paypal/return",
					"initial_fail_amount_action": "continue",
					"max_fail_attempts": "0",
					"setup_fee": {
						"currency": "EUR",
						"value": "0"
					}
				},
				"payment_definitions": [
					{
						"amount": {
							"currency": subscription.data.order.prices.currency.code,
							"value": subscription.data.product.price
						},
						"charge_models": [
							{
								"amount": {
									"currency": subscription.data.order.prices.currency.code,
									"value": subscription.data.product.tax
								},
								"type": "TAX"
							}
						],
						"cycles": subscription.cycles.toString(),
						"frequency": subscription.period.toString().toUpperCase(),
						"frequency_interval": subscription.duration.toString(),
						"name": "Regular 1",
						"type": "REGULAR" // ok
					}
				],
				"type": (subscription.cycles>0) ? "FIXED" : "INFINITE"
			};
			self.logger.error("payments.paypal1.mixin billingPlanAttributes: ", JSON.stringify(billingPlanAttributes) );

			this.paypalConfigure();

			const createdBillingPlan = new Promise((resolve, reject) => {
				paypal.billingPlan.create(billingPlanAttributes, function (error, billingPlan) {
					if (error) {
						self.logger.error("payments.paypal1.mixin paypalCreateBillingPlan error: ", error, JSON.stringify(error));
						reject(error);
					} else {
						self.logger.info("payments.paypal1.mixin paypalCreateBillingPlan result: ", billingPlan);
						resolve(billingPlan);
					}
				});
			}); // promise

			let billingPlanUpdateAttributes = [{ 
				"op": "replace",
				"path": "/",
				"value": {
					"state": "ACTIVE"
				}
			}];

			// activate billing plan
			return createdBillingPlan.then(billingPlan => {
				if (billingPlan && billingPlan.id) {
					return new Promise((resolve, reject) => {
						paypal.billingPlan.update(billingPlan.id, billingPlanUpdateAttributes, function (error, billingPlan) {
							if (error) {
								self.logger.error("payments.paypal1.mixin activate BillingPlan error: ", error);
								reject(error);
							} else {
								self.logger.info("payments.paypal1.mixin activate BillingPlan result: ", billingPlan);
								resolve(createdBillingPlan);
							}
						});
					}); // promise
				}
				return null;
			})
				.catch(error => {
					this.logger.error("payments.paypal1.mixin activate BillingPlan promise error: ", error, JSON.stringify(error));
				});
		},


		/**
		 * 
		 * @param {*} ctx 
		 * @param {*} billingPlan 
		 * @param {*} subscription 
		 */
		paypalCreateBillingAgreement(ctx, billingPlan, subscription) {
			let isoDate = new Date();
			let self = this;
			isoDate.setSeconds(isoDate.getSeconds() + 4);
			isoDate.toISOString().slice(0, 19) + "Z";

			let billingAgreementAttributes = {
				"name": subscription.orderItemName,
				"description": subscription.orderItemName + " - " + subscription.price +"/"+ subscription.period, //subscription.data.product._id,
				"start_date": isoDate,
				"plan": {
					"id": billingPlan.id
				},
				"payer": {
					"payment_method": "paypal"
				},
				"shipping_address": {
					"line1": self.removeDiacritics(subscription.data.order.addresses.invoiceAddress.street),
					"city": self.removeDiacritics(subscription.data.order.addresses.invoiceAddress.city),
					"state": "",
					"postal_code": subscription.data.order.addresses.invoiceAddress.zip,
					"country_code": subscription.data.order.addresses.invoiceAddress.country.toUpperCase()
				}
			};

			this.logger.info("payments.paypal1.mixin paypalCreateBillingAgreement billingAgreementAttributes:", billingAgreementAttributes, billingPlan);

			this.paypalConfigure();
			// Use activated billing plan to create agreement
			return new Promise((resolve, reject) => {
				paypal.billingAgreement.create(billingAgreementAttributes, function (error, billingAgreement){
					if (error) {
						self.logger.error("payments.paypal1.mixin paypalCreateBillingAgreement error: ", error);
						reject(error);
					} else {
						self.logger.info("payments.paypal1.mixin paypalCreateBillingAgreement result: ", billingAgreement);
						resolve(billingAgreement);
					}
				});
			})
				.then(billingAgreement => {
					//capture HATEOAS links
					let links = {};
					billingAgreement.links.forEach(function(linkObj){
						links[linkObj.rel] = {
							"href": linkObj.href,
							"method": linkObj.method
						};
					});
					//if redirect url present, redirect user
					if ( Object.prototype.hasOwnProperty.call(links,"approval_url") ){
						return links["approval_url"];
					} else {
						this.logger.error("payments.paypal1.mixin - paypalCreateBillingAgreement approval_url error", links);
						return null;
					}
				})
				.catch(error => {
					this.logger.error("payments.paypal1.mixin - paypalCreateBillingAgreement error: ", error);
					this.logger.error("payments.paypal1.mixin - paypalCreateBillingAgreement error.details: ", JSON.stringify(error));
					return null;
				});
		}, 


		/**
		 * Sending request to execute Billing Agreement
		 * 
		 * @param {Object} ctx 
		 * 
		 * @returns {Promise} response after executing Billing Agreement
		 */
		paypalProcessAgreement(ctx) {
			let self = this;

			this.paypalConfigure();
			
			return new Promise((resolve, reject) => {
				paypal.billingAgreement.execute(
					ctx.params.token, 
					{}, 
					function (error, billingAgreement) {
						if (error) {
							self.logger.error("payments.paypal1.mixin paypalProcessAgreement error: ", JSON.stringify(error));
							reject(error);
						} else {
							self.logger.info("payments.paypal1.mixin paypalProcessAgreement response: ", JSON.stringify(billingAgreement));
							resolve(billingAgreement);
						}
					}
				);
			});
		},


		/**
		 * Execute subscription means:
		 * 1. get related agreement of subscription confirmed by customer
		 * 
		 * @param {Object} ctx 
		 * 
		 * @returns {Object|null}
		 */
		paypalExecuteSubscription(ctx, urlPathPrefix) {
			let self = this;

			let querySubscriptions = {
				"query": {
					"data.token": ctx.params.token
				}
			};
			// only administrator can edit subscription of any other user
			if (ctx.meta && ctx.meta.user && ctx.meta.user.type && ctx.meta.user.type!="admin") {
				querySubscriptions.query["userId"] = ctx.meta.user._id.toString();
			}

			// find and update subscription and order
			return ctx.call("subscriptions.find", querySubscriptions)
				.then(subscriptions => {
					if (subscriptions && subscriptions[0]) {
						self.logger.info("payments.paypal1.mixin - paypalExecuteSubscription subscriptions (token):", ctx.params.token, subscriptions[0].orderOriginId);
						let subscription = subscriptions[0];
						// get order by data.order._id saved in subscription
						let queryOrders = {
							"query": {
								"_id": self.fixStringToId(subscription.orderOriginId),
							}
						};
						// only administrator can edit subscription of any other user
						if (ctx.meta && ctx.meta.user && ctx.meta.user.type && ctx.meta.user.type!="admin") {
							queryOrders.query["user.id"] = ctx.meta.user._id.toString();
						}
						return ctx.call("orders.find", queryOrders)
							.then(orders => {
								if ( orders && orders.length>0 && orders[0] ) {
									let order = orders[0];

									return this.paypalProcessAgreement(ctx)
										.then((agreement) => {
											// agreement is processed, webhook will get payment confirmation
											self.logger.info("payments.paypal1.mixin - paypalExecuteSubscription paypalProcessAgreement agreement:", JSON.stringify(agreement) );
											
											// save history and agreement into subscription
											let historyRecord = {
												action: "agreed",
												type: "user",
												date: new Date(),
												data: {
													relatedOrder: order._id,
													agreement: agreement
												}
											};
											subscription.status = "agreed";
											subscription.history.push(historyRecord);
											subscription.data.agreementId = agreement.id.toString();
											subscription.data.agreement = JSON.parse(JSON.stringify(agreement));
											subscription.id = subscription._id.toString();
											delete subscription._id;
											self.logger.info("payments.paypal1.mixin - paypalExecuteSubscription paypalProcessAgreement subscription:", JSON.stringify(subscription) );
											
											// save subscription
											// - it's active and waiting for payment
											return ctx.call("subscriptions.save", {
												entity: subscription
											})
												.then(updatedSubscription => {
													this.logger.info("payments.paypal1.mixin - updateSubscriptionAfterPaid updated:", updatedSubscription);

													// set related subscription product and data as agreed
													if (order.data && order.data.subscription && 
													order.data.subscription.ids && 
													order.data.subscription.ids.length>0) {
														for (let i=0; i<order.data.subscription.ids.length; i++) {
															if (order.data.subscription.ids[i].subscription==updatedSubscription._id.toString()) {
																order.data.subscription.ids[i]["agreed"] = new Date();
															}
														}
													}

													// update order
													return this.adapter.updateById(order._id, this.prepareForUpdate(order))
														.then(orderUpdated => {
															this.entityChanged("updated", orderUpdated, ctx);
															// redirect to order to finish required
															return { success: true, response: agreement, redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id.toString() };
														});
												})
												.catch(error => {
													this.logger.error("payments.paypal1.mixin - updateSubscriptionAfterPaid update error: ", error);
													return null;
												});

										}).catch((error) => {
											this.logger.error("payments.paypal1.mixin - paypalExecuteSubscription - paypal execute error: ", error, error.details);
											return { success: false, response: "payments.paypal1.mixin - paypalExecuteSubscription - execute error", redirect: urlPathPrefix };
										});
								}
							})
							.catch((error) => {
								this.logger.error("payments.paypal1.mixin - paypalExecuteSubscription - find order error: ", error);
								return { success: false, response: "payments.paypal1.mixin - paypalExecuteSubscription - find order error error", redirect: urlPathPrefix };
							});
					} else {
						this.logger.error("payments.paypal1.mixin - paypalExecuteSubscription - no subscription found");
						return { success: false, response: "payments.paypal1.mixin - paypalExecuteSubscription - no subscription found", redirect: urlPathPrefix };
					}
				});

		},




		/**
		 * 
		 * @param {Object} order 
		 * @param {Object} response 
		 * 
		 * @returns {Object} order updated
		 */
		paypalUpdatePaidOrderData(order, response) {
			order.dates.datePaid = new Date();
			order.status = "paid";
			order.data.paymentData.lastStatus = (response && response.state) ? response.state : "---";
			order.data.paymentData.lastDate = new Date();
			order.data.paymentData.paidAmountTotal = 0;
			if ( !order.data.paymentData.lastResponseResult ) {
				order.data.paymentData.lastResponseResult = [];
			}
			order.data.paymentData.lastResponseResult.push(response);
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

			return order;
		},


		paypalWebhookBillingSubscriptionCancelled(ctx) {
			if (ctx.params.data && 
			ctx.params.data.resource && ctx.params.data.resource.id) {
				let filter = { 
					query: { 
						"data.agreementId": ctx.params.data.resource.id 
					}, 
					limit: 1
				};
				return ctx.call("subscriptions.find", filter)
					.then(found => {
						this.logger.info("subscriptions to webhook cancel found:", filter, found);
						if (found && found[0]) {
							found = found[0];
							found.status = "canceled";
							found.dates["dateStopped"] = new Date();
							found.history.push(
								{
									action: "canceled",
									type: "user",
									date: new Date(),
									data: {
										webhookResponse: JSON.stringify(ctx.params.data),
										relatedOrder: null
									}
								}
							);

							found.id = found._id.toString();
							delete found._id;

							return ctx.call("subscriptions.save", {
								entity: found
							})
								.then(updated => {
									this.logger.info("subscriptions to webhook cancel - subscriptions.save:", updated);
									result.data.subscription = updated;
									delete result.data.subscription.history;
									return result;
								})
								.catch(error => {
									this.logger.error("subscriptions to webhook cancel - subscriptions.save error: ", error);
									return null;
								});
						}
					});
			} // response & .resource.is END if
		}, 



		/**
		 * Webhook logic - step #2.1
		 * Try to pair with action - if product payment or subscription
		 * 
		 * @param {Object} ctx 
		 */
		paypalWebhookPaymentSaleCompleted(ctx) {
			// if subscription (paired by agreement ID)
			if (ctx.params.data && ctx.params.data.resource && 
			ctx.params.data.resource.billing_agreement_id) {
				let filter = { 
					query: { 
						"data.agreementId": ctx.params.data.resource.billing_agreement_id 
					}, 
					limit: 1
				};
				return ctx.call("subscriptions.find", filter)
					.then(subscriptions => {
						this.logger.info("orders payments.paypal1.mixin paypalWebhookPaymentSaleCompleted subscriptions found:", filter, subscriptions);
						if (subscriptions && subscriptions[0]) {
							let subscription = subscriptions[0];
							// found, call subscription paid actions
							return this.subscriptionPaymentReceived(ctx, subscription); // in orders.service
						}
					});
			}

		}

		
	}
};
