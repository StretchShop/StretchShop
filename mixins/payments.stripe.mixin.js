"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { result } = require("lodash");
const url = require("url");
const paypal = require("paypal-rest-sdk");
const HelpersMixin = require("./helpers.mixin");
const priceLevels = require("./price.levels.mixin");
const fetch 		= require("node-fetch");

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
		 * @returns {Object} Result from PayPal order checkout
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
						if ( order ) {
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
									"cancel_url": url +"/backdirect/order/paypal/cancel",
									"return_url": url +"/backdirect/order/paypal/return"
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
									"soft_descriptor": process.env.SITE_NAME.substr(0,22) // maximum length of accepted string
								}]
							};
							this.logger.info("payments.stripe.mixin paypalOrderCheckout payment / items / amount:", payment, payment.transactions[0].item_list.items, payment.transactions[0].amount);

							return stripe.paymentIntents.create({
								amount: priceTotalNoSubscriptions,
								currency: order.prices.currency.code.toString().toLowerCase()
							})
								.then(pi => {
									this.logger.info("payments.stripe.mixin stripeOrderPaymentintent pi:", pi);
									return {
										clientSecret: pi.client_secret
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
		 * @returns {Object} Result from PayPal order checkout
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
						return this.getOrderSubscriptions(ctx, related.ids)
							.then(subscriptions => {
								related.subscription = subscriptions[0];
								return related;
							});
					})
					// get related products
					.then(related => {
						this.logger.info("payments.stripe.mixin stripeOrderSubscribtion related 2:", related);
						return this.getOrderSubscriptionProducts(ctx, related.ids)
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
		 * Reactivate Billing Agreement
		 * 
		 * @actions
		 * 
		 */
		stripeWebhook: {
			cache: false,
			handler(ctx) {
				console.log("params", ctx.params);
				let data = ctx.params.data;
				if ( data.supplier ) { delete data.supplier; }

				let stripeSignature = ctx.options.parentCtx.options.parentCtx.params.req.headers["stripe-signature"];
				this.logger.info("stripeWebhook ----- stripeSignature :", stripeSignature);

				let event;
				try {
					event = stripe.webhooks.constructEvent(data, stripeSignature, process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET);
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

				let productId = event.data.object.lines.data[0].plan.product;
				let priceId = event.data.object.lines.data[0].plan.product;
				let amount = event.data.object.lines.data[0].plan.amount; // price = amount / 100

				// Handle the event
				switch (event.type) {
				case "payment_intent.succeeded": { // payment received
					const paymentIntent = event.data.object;
					console.log("PaymentIntent was successful!", paymentIntent);
					break;
				}
				case "payment_method.attached": {
					const paymentMethod = event.data.object;
					console.log("PaymentMethod was attached to a Customer!", paymentMethod);
					break;
				}
				case "customer.subscription.created": {
					const paymentMethod = event.data.object;
					console.log("Subscription has been created for Customer!", paymentMethod);
					break;
				}
				case "customer.subscription.deleted": {
					const paymentMethod = event.data.object;
					console.log("Subscription has been deleted for Customer!", paymentMethod);
					break;
				}
				// ... handle other event types
				default: {
					console.log(`Unhandled event type ${event.type}`);
				}
				}


				/*
				setTimeout(() => {

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
				*/
			}
		},

		


	},


	methods: {

		
		getOrderSubscriptions(ctx, ids) {
			let self = this;
			let filter = { query: {} };
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() ids:", ids);

			// add ids of subscriptions that are not agreed
			if (ids) { 
				let idsObjs = [];
				ids.forEach(id => {
					// check if subscription is agreed, if not, add its product
					if (!id.agreed || id.agreed.toString().trim()=="") {
						idsObjs.push(self.fixStringToId(id.subscription));
					}
				});
				filter.query = {
					_id: { "$in": idsObjs }
				};
				filter.limit = 1;
			}
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() filter:", filter, filter.query);

			// get related subscriptions without stripeID
			return ctx.call("subscriptions.find", filter)
				.then(subscriptions => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptions() subscriptions:", subscriptions);
					// TODO - filter only those with stripe ID
					return subscriptions;
				})
				.catch(err => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptions() err:", err);
					return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "product", message: "not found"}]));
				});
		},


		getOrderSubscriptionProducts(ctx, ids) {
			let self = this;
			let filter = { query: {} };
			this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() ids:", ids);

			// add ids of subscriptions that are not agreed
			if (ids) { 
				let idsObjs = [];
				ids.forEach(id => {
					// check if subscription is agreed, if not, add its product
					if (!id.agreed || id.agreed.toString().trim()=="") {
						idsObjs.push(self.fixStringToId(id.product));
					}
				});
				filter.query = {
					_id: { "$in": idsObjs }
				};
				filter.limit = 1;
			}
			this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() filter:", filter, filter.query);


			// get products to that don't have stripe IDs (productId, defaultPriceId)
			return ctx.call("products.find", filter)
				.then(subscriptionProducts => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptionProducts() subscriptionProducts:", subscriptionProducts);
					// TODO - filter only those with stripe ID
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
			
			return this.checkProduct(ctx, related)
				.then(stripeProduct => {
					related.product = stripeProduct;
					return this.checkPrice(ctx, related);
				})
				.then(stripeProductPrice => {
					related.product = stripeProductPrice;
					return this.checkCustomer(ctx, related);
				})
				.then(customer => {
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
				if ( related.product && related.product.stripe && related.product.stripe.productId &&  
					related.product.stripe.productId.toString().trim()!="" ) {
					resolve(true);
				}
				resolve(false);
			})
				.then(hasId => {
					if (hasId) {
						return {
							id: related.product.stripe.productId,
							object: "product",
							name: related.product.name[lang] + " - " + related.product._id,
							description: related.product.descriptionShort[lang]
						};
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

			// check if product does exist
			return stripe.products.create({
				name: related.product._id + " - " + related.product.name[lang],
				description: related.product.descriptionShort[lang]
			})
				.then(stripeProduct => {
					let updateProduct = Object.assign({}, related.product);
					if (!updateProduct.data.stripe) { updateProduct.data["stripe"] = {}; }
					updateProduct.data.stripe["productId"] = stripeProduct.id;
					if ( updateProduct && updateProduct._id && !updateProduct.id ) {
						updateProduct.id = updateProduct._id;
						delete updateProduct._id;
					}
					return ctx.call("products.import", { products: [updateProduct] })
						.then(updatedProducts => {
							if (updatedProducts[0]) {
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
				if ( related.product.stripe && related.product.stripe.defaultPriceId &&  
					related.product.stripe.defaultPriceId.toString().trim()=="" ) {
					resolve(true);
				}
				resolve(false);
			})
				.then(hasId => {
					if (hasId) {
						return {
							id: related.product.stripe.defaultPriceId,
							object: "price",
						};
					}
					return self.stripeCreatePrice(ctx, related);
				});
		},


		// #2
		stripeCreatePrice(ctx, related) {
			let self = this;
			let product = self.priceByUser(related.product, ctx.meta.user);

			this.logger.info("payments.stripe.mixin stripeCreatePrice() stripeRequestObject:", 
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
					let updateProduct = Object.assign({}, related.product);
					if (!updateProduct.data.stripe) { updateProduct.data["stripe"] = {}; }
					updateProduct.data.stripe["defaultPriceId"] = stripePrice.id;
					if ( updateProduct && updateProduct._id && !updateProduct.id ) {
						updateProduct.id = updateProduct._id;
						delete updateProduct._id;
					}
					return ctx.call("products.import", { products: [updateProduct] })
						.then(updatedProducts => {
							if (updatedProducts[0]) {
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
				if ( ctx.meta && ctx.meta.user && ctx.meta.user.data && ctx.meta.user.data.stripe && 
				ctx.meta.user.data.stripe.id && 
				ctx.meta.user.data.stripe.id.toString().trim()=="" ) {
					resolve(true);
				}
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
					if (hasId) {
						// if customer already has stripe ID, return them
						return {
							id: ctx.meta.user.data.stripe.id,
							data: ctx.meta.user.data,
							email: ctx.meta.user.email,
							description: ctx.meta.user.bio,
							name: name
						};
					}
					related["customer"] = {
						email: ctx.meta.user.email,
						description: ctx.meta.user.bio,
						name: name
					};
					return self.stripeCreateCustomer(ctx, related);
				});
		},


		// #3
		stripeCreateCustomer(ctx, related) {
			return stripe.customers.create(related.customer)
				.then(stripeCustomer => {
					// use response to fill data for related customer
					related.customer["id"] = stripeCustomer.id;
					related.customer["data"] = stripeCustomer;
					// add response to ctx user
					if (!ctx.meta.user.data) { ctx.meta.user["data"] = {}; }
					if (!ctx.meta.user.data.stripe) { ctx.meta.user.data["stripe"] = {}; }
					ctx.meta.user.data.stripe = stripeCustomer;
					return ctx.call("users.updateUser", { user: ctx.meta.user } )
						.then(updatedUser => {
							return related.customer;
						});
				});
		},


		// #4
		stripeCreateSubscription(ctx, related) {
			let self = this;

			return stripe.subscriptions.create({
				customer: related.customer.id,
				items: [{
					price: related.product.data.stripe.defaultPriceId, // result of createPrice()
				}],
				payment_behavior: "default_incomplete", 
				expand: ["latest_invoice.payment_intent"], 
			})
				.then(stripeSubscription => {
					self.logger.info("payments.stripe.mixin stripeCreateSubscription() stripeSubscription:", stripeSubscription);
					let updateSubscription = Object.assign({}, related.subscription);
					if (!updateSubscription.data.stripe) { updateSubscription.data["stripe"] = {}; }
					updateSubscription.data.stripe = stripeSubscription;
					if ( updateSubscription && updateSubscription._id && !updateSubscription.id ) {
						updateSubscription.id = updateSubscription._id;
						delete updateSubscription._id;
					}
					return ctx.call("subscriptions.save", { entity: updateSubscription })
						.then(updatedSubscription => {
							self.logger.info("payments.stripe.mixin stripeCreateSubscription() updatedSubscription:", updatedSubscription);
							// update order
							let updateOrder = Object.assign({}, related.order);
							updateOrder.data.subscription.ids.some((id, i) => {
								if (id.subscription == updatedSubscription._id.toString()) {
									updateOrder.data.subscription.ids[i]["agreed"] = new Date();
									// TODO - check if order is paid (with related products & subscriptions)
									return true;
								}
							});
							return ctx.call("orders.update", { order: updateOrder })
								.then(updatedOrder => {
									self.logger.info("payments.stripe.mixin stripeCreateSubscription() updatedOrder:", updatedOrder);
									return {
										id: stripeSubscription.id,
										clientSecret: stripeSubscription.latest_invoice.payment_intent.client_secret
									};
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
							return ctx.call("orders.update", { order: updateOrder })
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
		}
		
	}
};
