"use strict";

const { result } = require("lodash");
const url = require("url");
const paypal = require("paypal-rest-sdk");
const HelpersMixin = require("../mixins/helpers.mixin");

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
		HelpersMixin
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
				*/
				this.logger.info("orders.paypalResult - ctx.params:", ctx.params);
				if ( ctx.params.result == "return" ) {
					if ( ctx.params.token && ctx.params.ba_token ) { // subscription
						return self.paypalExecuteSubscription(ctx, urlPathPrefix);
					} else { // payment
						return self.paypalExecutePayment(ctx, urlPathPrefix);
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
						this.logger.info("payments.paypal1.paypalOrderSubscription - subscription", subscriptions, ctx.params.data);

						if (subscriptions && subscriptions!=null && subscriptions[0] && 
						subscriptions[0].data.product && subscriptions[0].data.product._id){
							this.logger.info("payments.paypal1.paypalOrderSubscription - product._id", subscriptions[0].data.product._id);
							// check if billing plan exists, if not, create it
							// return billing plan
							return this.getBillingPlan(ctx, subscriptions[0])
								.then(billingPlan => {
									this.logger.info("paypalOrderSubscription billingPlan: ", billingPlan);
									// 1. create billing agreement based on billing plan
									return this.createBillingAgreement(
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
													// update subscription with token
													return ctx.call("subscriptions.update", {
														updateObject: {
															id: subscriptions[0]._id.toString(),
															data: {
																token: token
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

		
		paypalIpn: {
			cache: false,
			handler(ctx) {
				// let self = this;
				this.logger.info("paypalIpn response:", ctx.params);
				// TEMP - temporaly IPN debug
				let log_file = fs.createWriteStream(__dirname + "/../.temp/ipnlog.log", {flags : "a"});
				let date = new Date();
				log_file.write( date.toISOString() + ":\n"+ JSON.stringify(ctx.params) + "\n\n");
				return ctx.params;
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

						const execute_payment_json = {
							"payer_id": ctx.params.PayerID,
							"transactions": [{
								"amount": {
									"currency": order.prices.currency.code,
									"total": self.formatPrice(order.prices.priceTotal)
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

								order = self.updatePaidOrderData(order, response); // find it in orders.service
								
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
							}).catch((error) => {
								self.logger.error("payments.paypal1.mixin - paypalExecutePayment - paypal execute error: ", error);
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
		getBillingPlan(ctx, subscription) {
			return this.checkIfBillingPlanExists(ctx, subscription.data.product._id)
				.then(billingPlanFound => {
					if (billingPlanFound && billingPlanFound!=null) {
						return billingPlanFound;
					}
					// billing plan not found, create It
					return this.createBillingPlan(ctx, subscription)
						.then(cratedBillingPlan => {
							return cratedBillingPlan;
						})
						.catch(error => {
							this.logger.error("payments.paypal1.getBillingPlan createBillingPlan - error:", error, JSON.stringify(error));
						});
				})
				.catch(error => {
					this.logger.error("payments.paypal1.getBillingPlan checkIfBillingPlanExists - error:", error, JSON.stringify(error));
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
		checkIfBillingPlanExists(ctx, productId) {
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
		createBillingPlan(ctx, subscription) {
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
			self.logger.error("payments.paypal1.mixin billingPlanAttributes: ", billingPlanAttributes);

			this.paypalConfigure();

			const createdBillingPlan = new Promise((resolve, reject) => {
				paypal.billingPlan.create(billingPlanAttributes, function (error, billingPlan) {
					if (error) {
						self.logger.error("payments.paypal1.mixin createBillingPlan error: ", error, JSON.stringify(error));
						reject(error);
					} else {
						self.logger.info("payments.paypal1.mixin createBillingPlan result: ", billingPlan);
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
		createBillingAgreement(ctx, billingPlan, subscription) {
			let isoDate = new Date();
			let self = this;
			isoDate.setSeconds(isoDate.getSeconds() + 4);
			isoDate.toISOString().slice(0, 19) + "Z";

			let billingAgreementAttributes = {
				"name": subscription.orderItemName,
				"description": subscription.orderItemName + " - " + subscription.data.product._id,
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

			this.logger.info("payments.paypal1.mixin createBillingAgreement billingAgreementAttributes:", billingAgreementAttributes, billingPlan);

			this.paypalConfigure();
			// Use activated billing plan to create agreement
			return new Promise((resolve, reject) => {
				paypal.billingAgreement.create(billingAgreementAttributes, function (error, billingAgreement){
					if (error) {
						self.logger.error("payments.paypal1.mixin createBillingAgreement error: ", error);
						reject(error);
					} else {
						self.logger.info("payments.paypal1.mixin createBillingAgreement result: ", billingAgreement);
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
						this.logger.error("payments.paypal1.mixin - createBillingAgreement approval_url error", links);
						return null;
					}
				})
				.catch(error => {
					this.logger.error("payments.paypal1.mixin - createBillingAgreement error: ", error);
					this.logger.error("payments.paypal1.mixin - createBillingAgreement error.details: ", JSON.stringify(error));
					return null;
				});
		}, 


		/**
		 * Adds token to related subscription and saves it
		 * 
		 * @param {*} ctx 
		 * @param {*} subscription 
		 * @param {*} token 
		 * 
		 * @returns {Object|null} updated subscription
		 */
		saveTokenToSubscription(ctx, subscription, token) {
			return ctx.call("subscriptions.find", {
				"query": {
					"_id": this.fixStringToId(subscription._id.toString())
				}
			})
				.then(subscriptions => {
					this.logger.info("payments.paypal1.mixin - saveTokenToSubscription subscriptions (token):", token);
					if (subscriptions && subscriptions[0]) {
						let withToken = Object.assign({}, subscriptions[0]);
						withToken.data["token"] = token;
						withToken.id = withToken._id;
						delete withToken._id;
						return ctx.call("subscriptions.save", {
							entity: withToken
						})
							.then(updated => {
								this.logger.info("payments.paypal1.mixin - saveTokenToSubscription updated:", updated);
								return updated;
							})
							.catch(error => {
								this.logger.error("payments.paypal1.mixin - saveTokenToSubscription update error: ", error);
								return null;
							});
					}
				})
				.catch(error => {
					this.logger.error("payments.paypal1.mixin - saveTokenToSubscription find error: ", error);
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
		processAgreement(ctx) {
			let self = this;

			this.paypalConfigure();
			
			return new Promise((resolve, reject) => {
				paypal.billingAgreement.execute(
					ctx.params.token, 
					{}, 
					function (error, billingAgreement) {
						if (error) {
							self.logger.error("payments.paypal1.mixin processAgreement error: ", JSON.stringify(error));
							reject(error);
						} else {
							self.logger.info("payments.paypal1.mixin processAgreement response: ", JSON.stringify(billingAgreement));
							resolve(billingAgreement);
						}
					}
				);
			});
		},


		/**
		 * Execute subscription payment of subscription confirmed by customer
		 * 
		 * @param {Object} ctx 
		 * 
		 * @returns {Object|null}
		 */
		paypalExecuteSubscription(ctx, urlPathPrefix) {
			let self = this;

			// find and update subscription and order
			return ctx.call("subscriptions.find", {
				"query": {
					"data.token": ctx.params.token
				}
			})
				.then(subscriptions => {
					self.logger.info("payments.paypal1.mixin - paypalExecuteSubscription subscriptions (token):", ctx.params.token, subscriptions[0].orderOriginId);
					if (subscriptions && subscriptions[0]) {
						// get order by data.order._id saved in subscription
						return ctx.call("orders.find", {
							"query": {
								"_id": self.fixStringToId(subscriptions[0].orderOriginId)
							}
						})
							.then(orders => {
								if ( orders && orders.length>0 && orders[0] ) {
									let order = orders[0];

									return this.processAgreement(ctx)
										.then((agreement) => {
											// agreement is processed, first payment will come
											self.logger.info("payments.paypal1.mixin - paypalExecuteSubscription processAgreement agreement:", agreement);

											order = self.updatePaidOrderSubscriptionData(order, agreement); // find it in orders.service

											return self.generateInvoice(order, ctx)
												.then(invoice => {
													// set invoices into order
													order.invoice["html"] = invoice.html;
													order.invoice["path"] = invoice.path;
													// set related subscription product and data as processed
													if (order.items && order.items.length>0) {
														for (let i=0; i<order.items.length; i++) {
															if (order.items[i].type==="subscription" && 
															order.items[i]._id.toString()===subscriptions[0].data.product._id.toString()) {
																order.items[i]["processed"] = true;
															}
														}
													}
													if (order.data && order.data.subscription && 
													order.data.subscription.ids && 
													order.data.subscription.ids.length>0) {
														for (let i=0; i<order.data.subscription.ids.length; i++) {
															if (order.data.subscription.ids[i].subscription==subscriptions[0]._id.toString()) {
																order.data.subscription.ids[i]["processed"] = new Date();
															}
														}
													}
													// updating order after all set
													return self.adapter.updateById(order._id, self.prepareForUpdate(order))
														.then(orderUpdated => {
															self.entityChanged("updated", orderUpdated, ctx);
															self.logger.info("payments.paypal1.mixin - paypalExecuteSubscription - invoice generated, order updated", { success: true, response: agreement, redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id.toString() } );
															if ( order.prices.priceTotalToPay==0 && typeof self.afterPaidActions !== "undefined" ) {
																self.afterPaidActions(order, ctx); // find it in orders.service
															}
															return self.updateSubscriptionAfterPaid(ctx, subscriptions[0], agreement)
																.then(updatedSubscr => {
																	self.logger.info(" - updatedSubscr", updatedSubscr );
																	// redirect to original Order to make user accept all ordered subscriptions
																	return { success: true, response: agreement, redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id.toString() };
																});
														});
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
		updatePaidOrderData(order, response) {
			order.dates.datePaid = new Date();
			order.status = "paid";
			order.data.paymentData.lastStatus = response.state;
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


		/**
		 * Update subscription making it active and adding history
		 * 
		 * @param {*} ctx 
		 * @param {*} subscription 
		 * 
		 * @returns {Object} updated subscription
		 */
		updateSubscriptionAfterPaid(ctx, subscription, agreement) {
			let historyRecord = {
				action: "paid",
				type: "user",
				date: new Date(),
				data: {
					agreementResponse: JSON.parse(JSON.stringify(agreement)),
					relatedOrder: null
				}
			};
			subscription.history.push(historyRecord);

			return ctx.call("subscriptions.calculateDateOrderNext", {
				period: subscription.period,
				duration: subscription.duration,
				dateStart: subscription.dates.dateStart,
			})
				.then(dateOrderNextResult => {
					if (dateOrderNextResult) {
					// update subscription
						return ctx.call("subscriptions.update", {
							updateObject: {
								id: subscription._id.toString(),
								status: "active", 
								history: subscription.history,
								dates: {
									dateOrderNext: dateOrderNextResult
								}
							}
						})
							.then(updated => {
								this.logger.info("payments.paypal1.mixin - updateSubscriptionAfterPaid updated:", updated);
								return updated;
							})
							.catch(error => {
								this.logger.error("payments.paypal1.mixin - updateSubscriptionAfterPaid update error: ", error);
								return null;
							});
					} else {
						this.logger.error("payments.paypal1.mixin - updateSubscriptionAfterPaid dateOrderNextResult missing: ", dateOrderNextResult);
						return null;
					}
				})
				.catch(error => {
					this.logger.error("payments.paypal1.mixin - updateSubscriptionAfterPaid calculateDateOrderNext error: ", error);
					return null;
				});
		}

		
	}
};
