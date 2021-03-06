"use strict";

const paypal = require("paypal-rest-sdk");
const payments = paypal.v1.payments;
const fetch 		= require("node-fetch");
let base64 = require("base-64");

module.exports = {
	settings: {

		paymentsConfigs: {
			paypal: {
				environment: (process.env.PAYPAL_ENV==="production" || process.env.PAYPAL_ENV==="live") ? "live" : "sandbox",
				merchantId: process.env.PAYPAL_CLIENT_ID,
				publicKey: null,
				privateKey: process.env.PAYPAL_SECRET,
				gateway: null,
				payPalDirectUrls: {
					sandbox: "https://api-m.sandbox.paypal.com",
					live: "https://api-m.paypal.com"
				},
				payPalTokenPath: "v1/oauth2/token"
			}
		}

	},


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
							this.logger.info("PAYMENT:\n", payment, "\n", payment.transactions[0].item_list.items, "\n", payment.transactions[0].amount, "\n\n");

							// TODO - update to API direct calls using node-fetch
							let request = new payments.PaymentCreateRequest();
							request.requestBody(payment);

							return client.execute(request).then((response) => {
								order.data.paymentData.paymentRequestId = response.result.id;
								return this.adapter.updateById(order._id, this.prepareForUpdate(order))
									.then(orderUpdated => {
										this.entityChanged("updated", orderUpdated, ctx);
										this.logger.info("orders.paypalOrderCheckout - orderUpdated after payment", orderUpdated);
										return { order: orderUpdated, payment: response };
									});
							})
								.then(responses => {
									this.logger.info("orders.paypalOrderCheckout - response.payment", responses.payment);

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
				if ( process.env.NODE_ENV=="development" ) {
					urlPathPrefix = "http://localhost:8080/";
				}
				this.logger.info("orders.paypalResult - ctx.params:", ctx.params);
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
								// TODO - update to API direct calls using node-fetch
								let request = new payments.PaymentExecuteRequest(ctx.params.paymentId);
								request.requestBody(execute_payment_json);

								return client.execute(request).then((response) => {
									this.logger.info("response:", response);

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
													this.logger.info("orders.paypalResult - invoice generated", { success: true, response: response, redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id } );
													if ( order.prices.priceTotalToPay==0 && typeof this.afterPaidActions !== "undefined" ) {
														this.afterPaidActions(order, ctx);
													}
													return { success: true, response: response, redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id };
												});
										});
								}).catch((error) => {
									this.logger.error("orders.paypalResult - paypal execute error: ", error);
								});
							}
						});
				} else {
					// payment not finished -- TODO - case cancel does not get correct language
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
							// check if order has any product
							const itemsCount = this.countOrderItemTypes(order);
							if ( itemsCount ) {
								if ( itemsCount.product && itemsCount.product>0 ) {
									// order has product, get url for paying the product
									ctx.params.data["order"] = order;
									return ctx.call("orders.paypalOrderCheckout", {
										orderId: ctx.params.orderId,
										data: ctx.params.data
									});
								} else if ( itemsCount.subscription && itemsCount.subscription>0 ) {
									// order has subscription, get url for confirming the subscription
									ctx.params.data["order"] = order;
									return ctx.call("orders.paypalOrderSubscription", {
										orderId: ctx.params.orderId,
										data: ctx.params.data
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
		 * 
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

				// get order subscription to process
				return this.getOrderSubscriptionsToProcess(ctx, ctx.params.data.order)
					.then(subscriptions => {
						// get first subscription if possible
						if (subscriptions && subscriptions!=null && subscriptions[0] && 
						subscriptions[0].product && subscriptions[0].product._id){
							// check if billing plan exists, if not, create it
							// return billing plan
							const billingPlan = this.getBillingPlan(ctx, subscriptions[0]);
							// 1. create billing agreement based on billing plan
							const billingAgreement = this.createBillingAgreement(
								ctx, billingPlan, subscriptions[0]
							);
							// 2. redirect user
							// 3. in other action - execute the billing agreement using returned token
						}
					});
			}
		},


	},


	methods: {

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
		}, 

		/**
		 * Setting up PayPal Direct Client for token
		 */
		createPayPalDirectClient() {
			let envUrl;
			if (this.settings.paymentsConfigs.paypal.environment === "live") {
				// Live Account details
				envUrl = this.settings.paymentsConfigs.paypal.payPalDirectUrls.live;
			} else {
				envUrl = this.settings.paymentsConfigs.paypal.payPalDirectUrls.sandbox;
			}

			const details = {
				"grant_type": "client_credentials"
			};
			let formBody = [];
			for (let property in details) {
				let encodedKey = encodeURIComponent(property);
				let encodedValue = encodeURIComponent(details[property]);
				formBody.push(encodedKey + "=" + encodedValue);
			}
			formBody = formBody.join("&");

			return fetch(envUrl +"/"+ this.settings.paymentsConfigs.paypal.payPalTokenPath, {
				method: "post",
				body: formBody,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"Accept-Language": "en_US",
					"Authorization": "Basic " + base64.encode(this.settings.paymentsConfigs.paypal.merchantId + ":" + this.settings.paymentsConfigs.paypal.privateKey)
				}
			})
				.then(res => res.json())
				.then(tokenResponse => {
					this.logger.info("payments.paypal.mixin tokenResponse:", tokenResponse);
					if (tokenResponse && tokenResponse.access_token) {
						tokenResponse["stretchshop"] = {
							headers: {
								"Content-Type": "application/json",
								"Authorization": "Bearer " + tokenResponse.access_token
							}
						};
						return tokenResponse;
					} else {
						this.logger.error("payments.paypal.mixin - No access token: ", tokenResponse);
						return { success: false, code: "No access token", error: tokenResponse};
					}
				})
				.catch(err => {
					this.logger.error("payments.paypal.mixin accessToken error: ", err);
				});
		}, 


		/**
		 * 
		 * @param {*} order 
		 */
		countOrderItemTypes(order) {
			let result = {};
			if (order && order.items && order.items.length>0) {
				order.items.forEach(item => {
					if (item && item.type && item.type.toString().trim()!="") {
						if (typeof result[item.type]=="undefined") {
							result[item.type] = 1;
						} else {
							result[item.type]++;
						}
					}
				});
			}
			return result;
		},


		/**
		 * 
		 * @param {Object} ctx 
		 * @param {Object} order 
		 */
		getOrderSubscriptionsToProcess(ctx, order) {
			const today = new Date();

			return ctx.call("subscriptions.find", {
				"query": {
					userId: order.user.id,
					orderOriginId: order._id,
					"dates.dateOrderNext": { "$lte": today },
					"dates.dateEnd": { "$gte": today },
					status: "inactive"
				}
			})
				.then(found => {
					// check if found any inactive subscriptions
					if (found && found.length>0) {
						// those found are NOT confirmed - remaing are the ones already working in this order
						// return array of those that need to be confirmed
						return found;
					}
					return null;
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
			return this.checkIfBillingPlanExists(ctx, subscription.product._id)
				.then(billingPlanFound => {
					if (billingPlanFound && billingPlanFound!=null) {
						return billingPlanFound;
					}
					// billing plan not found, create It
					return this.createBillingPlan(ctx, subscription)
						.then(cratedBillingPlan => {
							return cratedBillingPlan;
						});
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
					this.logger.error("payments.paypal.mixin error", error);
					return null;
				});
		},


		/**
		 * 
		 * @param {*} ctx 
		 * @param {*} subscription 
		 */
		createBillingPlan(ctx, subscription) {
			let siteUrl = ctx.meta.siteSettings.url;
			if ( process.env.NODE_ENV=="development" ) {
				siteUrl = "http://localhost:3000";
			}
			const lang = subscription.data.order.lang.code;
			const orderUrl = siteUrl + "/lang/" +lang+ "/user/orders/" + subscription.orderOriginId;
			let billingPlanAttributes = {
				"name": subscription.orderItemName,
				"description": subscription.orderItemName + " - " + subscription.period + " - " + subscription.duration,
				"merchant_preferences": {
					"auto_bill_amount": "yes",
					"cancel_url": orderUrl,
					"initial_fail_amount_action": "continue",
					"max_fail_attempts": "0",
					"return_url": orderUrl,
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
				"type": "INFINITE"
			};

			// TODO - this is original code, change it to our needs
			const createdBillingPlan = new Promise((resolve, reject) => {
				paypal.billingPlan.create(billingPlanAttributes, function (error, billingPlan) {
					if (error) {
						this.logger.error("payments.paypal.mixin createBillingPlan error: ", error);
						reject(error);
					} else {
						this.logger.info("payments.paypal.mixin createBillingPlan result: ", billingPlan);
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
								this.logger.error("payments.paypal.mixin activate BillingPlan error: ", error);
								reject(error);
							} else {
								this.logger.info("payments.paypal.mixin activate BillingPlan result: ", billingPlan);
								resolve(billingPlan);
							}
						});
					}); // promise
				}
				return null;
			});
		},


		/**
		 * 
		 * @param {*} ctx 
		 * @param {*} billingPlan 
		 * @param {*} subscription 
		 */
		createBillingAgreement(ctx, billingPlan, subscription) {

		}
		
	}
};
