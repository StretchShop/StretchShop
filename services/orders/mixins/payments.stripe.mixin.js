"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { result, get } = require("lodash");
const url = require("url");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");
const DbService = require("../../../mixins/db.mixin");
const PaymentModel = require("../models/payment.model");
const Metadata = require("../models/metadata.model");

const fetch 		= require("cross-fetch");

// This is a sample test API key. Sign in to see examples pre-filled with your key.
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const pathResolve = require("path").resolve;

let fs = require("fs"); // only temporaly

module.exports = {
	settings: {

		paymentsConfigs: {
		}

	},


	mixins: [
		DbService("orders"),
		HelpersMixin, 
		priceLevels
	],


	actions: {
		

		/**
		 * Endpoint for FE call to Stripe paymentIntent API
		 * It's used by FE to create paymentIntent in Stripe
		 * and display payment form
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
				order: { type: "object" },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				let result = { success: false, url: null, message: "error" };
				const order = ctx.params.order;

				// get order data
				if ( order && order.data && order.data.paymentData && 
				typeof order.data.paymentData.paymentRequestId === "undefined" ) {
					let paymentType = order.data.paymentData.codename.replace("online_stripe_","");

					let items = [];
					let priceTotalNoSubscriptions = 0;
					let priceSubscriptions = 0;
					for (const element of order.items) {
						if (element.type && element.type=="subscription") {
							if (element.price && element.price>0) {
								priceSubscriptions += element.price;
							}
						} else {
							items.push({
								"name": element.name[order.lang.code],
								"sku": element.orderCode,
								"price": element.price * 100,
								"currency": order.prices.currency.code.toString().toLowerCase(),
								"quantity": element.amount
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
					if (order.prices.priceDelivery > 0) {
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
					}


					let url = ctx.meta.siteSettings.url;
					if ( process.env.NODE_ENV=="development" ) {
						url = "http://localhost:3000";
					}

					// priceTotal is already without subscriptions, just format it to cents
					priceTotalNoSubscriptions = parseInt((order.prices.priceTotal) * 100);

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

					// create Stripe payment intent for order without subscriptions
					return stripe.paymentIntents.create({
						amount: priceTotalNoSubscriptions,
						currency: order.prices.currency.code.toString().toLowerCase(),
						metadata: {
							"orderId": order._id.toString(),
							"type": "products",
						}
						// payment_method_types: ["card"]
						// automatic_payment_methods: {
						// 	enabled: true,
						// },
					})
						.then(pi => {
							this.logger.info("payments.stripe.mixin stripeOrderPaymentintent pi:", pi);
							if (pi && pi.id && pi.id.trim() !== "") {
								// save returned paymentIntent ID to order
								order.data.paymentData["paymentRequestId"] = pi.id;
								// importand data for FE to identify 
								// if products (excluded subscriptions) were paid
								order.data.paymentData["supplier"] = {
									created: (new Date()).toISOString,
									id: pi.id,
									paid: null,
									status: 'created',
								};
								// define order.id for update action
								this.logger.info("payments.stripe.mixin stripeOrderPaymentintent order1:", order);
								order["id"] = order._id;
								this.logger.info("payments.stripe.mixin stripeOrderPaymentintent order2:", order);
								return ctx.call("orders.updateOrder", { order: order })
									.then(updatedOrder => {
										this.logger.info("payments.stripe.mixin stripeOrderPaymentintent order.update:", updatedOrder);
										return {
											clientSecret: pi.client_secret,
											existing: false,
											supplier: order.data.paymentData.supplier
										};
									});
							}
						});
				} else if ( order?.data?.paymentData?.paymentRequestId || order?.data?.paymentData?.supplier?.id ) { // else order 
					// in case of existing paymentIntent, return its client_secret
					const id = order?.data?.paymentData?.paymentRequestId || order?.data?.paymentData?.supplier?.id;
					this.logger.info("payments.stripe.mixin stripeOrderPaymentintent order.data.paymentData.paymentRequestId:", id);
					return stripe.paymentIntents.retrieve(id)
						.then(pi => {
							return {
								clientSecret: pi.client_secret,
								existing: true,
								supplier: order.data.paymentData.supplier
							};
						});
				} // if order

				return result;
			}
		},




		/**
		 * Endpoint for FE call to Stripe subscription API
		 * It's used by FE to create subscription in Stripe
		 * and display payment form
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
				order: { type: "object" },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				let self = this;
				const order = ctx.params.order;
				let data = (typeof ctx.params.data !== "undefined") ? ctx.params.data : null;
				let result = { success: false, url: null, message: "error" };
				let orderSubscriptions = [];

				this.logger.info("payments.stripe.mixin stripeOrderSubscribtion order.data.subscription.ids:", order?.data?.subscription?.ids);
				this.logger.info("payments.stripe.mixin stripeOrderSubscribtion order & data:", order, data);


				// get order data
				if(
					order && order.data?.subscription?.ids && 
					order.data.subscription.ids.length > 0 
				) {

						// confirmation after agreement saved to refresh order
						if (data.action == "subAgree" && data.subscriptionId && data.success == true) {
							return self.agreeOrderSubscription(ctx, data.subscriptionId, order);
						}

						let ids = [];
						// get subscription IDs - product & subscription
						order.data.subscription.ids.forEach(id => {
							if (id && id.supplier?.status != "paid") {
								ids.push(id);
							}
						});
						this.logger.info("payments.stripe.mixin stripeOrderSubscribtion ids:", ids);

						// get status of order payment
						const orderPaymentStatus = self.getOrderPaymentStatus(order);
						this.logger.info("payments.stripe.mixin stripeOrderSubscription #1 orderPaymentStatus:", JSON.stringify(orderPaymentStatus, null, 2));

						// define related object
						const related = {
							ids,
							order, 
							orderPaymentStatus,
							subscription: null,
							product: null,
							result: null
						};

						// get all order subscriptions - to filter them later
						return this.getOrderSubscriptions(ctx, related)
						.then(subscriptions => {
							this.logger.info("payments.stripe.mixin stripeOrderSubscription #1 related:", related);
							orderSubscriptions = subscriptions;
							this.logger.info("payments.stripe.mixin stripeOrderSubscription #1 - orderSubscriptions:", orderSubscriptions);

							// define next subscription to pay
							related.subscription = orderSubscriptions.find(sub => sub._id == order.orderPaymentStatus?.subscriptions?.next?.use?.subscription) || null;

							return related;
						})
						// get related products - !NOTICE - can have different price in order
						.then(related => {
							this.logger.info("payments.stripe.mixin stripeOrderSubscribtion #2 products related:", related);
							return this.getOrderSubscriptionProducts(ctx, related)
								.then(products => {
									related.product = products[0];
									return related;
								});
						})
						.then(related => {
							// the main part of the process:
							// if possible, prepare Stripe subscription (create if needed)
							// and return client_secret for frontend
							this.logger.info("payments.stripe.mixin stripeOrderSubscription #3 related.order:", related.order, related.order.data.subscription.ids );

							// if there are any subscriptions not paid
							if (related?.orderPaymentStatus?.subscriptions?.counters?.remaining?.toPay > 0) {
								
								// if next subscription is the one to pay and it's prepared
								if (related.orderPaymentStatus?.subscriptions?.next?.use?.status === "prepared" && related.orderPaymentStatus.subscriptions.next.use.supplier?.id) {
									const stripeIdToPay = related.orderPaymentStatus.subscriptions.next.use.supplier.id;
									this.logger.info("payments.stripe.mixin stripeOrderSubscription #3.1 stripeIdToPay / next.use:", stripeIdToPay, related.orderPaymentStatus.subscriptions.next.use);
									// get subscription object by its stripeId
									return stripe.subscriptions.retrieve(stripeIdToPay, {
										// to get client_secret for payment of subscription
										// https://stackoverflow.com/questions/77943218/stripe-get-a-client-secret-when-the-amount-is-zero
										expand: ["pending_setup_intent"]
									}).then(stripeSubscription => {
										this.logger.info("payments.stripe.mixin stripeOrderSubscription #3.1 subscription:", stripeSubscription, stripeSubscription?.pending_setup_intent?.client_secret);
										// if it was not paid yet, pending_setup_intent is available with client_secret
										if (stripeSubscription?.pending_setup_intent?.client_secret) {
											related.result = {
												clientSecret: stripeSubscription?.pending_setup_intent?.client_secret,
												existing: true,
												supplier: related.orderPaymentStatus.subscriptions.next.use.supplier
											};
										}
										// if it was paid already, return existing subscription
										// this should hide payment form, if it was displayed
										this.logger.info(
											"payments.stripe.mixin stripeOrderSubscription #3.1 status: ", 
											stripeSubscription.status, 
											["incomplete", "incomplete_expired", "unpaid"].includes(stripeSubscription.status), 
											!(["incomplete", "incomplete_expired", "unpaid"].includes(stripeSubscription.status)) 
										);
										if ( !(["incomplete", "incomplete_expired", "unpaid"].includes(stripeSubscription.status)) ) {
											related.result = {
												clientSecret: null,
												existing: true,
												message: "subscription_agreed",
												supplier: {
													agreed: true,
													stripeSubscription
												}
											};
										}
										return related;
									});
								}
								
								// if next subscription is the one to pay and it's not prepared
								if (related.orderPaymentStatus?.subscriptions?.next?.use?.status === "saved") {
									related.subscription = orderSubscriptions.find(sub => sub._id == related.orderPaymentStatus?.subscriptions?.next?.use?.subscription);
									this.logger.info("payments.stripe.mixin stripeOrderSubscribtion #3.2 - CREATING");
									if (related.subscription) {
										return self.prepareStripeSubscription(ctx, related);
									} else {
										this.logger.error("payments.stripe.mixin stripeOrderSubscribtion #3.2 - subscription to prepare not found:", related.orderPaymentStatus?.subscriptions?.next?.use?.subscription, orderSubscriptions);
										return {
											result: {
												clientSecret: null,
												existing: false,
												supplier: null,
												finished: true,
												message: "Subscription to prepare not found"
											},
											success: false,
										};
									}
								}
							}
							
							related.result = {
								clientSecret: null,
								existing: false,
								supplier: null,
								finished: true
							};
							return related;
						})
						.then(related => {
							this.logger.info("payments.stripe.mixin stripeOrderSubscribtion related:", related);
							this.logger.info("payments.stripe.mixin stripeOrderSubscribtion related.result:", related?.result);
							if (related?.result) {
								this.logger.info("payments.stripe.mixin stripeOrderSubscribtion RESULT IN");
								if (related?.success !== undefined && related.success === false) {
									result.success = false;
								} else {
									result.success = true;
								}
								result.data = related.result;
								result.message = related?.result?.message || "";
							}
							this.logger.info("payments.stripe.mixin stripeOrderSubscribtion RESULT SEND:", result);
							return result;
						});

				} // if order END
			}
		},



		stripeOrderNotification: {
			cache: false,
			auth: "required",
			params: {
				orderId: { type: "object" },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				let self = this;
				let data = (typeof ctx.params.data !== "undefined") ? ctx.params.data : null;
				let result = { success: false, message: "" };
				self.logger.info("payments.stripe.mixin stripeOrderNotification() orderId & data:", ctx.params.orderId, data);

				if (ctx.params.orderId && ctx.params.orderId.trim() != "") {
					return this.adapter.findById(ctx.params.orderId)
						.then(order => {
							const orderPaymentStatus = self.getOrderPaymentStatus(order);
							console.log("orderPaymentStatus: ", orderPaymentStatus);
							if (data.lastPrepared === "products") {
								// update order product status to "prepared"
							} else {
								// check if subscription status matches status in order
								// update order subscription status to "prepared"
							}
						})
						.catch(error => {
							this.logger.error("order.payment - find order error: ", error);
							return this.Promise.reject(new MoleculerClientError("Item not found!", 404));
						});
				}
				return this.Promise.reject(new MoleculerClientError("Item not found!", 404));
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


				return stripe.subscriptions.cancel(
					ctx.params.billingRelatedId
				)
					.then(response => {
						self.logger.info("payments.stripe1.mixin stripeSuspendBillingAgreement response: ", response);
						return response;
					})
					.catch(error => {
						this.logger.error("payments.stripe1.mixin - stripeSuspendBillingAgreement error: ", JSON.stringify(error));
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

				this.logger.info("WEBHOOK : metadata:", event?.data?.object);

				this.logger.info("stripeWebhook ---WEBHOOK--- EVENT NAME from event.type :", event?.type);
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

				if (event?.data?.object?.lines?.data?.prototype === Array) {
					productId = event.data.object.lines.data[0].plan.product;
					priceId = event.data.object.lines.data[0].plan.product;
					amount = event.data.object.lines.data[0].plan.amount; // price = amount / 100
					subscriptionStripeId = event.data.object.lines.data[0].subscription; // price = amount / 100
				}
				this.logger.info("WEBHOOK : orderId:", event?.data?.object?.metadata?.orderId);

				const metadata = {
					type: event?.data?.object?.metadata?.type,
					orderId: event?.data?.object?.metadata?.orderId,
					subscriptionId: event?.data?.object?.metadata?.subscriptionId,
					productId: event?.data?.object?.metadata?.productId
				};

				this.logger.info("WEBHOOK : event?.data?.object?.status:", event?.data?.object?.status);
				this.logger.info("WEBHOOK : paymentData.status = event?.data?.object?.status");

				const paymentData = {
					id: event?.data?.object?.id,
					amount: !event?.data?.object?.amount ? event?.data?.object?.plan?.amount / 100 : event?.data?.object?.amount / 100,
					currency: event?.data?.object?.currency,
					status: event?.data?.object?.status,
					paymentMethod: event?.data?.object?.payment_method_details?.type,
					createdAt: event?.data?.object?.created,
					metadata: metadata,
					originalData: event
				};

				this.logger.info("WEBHOOK : event?.data?.object?.metadata?.orderId:", event?.data?.object?.metadata?.orderId);
				if (event?.data?.object?.metadata?.orderId) {
					let filter = { query: { _id: self.fixStringToId(event.data.object.metadata.orderId) }, limit: 1 };
					ctx.call("orders.find", filter)
						.then(foundOrder => {
							this.logger.info("WEBHOOK : order found:", !!foundOrder);
							if (foundOrder) {
								foundOrder = foundOrder[0];
								if (foundOrder?._id && !foundOrder.id) {
									foundOrder.id = foundOrder._id;
								}
								this.handleStripeWebhookEvent(ctx, event, foundOrder, paymentData);
							}
						});
				}
				
			}
		},

		


	},


	methods: {

		handleStripeWebhookEvent(ctx, event, order, paymentData) {
			let self = this;
			this.logger.info("payments.stripe.mixin handleStripeWebhookEvent() #0:", event, order);
			// Handle the event based on its type
		
			// Handle the event
			switch (event.type) {
				case "charge.succeeded": { // payment of PRODCUTS succeeded
					this.logger.info("WEBHOOK : "+ event.type +" ---------- ");
					const data = event.data;
					
					this.logger.info("charge.succeeded DATA : ", data, paymentData);

					// update order status according to payment data
					self.orderPaymentReceived(ctx, order, paymentData, "stripe", "products");

					break;
				}

				case "customer.subscription.updated": { // subscription updated - maybe bound to payment method
					this.logger.info("WEBHOOK : "+ event.type +" ---------- ");
					const data = event.data;
					
					this.logger.info("customer.subscription.updated DATA : ", data, paymentData);
					
					// update order status according to payment data
					self.orderPaymentReceived(ctx, order, paymentData, "stripe", "subscription");

					break;
				}

				case "invoice.payment_succeeded": {
					// ----- SET DEFAULT PAYMENT METHOD for future payments
					const paymentIntent = event.data.object;
					this.logger.info("WEBHOOK invoice.payment_succeeded: "+ event.type +" ---------- PaymentIntent was successful!", paymentIntent);
					// get subscription object by its stripeId
					let subscriptionStripeId = null;
					if (paymentIntent?.subscription && paymentIntent.subscription.trim() != "") {
						subscriptionStripeId = paymentIntent.subscription.trim();
					}
					let paymentIntentId = null;
					if (paymentIntent?.payment_intent && paymentIntent.payment_intent.trim() != "") {
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
												if (subscriptions?.[0]) {
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


				case "charge.updated": {					
					this.logger.info("WEBHOOK : "+ event.type +" ---------- ");
					const data = event.data;
					
					this.logger.info("charge.updated DATA : ", data, paymentData);

					// update order status according to payment data
					self.orderPaymentReceived(ctx, order, paymentData, "stripe", "products");

					break;
				}

				case "customer.subscription.deleted": {
					const paymentMethod = event.data.object;
					this.logger.info("WEBHOOK : customer.subscription.deleted local ---------- Subscription has been deleted for Customer!", paymentMethod);
					// get subscription object by its stripeId
					if (paymentMethod?.id && paymentMethod.id.trim() != "") {
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
		},

		getOrderSubscriptions(ctx, related) {
			let self = this;
			let filter = { query: {} };
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() related.order:", related.order);

			// add ids of subscriptions that are not agreed
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() DEBUG1:", related.ids , related.order );
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() DEBUG2:", related.order.data.subscription);
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() DEBUG3:", related.order.data.subscription.ids);
			if (related.ids && related?.order?.data?.subscription?.ids) { 
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
					this.logger.info("payments.stripe.mixin getOrderSubscriptions() subscriptions:", subscriptions);
					return subscriptions;
				})
				.catch(err => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptions() err:", err);
					return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "product", message: "not found"}]));
				});
		},


		/**
		 * Get Order Subscription products from datasource.
		 * Even we have products saved in order, we need to get them from datasource
		 * because we need to get latest stripe IDs for products and prices.
		 * (it may not be saved in time of order creation)
		 * 
		 * @param {*} ctx 
		 * @param {*} related 
		 * @returns 
		 */
		getOrderSubscriptionProducts(ctx, related) {
			let self = this;
			let filter = { query: {}, limit: 1 };
			this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() related:", related);

			// add ids of subscriptions that are not agreed
			if (related?.orderPaymentStatus?.subscriptions?.next?.use?.product ) { 
				filter.query = {
					_id: related.orderPaymentStatus.subscriptions.next.use.product
				};
			}

			if ( Object.keys(filter.query).length < 1 ) {
				return null;
			}
			this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() filter:", filter, filter.query);

			// get product to that don't have stripe IDs (productId, stripe.prices)
			return ctx.call("products.find", filter)
				.then(subscriptionProducts => {
					this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() subscriptionProducts:", subscriptionProducts);
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
					related.customer = customer;
					this.logger.info("payments.stripe.mixin pSS() #3.X customer:", customer);
					return this.stripeCreateSubscription(ctx, related);
				})
				.then(stripeSubscriptionResult => {
					related.result = stripeSubscriptionResult;
					return related;
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
				if ( related?.product?.data?.stripe?.productId &&  
				related.product.data.stripe.productId.toString().trim()!="" ) {
					this.logger.info("payments.stripe.mixin pSS() #1.1 true");
					resolve(true);
				}
				this.logger.info("payments.stripe.mixin pSS() #1.1 false");
				resolve(false);
			})
				.then(hasId => {
					if (hasId) {
						this.logger.info("payments.stripe.mixin pSS() #1.2 result:", related.product);
						return related.product;
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
				description: related.product.descriptionShort[lang],
			})
				.then(stripeProduct => {
					this.logger.info("payments.stripe.mixin pSS() #1.3.1 stripeProduct:", stripeProduct);
					let updateProduct = { ...related.product};
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
				const priceCode = self.getStripePriceAmountCode(related.product.price);
				if ( related?.product?.data?.stripe?.prices?.[priceCode]?.toString().trim() == "" ) {
					this.logger.info("payments.stripe.mixin pSS() #2.1 true");
					resolve(true);
				}
				this.logger.info("payments.stripe.mixin pSS() #2.1 false");
				resolve(false);
			})
				.then(hasId => {
					if (hasId) {
						const result = {
							id: related.product.data.stripe.prices[priceCode],
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
						interval: related.subscription?.period, 
						interval_count: related.subscription?.duration
					},
					product: related.product.data.stripe.productId,
				}
			);

			const stripePriceAmount = this.getStripePriceAmount(product.price); // price as positive integer in cents
			// create Stripe price for product
			return stripe.prices.create({
				unit_amount: stripePriceAmount, 
				currency: related.order.prices.currency.code,
				recurring: {
					interval: related.subscription?.period, 
					interval_count: related.subscription?.duration
				},
				product: related.product.data.stripe.productId,
			})
				.then(stripePrice => {
					this.logger.info("payments.stripe.mixin pSS() #2.3.2 stripePrice:", stripePrice);
					let updateProduct = Object.assign({}, related.product);
					if (!updateProduct.data.stripe) { updateProduct.data["stripe"] = {}; }
					if (!updateProduct.data.stripe.prices) {  updateProduct.data.stripe["prices"] = {}; } 
					// add stripe price ID to product
					const priceCode = self.getStripePriceAmountCode(product.price);
					updateProduct.data.stripe.prices[priceCode] = stripePrice.id;
					// prepare product to update with stripe price ID
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
				if ( ctx?.meta?.user?.data?.stripe?.id && 
				ctx.meta.user.data.stripe.id.toString().trim()!="" ) {
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

			let stripeSubsProductPriceId = self.getStripeSubProdPriceIdByAmountCode(related);
			this.logger.info("payments.stripe.mixin pSS() #4.0 stripeSubsProductPriceId:", stripeSubsProductPriceId);

			this.logger.info("payments.stripe.mixin pSS() #4.1 stripeRequestObject:", {
				customer: related.customer.id,
				items: [{
					price: stripeSubsProductPriceId, // result of checkPrice()
				}],
				payment_behavior: "default_incomplete", 
				expand: ["latest_invoice.payment_intent"], 
			});

			const stripeSubscription = {
				customer: related.customer.id,
				items: [{
					price: stripeSubsProductPriceId, // result of checkPrice()
				}],
				payment_behavior: "default_incomplete", 
				expand: ["latest_invoice.payment_intent"], 
				// add metadata to receive them in webhook
				metadata: {
					"subscriptionId": related?.subscription?._id?.toString() || "",
					"orderId": related?.order?._id?.toString() || "",
					"productId": related?.product?._id?.toString() || "",
				}
			}
			// if trial subscription, set trial end date from subscription dateStart
			if (related?.subscription?.data?.product?.data?.subscription?.cyclesTrial > 0 && 
				related?.subscription?.dates?.dateStart) {
				let trialEndDate = new Date(related.subscription.dates.dateStart); // timestamp in seconds
				if (trialEndDate && trialEndDate.getTime() > 0) {
					const period = related.subscription.data.product.data.subscription.period;
					let periodNumber = 24 * 60 * 60; // default is day in seconds
					if (period == "week") { periodNumber = 7 * 24 * 60 * 60; }
					if (period == "month") { periodNumber = 30 * 24 * 60 * 60; }
					if (period == "year") { periodNumber = 365 * 24 * 60 * 60; }
					periodNumber = periodNumber * 1000; // convert to milliseconds
					trialEndDate = new Date(trialEndDate.getTime() + (related.subscription.data.product.data.subscription.cyclesTrial * periodNumber)); // add days
					stripeSubscription["trial_end"] = Math.round(trialEndDate.getTime() / 1000);
					stripeSubscription["payment_behavior"] = "default_incomplete";
					stripeSubscription["expand"] = ['pending_setup_intent'];
				}
			}

			this.logger.info("payments.stripe.mixin pSS() #4.1.1 stripeSubscription:", stripeSubscription);

			return stripe.subscriptions.create(stripeSubscription)
				.then(stripeSubscription => {
					this.logger.info("payments.stripe.mixin pSS() #4.2 stripeSubscription:", stripeSubscription);
					this.logger.info("payments.stripe.mixin pSS() #4.2 updateSubscription LI:", stripeSubscription?.latest_invoice);
					this.logger.info("payments.stripe.mixin pSS() #4.2 updateSubscription LI.PI:", stripeSubscription?.latest_invoice?.payment_intent);
					// prepare to save stripe response into subscription
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
							if (!updateOrder.id && updateOrder._id) {
								updateOrder.id = updateOrder._id;
							}
							this.logger.info("payments.stripe.mixin pSS() #4.3.1 updateOrder.data.subscription.ids:", updateOrder.data.subscription.ids);
							updateOrder.data.subscription.ids.some((id, i) => {
								this.logger.info("payments.stripe.mixin pSS() #4.3.2 id.subscription == updatedSubscription._id:", id.subscription, updatedSubscription._id.toString());
								if (id.subscription == updatedSubscription._id.toString()) {
									// update important information in related order.subscription.ids[i]
									updateOrder.data.subscription.ids[i]["updated"] = new Date();
									updateOrder.data.subscription.ids[i]["lastPaidDate"] = null;
									// our subsciption status (1 of 3 possible) - it means is saved, but not prepared for payment, or paid yet
									updateOrder.data.subscription.ids[i]["status"] = "saved";
									updateOrder.data.subscription.ids[i]["supplier"] = {
										created: new Date(stripeSubscription.created * 1000),
										id: stripeSubscription.id,
										paid: false,
										status: stripeSubscription.status, // any status from Stripe
									}
									// TODO - check if order is paid (with related products & subscriptions)
									return true;
								}
							});
							this.logger.info("payments.stripe.mixin pSS() #4.4 updateOrder:", updateOrder);
							return ctx.call("orders.updateOrder", { order: updateOrder })
								.then(updatedOrder => {
									this.logger.info("payments.stripe.mixin pSS() #4.5 updateOrder:", updatedOrder);
									let clientSecret = stripeSubscription?.latest_invoice?.payment_intent?.client_secret;
									if (related?.subscription?.data?.product?.data?.subscription?.cyclesTrial > 0) {
										clientSecret = stripeSubscription?.pending_setup_intent?.client_secret
									}
									const result = {
										id: stripeSubscription.id,
										existing: false,
										clientSecret,
										supplier: null
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
			self.logger.info("payments.stripe.mixin agreeOrderSubscription() subscriptionId:", subscriptionId);

			if (subscriptionId) {
				// find subscription by its stripe id
				let filter = {
					query: { "data.stripe.id": subscriptionId },
					limit: 1
				};
				return ctx.call("subscriptions.find", filter)
					.then(subscriptions => {
						self.logger.info("payments.stripe.mixin agreeOrderSubscription() subscriptions:", subscriptionId);
						if (subscriptions && subscriptions[0]) {
							let subscription = subscriptions[0];
							// update order
							let updateOrder = Object.assign({}, order);
							updateOrder.data.subscription.ids.some((id, i) => {
								if (id.subscription == subscription._id.toString()) {
									updateOrder.data.subscription.ids[i]["lastPaidDate"] = new Date();
									return true;
								}
							});
							self.logger.info("payments.stripe.mixin agreeOrderSubscription() updateOrder:", updateOrder);
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
			for (const element of paymentData.lastResponseResult) {
				if ( // subscription (regular payments)
					element.status && 
					element.status == "paid" && 
					element.amount_paid
				) {
					paymentData.paidAmountTotal += parseFloat(
						element.amount_paid / 100
					);
				} else if ( // paymentIntent (product)
					element.status && 
					element.status == "succeeded" && 
					element.amount_received
				) {
					paymentData.paidAmountTotal += parseFloat(
						element.amount_received / 100
					);
				}
			}
		},


		updateOrderStatePaidStripe(order, paymentData, action) {
			const availableActions = ["products", "subscription"];
			let self = this;

			if (order?.data && paymentData && availableActions.includes(action)) {
				if (action === "products") {
					if ( paymentData?.status === "succeeded" ) {
						// update product payment status
						order.data.paymentData.supplier.status = "paid";
						// update product payment boolean
						order.data.paymentData.supplier.paid = true;
						// set product charge ID
						order.data.paymentData.supplier.id = paymentData.id;
						// push last response data
						if (!order.data.paymentData.lastResponseResult) {
							order.data.paymentData.lastResponseResult = [];
						}
						order.data.paymentData.lastResponseResult.push(paymentData);
					} else {
						this.logger.error("payments.stripe.mixin updateOrderStateStripe() - payment issue (paid:bool, order product expected): ", paymentData );
					}
				} else if (
					action === "subscription" && order.data.subscription.ids.length > 0 && 
					paymentData?.metadata?.subscriptionId
				) {	
					// update subscription payment status
					this.logger.info("payments.stripe.mixin updateOrderStateStripe() - subscription IDs:", order.data.subscription.ids);
					order.data.subscription.ids.some((id, i) => {
						if (
							id.subscription.toString().trim() !== '' && 
							id.subscription == paymentData.metadata?.subscriptionId
						) {
							// update subscription payment status
							order.data.subscription.ids[i].supplier.status = self.mapStripeSubscriptionStatus(paymentData.status);
							self.logger.info("payments.stripe.mixin updateOrderStateStripe() - mapped status:", order.data.subscription.ids[i].supplier.status);
							// update subscription payment boolean
							order.data.subscription.ids[i].supplier.paid = true;
							// set subscription charge ID
							order.data.subscription.ids[i].supplier.id = paymentData.id;
							// push last response data
							if (!order.data.paymentData.lastResponseResult) {
								order.data.paymentData.lastResponseResult = [];
							}
							order.data.paymentData.lastResponseResult.push(paymentData);
							// update also subscription after payment
							self.addUpdateToSubscription(id.subscription, paymentData, order.data.paymentData.supplier);
							return true;
						}
					});
				}
			}
			this.logger.info("updateOrderStateStripe() order.data.paymentData.supplier:", order.data.paymentData.supplier, order.data.paymentData);
			return order;
		},


		addUpdateToSubscription(subscriptionId, paymentData, orderSupplierData)	{
			if (subscriptionId && paymentData && orderSupplierData) {
				// add update to subscription supplier data
				return ctx.call("subscriptions.update", 
				{
					updateObject: { 
						id: subscriptionId,
						status: orderSupplierData.status,
					},
					historyRecordToAdd: {
						action: "payment",
						type: "stripe",
						date: new Date(),
						data: {
							type: "paymentData",
							content: paymentData,
						}
					} 
				})
				.then(updated => {
					return updated;
				})
				.catch(error => {
					this.logger.error("subscriptions.addToHistory() - error: ", JSON.stringify(error));
					return null;
				});
			}
		},


		mapStripeSubscriptionStatus(status) {
			const statusMap = {
				"incomplete": "failed", 
				"incomplete_expired": "failed", 
				"trialing": "trialing", 
				"active": "active", 
				"past_due": "failed", 
				"canceled": "canceled", 
				"unpaid": "failed", 
				"paused": "paused",
			};

			return statusMap[status] || status;
		},


		/**
		 * Get price in format that is used by Stripe
		 * 
		 * @param {Number} price 
		 * @returns {String}
		 */
		getStripePriceAmount(price) {
			return price * 100; // price as positive integer in cents
		},

		/**
		 * Get code that is used to identify stored Stripe price ID
		 * 
		 * @param {Number} price 
		 * @returns {String}
		 */
		getStripePriceAmountCode(price) {
			return "sp_" + this.getStripePriceAmount(price).toString();
		},

		/**
		 * Get Stripe price ID by product and price
		 * 
		 * @param {Object} related
		 */
		getStripeSubProdPriceIdByAmountCode(related) {
			const price = related?.subscription?.data?.product?.price || null;
			if (price) {
				const priceCode = this.getStripePriceAmountCode(price);
				if (related?.product?.data?.stripe?.prices && related?.product.data.stripe.prices[priceCode]) {
					return related?.product.data.stripe.prices[priceCode];
				}
			}
			return null;
		}
		
	}
};
