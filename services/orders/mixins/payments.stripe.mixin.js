"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { result } = require("lodash");
const url = require("url");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");
const DbService = require("../../../mixins/db.mixin");

const fetch 		= require("cross-fetch");

// This is a sample test API key. Sign in to see examples pre-filled with your key.
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
		DbService("orders"),
		HelpersMixin, 
		priceLevels
	],


	actions: {
		

		/**
		 * Endpoint for Stripe paymentIntent API (AKA Checkout for common products = no subscriptions)
		 *
		 * @actions
		 * 
     * @param {String} orderId - id of order to pay
     * @param {Object} data - data specific for payment
		 * 
		 * @returns {Object} Result from Stripe order checkout
		 */
		stripeOrderPaymentintent: {
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
						if ( order && order.data && order.data.paymentData && 
						typeof order.data.paymentData.paymentRequestId === "undefined" ) {
							let paymentType = order.data.paymentData.codename.replace("online_stripe_","");

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
										"price": order.items[i].price * 100,
										"currency": order.prices.currency.code.toString().toLowerCase(),
										"quantity": order.items[i].amount
									});
								}
							}
							items.push({
								"name": order.data.paymentData.name[order.lang.code],
								"sku": order.data.paymentData.name[order.lang.code],
								"price": order.prices.pricePayment * 100,
								"currency": order.prices.currency.code.toString().toLowerCase(),
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
								"price": order.prices.priceDelivery * 100,
								"currency": order.prices.currency.code.toString().toLowerCase(),
								"quantity": 1
							});


							let url = ctx.meta.siteSettings.url;
							if ( process.env.NODE_ENV=="development" ) {
								url = "http://localhost:3000";
							}

							priceTotalNoSubscriptions = parseInt((order.prices.priceTotal - priceSubscriptions) * 100);

							let payment = {
								"intent": "sale",
								"payer": {
									"payment_method": paymentType
								},
								"redirect_urls": {
									"cancel_url": url +"/backdirect/order/stripe/cancel",
									"return_url": url +"/backdirect/order/stripe/return"
								},
								"transactions": [{
									"item_list": {
										"items": items
									},
									"amount": {
										"currency": order.prices.currency.code,
										"total": priceTotalNoSubscriptions
									},
									// "note_to_payer": "Order ID "+order._id,
									"soft_descriptor": process.env.SITE_NAME.substring(0,22) // maximum length of accepted string
								}]
							};
							this.logger.info("payments.stripe.mixin stripeOrderCheckout payment / items / amount:", payment, payment.transactions[0].item_list.items, payment.transactions[0].amount);

							return stripe.paymentIntents.create({
								amount: priceTotalNoSubscriptions,
								currency: order.prices.currency.code.toString().toLowerCase(),
								payment_method_types: ["card"]
								// automatic_payment_methods: {
								// 	enabled: true,
								// },
							})
								.then(pi => {
									this.logger.info("payments.stripe.mixin stripeOrderPaymentintent pi:", pi);
									if (pi && pi.id && pi.id.trim() !== "") {
										order.data.paymentData["paymentRequestId"] = pi.id;
										// define order.id for update action
										this.logger.info("payments.stripe.mixin stripeOrderPaymentintent order1:", order);
										order["id"] = order._id;
										// delete order._id;
										this.logger.info("payments.stripe.mixin stripeOrderPaymentintent order2:", order);
										return ctx.call("orders.updateOrder", { order: order })
											.then(updatedOrder => {
												this.logger.info("payments.stripe.mixin stripeOrderPaymentintent order.update:", updatedOrder);
												return {
													clientSecret: pi.client_secret
												};
											});
									}
								});
						} else if ( order.data.paymentData.paymentRequestId ) { // else order 
							return stripe.paymentIntents.retrieve(order.data.paymentData.paymentRequestId)
								.then(pi => {
									return {
										clientSecret: pi.client_secret,
										existing: true
									};
								});
						} // if order
					});
			}
		},




		/**
		 * Endpoint for Stripe subscription API
		 * 
		 *
		 * @actions
		 * 
     * @param {String} orderId - id of order to pay
     * @param {Object} data - data specific for payment
		 * 
		 * @returns {Object} Result from Stripe order checkout
		 */
		stripeOrderSubscription: {
			cache: false,
			auth: "required",
			params: {
				orderId: { type: "string", min: 3 },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				let self = this;
				let data = (typeof ctx.params.data !== "undefined") ? ctx.params.data : null;
				let result = { success: false, url: null, message: "error" };


				// get order data
				return this.adapter.findById(ctx.params.orderId)
					.then(order => {
						this.logger.info("payments.stripe.mixin stripeOrderSubscribtion order & data:", order, data);
						if ( order && order.data && order.data.subscription && 
						order.data.subscription.ids && 
						order.data.subscription.ids.length > 0 ) {

							// confirmation after agreement saved to refresh order
							if (data.action == "subAgree" && data.subscriptionId && data.success == true) {
								return self.agreeOrderSubscription(ctx, data.subscriptionId, order);
							}

							let ids = [];
							// get subscription IDs - product & subscription
							order.data.subscription.ids.forEach(id => {
								ids.push(id);
							});
							return {
								ids,
								order, 
								subscription: null,
								product: null
							};
						}
					})
					// get related subscriptions
					.then(related => {
						this.logger.info("payments.stripe.mixin stripeOrderSubscribtion related 1:", related);
						return this.getOrderSubscriptions(ctx, related)
							.then(subscriptions => {
								related.subscription = subscriptions[0];
								return related;
							});
					})
					// get related products
					.then(related => {
						this.logger.info("payments.stripe.mixin stripeOrderSubscribtion related 2:", related);
						return this.getOrderSubscriptionProducts(ctx, related)
							.then(products => {
								related.product = products[0];
								return related;
							});
					})
					.then(related => {
						this.logger.info("payments.stripe.mixin stripeOrderSubscribtion related 3:", related);
						return self.prepareStripeSubscription(ctx, related);
					})
					.then(res => {
						this.logger.info("payments.stripe.mixin stripeOrderSubscribtion res:", res);
						if (res) {
							result.success = true;
							result.data = res;
							result.message = "";
						}
						return result;
					});
			}
		},



		/**
		 * Suspend Billing Agreement AKA Stripe Subscription
		 * 
		 * @actions
		 * 
		 * @param {String} billingRelatedId - id of subscription
		 *
		 * @returns {Object} response from service
		 */
		stripeSuspendBillingAgreement: {
			cache: false,
			params: {
				billingRelatedId: { type: "string" }
			},
			handler(ctx) {
				let self = this;
				let suspendNote = { note: "User canceled from StretchShop" };

				// this.stripeConfigure();
				self.logger.info("payments.stripe1.mixin stripeSuspendBillingAgreement ctx.params.billingRelatedId: ", ctx.params.billingRelatedId);


				return stripe.subscriptions.del(
					ctx.params.billingRelatedId
				)
					.then(response => {
						self.logger.info("payments.stripe1.mixin stripeSuspendBillingAgreement response: ", response);
						return response;
					})
					.catch(error => {
						this.logger.error("payments.paypal1.mixin - paypalSuspendBillingAgreement error: ", JSON.stringify(error));
						return null;
					});
			}
		},


		
		/**
		 * Stripe webhook to listen to Stripe actions
		 * 
		 * @actions
		 * 
		 */
		stripeWebhook: {
			cache: false,
			handler(ctx) {
				let data = ctx.params.data;
				if ( data.supplier ) { delete data.supplier; }

				const self = this;

				let stripeSignature = ctx.meta.headers["stripe-signature"];
				this.logger.info("stripeWebhook ----- data :", typeof data, data);
				this.logger.info("stripeWebhook ----- stripeSignature :", typeof stripeSignature, stripeSignature);
				this.logger.info("stripeWebhook ----- process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET :", typeof process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET, process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET);

				let event;
				try {
					event = stripe.webhooks.constructEvent(
						data, 
						stripeSignature, 
						process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET
					);
				} catch (err) {
					this.logger.error("Webhook error:", err);
					return Promise.reject(new MoleculerClientError("Webhook error", 400, "", [{ field: "webhook event", message: "failed"}]));
				}

				this.logger.info("stripeWebhook #1:", JSON.stringify(event));
				this.logger.info("path resolve:", pathResolve("./.temp/ipnlog.log"));
				let log_file = fs.createWriteStream("./.temp/ipnlog.log", {flags : "a"});
				let date = new Date();
				log_file.write( "\n\n" + date.toISOString() + "Stripe #1:\n"+ JSON.stringify(ctx.params)+"\n");

				/**
				 * Watch out, there can be multiple lines:
				 * event.data.object.lines.data[?]
				 */

				let productId = null;
				let priceId = null;
				let amount = null; // price = amount / 100
				let subscriptionStripeId = null; // price = amount / 100

				if (event && event.data && event.data.object && event.data.object.lines && 
				event.data.object.lines.data && event.data.object.lines.data.prototype === Array) {
					productId = event.data.object.lines.data[0].plan.product;
					priceId = event.data.object.lines.data[0].plan.product;
					amount = event.data.object.lines.data[0].plan.amount; // price = amount / 100
					subscriptionStripeId = event.data.object.lines.data[0].subscription; // price = amount / 100
				}
				

				// Handle the event
				switch (event.type) {

				case "invoice.payment_succeeded": {
					// ----- SET DEFAULT PAYMENT METHOD for future payments
					const paymentIntent = event.data.object;
					this.logger.info("WEBHOOK invoice.payment_succeeded: "+ event.type +" ---------- PaymentIntent was successful!", paymentIntent);
					// get subscription object by its stripeId
					let subscriptionStripeId = null;
					if (paymentIntent && paymentIntent.subscription && paymentIntent.subscription.trim() != "") {
						subscriptionStripeId = paymentIntent.subscription.trim();
					}
					let paymentIntentId = null;
					if (paymentIntent && paymentIntent.payment_intent && paymentIntent.payment_intent.trim() != "") {
						paymentIntentId = paymentIntent.payment_intent.trim();
					}
					this.logger.info("WEBHOOK invoice.payment_succeeded - subscriptionStripeId:", subscriptionStripeId);
					if (paymentIntentId && paymentIntentId!=null) {
						stripe.paymentIntents.retrieve(paymentIntentId)
							.then( paymentIntentResult => {
								stripe.subscriptions.update( subscriptionStripeId, {
									default_payment_method: paymentIntentResult.payment_method
								})
									.then(defaultPaymentMethodUpdate => {
										this.logger.info("WEBHOOK invoice.payment_succeeded - defaultPaymentMethodUpdate:", defaultPaymentMethodUpdate);
										// update subscription 
										ctx.call("subscriptions.find", {
											query: {
												"data.stripe.id": subscriptionStripeId
											},
											limit: 1
										})
											.then(subscriptions => {
												this.logger.info("WEBHOOK invoice.paid - subscriptions found:", subscriptions);
												if (subscriptions && subscriptions[0]) {
													if (subscriptions[0].data.order.data.paymentData.lastResponseResult) {
														subscriptions[0].data.order.data.paymentData.lastResponseResult.push(paymentIntent);
													}
													this.subscriptionPaymentReceived(ctx, subscriptions[0]); // find in orders.service
												}
											});
									})
									.catch(error => {
										this.logger.error("WEBHOOK invoice.payment_succeeded error: ", JSON.stringify(error));
										return null;
									});
							})
							.catch(error => {
								this.logger.error("WEBHOOK invoice.payment_succeeded error: ", JSON.stringify(error));
								return null;
							});
					}
					break;
				}

				case "invoice.paid": { // subscription payment received
					// const paymentIntent = event.data.object;
					this.logger.info("WEBHOOK : "+ event.type +" ---------- DISABLED because of double action");
					break;
				}

				case "payment_intent.succeeded": { // product payment received
					const paymentIntent = event.data.object;
					this.logger.info("WEBHOOK invoice.payment_succeeded: ", paymentIntent);
					if ( paymentIntent && paymentIntent.id && paymentIntent.id.trim() !== "" ) {
						return ctx.call("orders.find", {
							"query": {
								"data.paymentData.paymentRequestId": paymentIntent.id
							}
						})
							.then(orders => {
								if ( orders && orders.length>0 && orders[0] ) {
									let order = orders[0];
									if (order) {
										// process payment data 
										// and make order paid
										// --
										order.data.paymentData.lastDate = new Date();
										// get amount paid in this payment
										if (!order.data.paymentData.lastResponseResult) { 
											order.data.paymentData["lastResponseResult"] = []; 
										}
										if (!order.data.paymentData.paidAmountTotal) { 
											order.data.paymentData["paidAmountTotal"] = 0; 
										}
										order.data.paymentData.paidAmountTotal = paymentIntent.amount;
										// add new payment record
										order.data.paymentData.lastResponseResult.push(paymentIntent);
										// get total amount paid
										self.getPaidTotalStripe(order.data.paymentData);
										
										// calculate how much to pay
										order.prices.priceTotalToPay = order.prices.priceTotal - order.data.paymentData.paidAmountTotal;

										// decide if set PAID status
										if (order.prices.priceTotalToPay <= 0) {
											order.status = "paid";
											order.dates.datePaid = new Date();
											if ( typeof self.afterPaidUserUpdates !== "undefined" ) {
												self.afterPaidUserUpdates(order, ctx);
											}
											if ( typeof self.afterPaidActions !== "undefined" ) {
												self.afterPaidActions(order, ctx); // custom actions
											}
										}
										self.logger.info("orders.stripeWebhook (payments.stripe.mixin) payment_intent.succeeded (PRODUCT PAID) - status, dates & paidAmountTotal:", order.status, order.dates, order.data.paymentData.paidAmountTotal );
										// 
										self.orderPaymentReceived(ctx, order, "online_stripe");
									}
								}
							})
							.catch((error) => {
								self.logger.error("payments.stripe.mixin - stripeWebhook - find order error: ", error);
							});
					}
					break;
				}

				case "payment_method.attached": {
					const paymentMethod = event.data.object;
					this.logger.info("WEBHOOK : payment_method.attached ---------- PaymentMethod was attached to a Customer!", paymentMethod);
					break;
				}

				case "customer.subscription.created": {
					const paymentMethod = event.data.object;
					this.logger.info("WEBHOOK : customer.subscription.created ---------- Subscription has been created for Customer!", paymentMethod);
					break;
				}
				case "invoice.payment_failed": {
					const paymentMethod = event.data.object;
					this.logger.info("WEBHOOK : invoice.payment_failed ---------- Payment failed or the customer does not have a valid payment method!", paymentMethod);
					break;
				}
				case "customer.subscription.deleted": {
					const paymentMethod = event.data.object;
					this.logger.info("WEBHOOK : customer.subscription.deleted local ---------- Subscription has been deleted for Customer!", paymentMethod);
					// get subscription object by its stripeId
					if (paymentMethod && paymentMethod.id && paymentMethod.id.trim() != "") {
						subscriptionStripeId = paymentMethod.id.trim();
					}
					this.logger.info("WEBHOOK customer.subscription.deleted - subscriptionStripeId:", subscriptionStripeId);
					if (subscriptionStripeId && subscriptionStripeId!=null) {
						ctx.call("subscriptions.find", {
							query: {
								"data.stripe.id": subscriptionStripeId
							},
							limit: 1
						})
							.then(subscriptions => {
								this.logger.info("WEBHOOK customer.subscription.deleted - subscriptions found:", subscriptions);
								if (subscriptions && subscriptions[0]) {
									this.subscriptionCancelled(ctx, subscriptions[0]); // find in orders.service
								}
							});
					}
					break;
				}
				// ... handle other event types
				default: {
					this.logger.info(`WEBHOOK : other event type ---------- Unhandled event type ${event.type}`, event);
					break;
				}
				}
			}
		},

		


	},


	methods: {

		
		getOrderSubscriptions(ctx, related) {
			let self = this;
			let filter = { query: {}, limit: 1 };
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() related.order:", related.order);

			// add ids of subscriptions that are not agreed
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() DEBUG1:", related.ids , related.order );
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() DEBUG2:", related.order.data.subscription);
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() DEBUG3:", related.order.data.subscription.ids);
			if (related.ids && related.order && related.order.data && 
			related.order.data.subscription && related.order.data.subscription.ids) { 
				let idsObjs = [];
				related.order.data.subscription.ids.forEach(id => {
					// check if subscription is agreed, if - add its product
					if (!id.agreed || id.agreed.toString().trim()=="") {
						idsObjs.push(self.fixStringToId(id.subscription));
					}
				});
				if (idsObjs.length > 0) {
					filter.query = {
						_id: { "$in": idsObjs }
					};
				}
			}
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() filter:", filter, filter.query);

			// get related subscriptions without stripeID
			return ctx.call("subscriptions.find", filter)
				.then(subscriptions => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptions() subscriptions:", subscriptions);
					return subscriptions;
				})
				.catch(err => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptions() err:", err);
					return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "product", message: "not found"}]));
				});
		},


		getOrderSubscriptionProducts(ctx, related) {
			let self = this;
			let filter = { query: {}, limit: 1 };
			this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() related:", related);

			// add ids of subscriptions that are not agreed
			if (related.ids && related.subscription && related.subscription.data &&
				related.subscription.data.product && related.subscription.data.product._id ) { 
				filter.query = {
					_id: related.subscription.data.product._id
				};
			}

			if ( Object.keys(filter.query).length < 1 ) {
				return null;
			}
			this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() filter:", filter, filter.query);

			// get product to that don't have stripe IDs (productId, defaultPriceId)
			return ctx.call("products.find", filter)
				.then(subscriptionProducts => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptionProducts() subscriptionProducts:", subscriptionProducts);
					return subscriptionProducts;
				})
				.catch(err => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptionProducts() err:", err);
					return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "product", message: "not found"}]));
				});
		},


		/**
		 * 
		 * @param {Object} ctx 
		 * @param {Object} related 
		 */
		prepareStripeSubscription(ctx, related) {
			let user = ctx.meta.user;
			this.logger.info("payments.stripe.mixin pSS() #0:");
			
			return this.checkProduct(ctx, related)
				.then(stripeProduct => {
					related.product = stripeProduct;
					this.logger.info("payments.stripe.mixin pSS() #1.X related.product:", related.product);
					return this.checkPrice(ctx, related);
				})
				.then(stripeProductPrice => {
					related.product = stripeProductPrice;
					this.logger.info("payments.stripe.mixin pSS() #2.X related.product:", related.product);
					return this.checkCustomer(ctx, related);
				})
				.then(customer => {
					this.logger.info("payments.stripe.mixin pSS() #3.X customer:", customer);
					return this.stripeCreateSubscription(ctx, related);
				})
				.catch(err => {
					this.logger.error("payments.stripe.mixin prepareStripeSubscription() err:", err);
					return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "stripe subscription", message: "error"}]));
				});
		},


		/**
		 * 
		 * @param {Object} related 
		 * @returns Promise
		 */
		checkProduct(ctx, related) {
			let self = this;
			let lang = this.getOrderLang(related.order);
			
			return new Promise((resolve, reject) => {
				this.logger.info("payments.stripe.mixin pSS() #1:", related.product);
				if ( related.product && related.product.stripe && related.product.stripe.productId &&  
				related.product.stripe.productId.toString().trim()!="" ) {
					this.logger.info("payments.stripe.mixin pSS() #1.1 true");
					resolve(true);
				}
				this.logger.info("payments.stripe.mixin pSS() #1.1 false");
				resolve(false);
			})
				.then(hasId => {
					if (hasId) {
						const result = {
							id: related.product.stripe.productId,
							object: "product",
							name: related.product.name[lang] + " - " + related.product._id,
							description: related.product.descriptionShort[lang]
						};
						this.logger.info("payments.stripe.mixin pSS() #1.2 result:", result);
						return result;
					}
					return self.stripeCreateProduct(ctx, related);
				});
		},


		// #1
		/**
		 * 
		 * @param {Object} related 
		 * @returns Promise
		 */
		stripeCreateProduct(ctx, related) {
			let lang = this.getOrderLang(related.order);
			this.logger.info("payments.stripe.mixin pSS() #1.3 related.product:", related.product);

			// check if product does exist
			return stripe.products.create({
				name: related.product._id + " - " + related.product.name[lang],
				description: related.product.descriptionShort[lang]
			})
				.then(stripeProduct => {
					this.logger.info("payments.stripe.mixin pSS() #1.3.1 stripeProduct:", stripeProduct);
					let updateProduct = Object.assign({}, related.product);
					if (!updateProduct.data.stripe) { updateProduct.data["stripe"] = {}; }
					updateProduct.data.stripe["productId"] = stripeProduct.id;
					if ( updateProduct && updateProduct._id && !updateProduct.id ) {
						updateProduct.id = updateProduct._id;
						delete updateProduct._id;
					}
					this.logger.info("payments.stripe.mixin pSS() #1.3.2 updateProduct:", updateProduct);
					return ctx.call("products.import", { products: [updateProduct] })
						.then(updatedProducts => {
							if (updatedProducts[0]) {
								this.logger.info("payments.stripe.mixin pSS() #1.3.3 updatedProducts[0]:", updatedProducts[0]);
								return updatedProducts[0];
							}
							return updateProduct;
						})
						.catch(err => {
							this.logger.error("payments.stripe.mixin stripeCreateProduct() err:", err);
							return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "stripe product", message: "error"}]));
						});
				});
		},


		/**
		 * 
		 * @param {Object} order 
		 * @param {Object} product 
		 * @returns Promise
		 */
		checkPrice(ctx, related) {
			let self = this;
			
			return new Promise((resolve, reject) => {
				this.logger.info("payments.stripe.mixin pSS() #2:", related.product);
				if ( related.product.stripe && related.product.stripe.defaultPriceId &&  
				related.product.stripe.defaultPriceId.toString().trim()=="" ) {
					this.logger.info("payments.stripe.mixin pSS() #2.1 true");
					resolve(true);
				}
				this.logger.info("payments.stripe.mixin pSS() #2.1 false");
				resolve(false);
			})
				.then(hasId => {
					if (hasId) {
						const result = {
							id: related.product.stripe.defaultPriceId,
							object: "price",
						};
						this.logger.info("payments.stripe.mixin pSS() #2.2 result:", result);
						return result;
					}
					return self.stripeCreatePrice(ctx, related);
				});
		},


		// #2
		stripeCreatePrice(ctx, related) {
			let self = this;
			let product = self.priceByUser(related.product, ctx.meta.user);
			this.logger.info("payments.stripe.mixin pSS() #2.3 related.product:", related.product);

			this.logger.info("payments.stripe.mixin pSS() #2.3.1 stripeRequestObject:", 
				product.price, 
				{
					unit_amount: product.price * 100, // price as positive integer in cents
					currency: related.order.prices.currency.code,
					recurring: {
						interval: related.subscription.period, 
						interval_count: related.subscription.duration
					},
					product: related.product.data.stripe.productId,
				}
			);

			return stripe.prices.create({
				unit_amount: product.price * 100, // price as positive integer in cents
				currency: related.order.prices.currency.code,
				recurring: {
					interval: related.subscription.period, 
					interval_count: related.subscription.duration
				},
				product: related.product.data.stripe.productId,
			})
				.then(stripePrice => {
					this.logger.info("payments.stripe.mixin pSS() #2.3.2 stripePrice:", stripePrice);
					let updateProduct = Object.assign({}, related.product);
					if (!updateProduct.data.stripe) { updateProduct.data["stripe"] = {}; }
					updateProduct.data.stripe["defaultPriceId"] = stripePrice.id;
					if ( updateProduct && updateProduct._id && !updateProduct.id ) {
						updateProduct.id = updateProduct._id;
						delete updateProduct._id;
					}
					this.logger.info("payments.stripe.mixin pSS() #2.3.3 updateProduct:", updateProduct);
					return ctx.call("products.import", { products: [updateProduct] })
						.then(updatedProducts => {
							if (updatedProducts[0]) {
								this.logger.info("payments.stripe.mixin pSS() #2.3.4 updatedProducts[0]:", updatedProducts[0]);
								return updatedProducts[0];
							}
							return updateProduct;
						})
						.catch(err => {
							this.logger.error("payments.stripe.mixin stripeCreatePrice() err:", err);
							return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "stripe price", message: "error"}]));
						});
				});
		},


		/**
		 * 
		 * @param {Object} related
		 * @returns Promise
		 */
		checkCustomer(ctx, related) {
			let self = this;
			let lang = this.getOrderLang(related.order);
			
			// check if we have customer ID
			return new Promise((resolve, reject) => {
				this.logger.info("payments.stripe.mixin pSS() #3:", ctx.meta.user.data);
				if ( ctx.meta && ctx.meta.user && ctx.meta.user.data && ctx.meta.user.data.stripe && 
				ctx.meta.user.data.stripe.id && 
				ctx.meta.user.data.stripe.id.toString().trim()=="" ) {
					this.logger.info("payments.stripe.mixin pSS() #3.1 true");
					resolve(true);
				}
				this.logger.info("payments.stripe.mixin pSS() #3.1 false");
				resolve(false);
			})
				.then(hasId => {
					// get customer's name from invoice address
					let name = ctx.meta.user.email;
					if (ctx.meta.user.addresses) {
						ctx.meta.user.addresses.some(a => {
							if (a.type == "invoice") {
								name = a.nameFirst + " " + a.nameLast;
							}
						});
					}
					this.logger.info("payments.stripe.mixin pSS() #3.2 name:", name);
					if (hasId) {
						// if customer already has stripe ID, return them
						const result = {
							id: ctx.meta.user.data.stripe.id,
							data: ctx.meta.user.data,
							email: ctx.meta.user.email,
							description: ctx.meta.user.bio,
							name: name
						};
						this.logger.info("payments.stripe.mixin pSS() #3.3 name:", result);
						return result;
					}
					related["customer"] = {
						email: ctx.meta.user.email,
						description: ctx.meta.user.bio,
						name: name
					};
					this.logger.info("payments.stripe.mixin pSS() #3.4 related.customer:", related.customer);
					return self.stripeCreateCustomer(ctx, related);
				});
		},


		// #3
		stripeCreateCustomer(ctx, related) {
			this.logger.info("payments.stripe.mixin pSS() #3.5 related.customer:", related.customer);
			return stripe.customers.create(related.customer)
				.then(stripeCustomer => {
					this.logger.info("payments.stripe.mixin pSS() #3.6 related.customer:", stripeCustomer);
					// use response to fill data for related customer
					related.customer["id"] = stripeCustomer.id;
					related.customer["data"] = stripeCustomer;
					// add response to ctx user
					if (!ctx.meta.user.data) { ctx.meta.user["data"] = {}; }
					if (!ctx.meta.user.data.stripe) { ctx.meta.user.data["stripe"] = {}; }
					ctx.meta.user.data.stripe = stripeCustomer;
					this.logger.info("payments.stripe.mixin pSS() #3.7 updateProduct:", ctx.meta.user.data.stripe);
					return ctx.call("users.updateUser", { user: ctx.meta.user } )
						.then(updatedUser => {
							this.logger.info("payments.stripe.mixin pSS() #3.8 updatedUser & related.customer:", updatedUser, related.customer);
							return related.customer;
						});
				});
		},


		// #4
		stripeCreateSubscription(ctx, related) {
			let self = this;
			this.logger.info("payments.stripe.mixin pSS() #4");

			this.logger.info("payments.stripe.mixin pSS() #4.1 stripeRequestObject:", {
				customer: related.customer.id,
				items: [{
					price: related.product.data.stripe.defaultPriceId, // result of createPrice()
				}],
				payment_behavior: "default_incomplete", 
				expand: ["latest_invoice.payment_intent"], 
			});

			return stripe.subscriptions.create({
				customer: related.customer.id,
				items: [{
					price: related.product.data.stripe.defaultPriceId, // result of createPrice()
				}],
				payment_behavior: "default_incomplete", 
				expand: ["latest_invoice.payment_intent"], 
			})
				.then(stripeSubscription => {
					this.logger.info("payments.stripe.mixin pSS() #4.2 stripeSubscription:", stripeSubscription);
					let updateSubscription = Object.assign({}, related.subscription);
					if (!updateSubscription.data.stripe) { updateSubscription.data["stripe"] = {}; }
					updateSubscription.data.stripe = stripeSubscription;
					if ( updateSubscription && updateSubscription._id && !updateSubscription.id ) {
						updateSubscription.id = updateSubscription._id;
						delete updateSubscription._id;
					}
					this.logger.info("payments.stripe.mixin pSS() #4.2 updateSubscription:", updateSubscription);
					return ctx.call("subscriptions.save", { entity: updateSubscription })
						.then(updatedSubscription => {
							this.logger.info("payments.stripe.mixin pSS() #4.3 updatedSubscription:", updatedSubscription);
							// update order
							let updateOrder = Object.assign({}, related.order);
							updateOrder.data.subscription.ids.some((id, i) => {
								if (id.subscription == updatedSubscription._id.toString()) {
									updateOrder.data.subscription.ids[i]["created"] = new Date();
									// TODO - check if order is paid (with related products & subscriptions)
									return true;
								}
							});
							this.logger.info("payments.stripe.mixin pSS() #4.4 updateOrder:", updateOrder);
							return ctx.call("orders.updateOrder", { order: updateOrder })
								.then(updatedOrder => {
									this.logger.info("payments.stripe.mixin pSS() #4.5 updateOrder:", updatedOrder);
									const result = {
										id: stripeSubscription.id,
										clientSecret: stripeSubscription.latest_invoice.payment_intent.client_secret
									};
									this.logger.info("payments.stripe.mixin pSS() #4.6 result:", result);
									return result;
								});
						})
						.catch(err => {
							this.logger.error("payments.stripe.mixin stripeCreateSubscription() err:", err);
							return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "stripe subscription", message: "error"}]));
						});
				});
		},



		agreeOrderSubscription(ctx, subscriptionId, order) {
			let self = this;

			if (subscriptionId) {
				// find subscription by its stripe id
				let filter = {
					query: { "data.stripe.id": subscriptionId },
					limit: 1
				};
				return ctx.call("subscriptions.find", filter)
					.then(subscriptions => {
						if (subscriptions && subscriptions[0]) {
							let subscription = subscriptions[0];
							// update order
							let updateOrder = Object.assign({}, order);
							updateOrder.data.subscription.ids.some((id, i) => {
								if (id.subscription == subscription._id.toString()) {
									updateOrder.data.subscription.ids[i]["agreed"] = new Date();
									return true;
								}
							});
							// update order
							return ctx.call("orders.updateOrder", { order: updateOrder })
								.then(updatedOrder => {
									self.logger.info("payments.stripe.mixin agreeOrderSubscription() updatedOrder:", updatedOrder);
									// update subscription to agreed status
									let updateSubscription = Object.assign({}, subscription);
									updateSubscription.status = "agreed"; 
									updateSubscription.dates["dateAgreedStripe"] = new Date();
									if ( updateSubscription && updateSubscription._id && !updateSubscription.id ) {
										updateSubscription.id = updateSubscription._id;
										delete updateSubscription._id;
									}
									return ctx.call("subscriptions.save", { entity: updateSubscription })
										.then(updatedSubscription => {
											self.logger.info("payments.stripe.mixin agreeOrderSubscription() updatedSubscription:", updatedSubscription);
											return { success: true, url: null, message: "agreed" };
										});
								});
						}
					});
			}
			return null;
		},


		/**
		 * Get order lang if possible, else return default "en"
		 * 
		 * @param {Object} order 
		 * @returns String
		 */
		getOrderLang(order) {
			order = (typeof withPrice !== "undefined") ? order : null;

			let lang = "en";
			if (order !== null) {
				lang = order.lang.code;
			}

			return lang;
		},



		/**
		 * Count amount paid total for Stripe subscription payments
		 * 
		 * @param {Object} paymentData - by reference
		 */
		getPaidTotalStripe(paymentData) {
			// calculate total amount paid for Stripe
			for ( let i=0; i<paymentData.lastResponseResult.length; i++ ) {
				if ( // subscription (regular payments)
					paymentData.lastResponseResult[i].status && 
					paymentData.lastResponseResult[i].status == "paid" && 
					paymentData.lastResponseResult[i].amount_paid
				) {
					paymentData.paidAmountTotal += parseFloat(
						paymentData.lastResponseResult[i].amount_paid / 100
					);
				} else if ( // paymentIntent (product)
					paymentData.lastResponseResult[i].status && 
					paymentData.lastResponseResult[i].status == "succeeded" && 
					paymentData.lastResponseResult[i].amount_received
				) {
					paymentData.paidAmountTotal += parseFloat(
						paymentData.lastResponseResult[i].amount_received / 100
					);
				}
			}
		},
		
	}
};
