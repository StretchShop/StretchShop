"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { result, get } = require("lodash");
const url = require("url");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");
const DbService = require("../../../mixins/db.mixin");
const PaymentModel = require("../models/payment.model");
const Metadata = require("../models/metadata.model");

const fetch = require("cross-fetch");

// This is a sample test API key. Sign in to see examples pre-filled with your key.
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

let fs = require("fs"); // only temporaly

module.exports = {
	settings: {

		paymentsConfigs: {
		}

	},


	mixins: [
		HelpersMixin,
		priceLevels,
		DbService("orders"), // has to be the last to not override actions
	],

	actions: {
		stripeWebhook: {
			cache: false,
			handler(ctx) {
				let data = ctx.params.data;
				if (data.supplier) { delete data.supplier; }

				const self = this;

				let stripeSignature = ctx.meta.headers["stripe-signature"];

				let event;
				try {
					event = stripe.webhooks.constructEvent(
						data,
						stripeSignature,
						process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET
					);
				} catch (err) {
					this.logger.error("Webhook error:", err);
					return Promise.reject(new MoleculerClientError("Webhook error", 400, "", [{ field: "webhook event", message: "failed" }]));
				}

				this.logger.info("WEBHOOK : metadata:", event?.data?.object);

				this.logger.info("stripeWebhook ---WEBHOOK--- EVENT NAME from event.type :", event?.type);
				this.logger.info("stripeWebhook #1:", JSON.stringify(event));
				try {
					const logDir = "./.temp";
					const logPath = `${logDir}/webhook.log`;
					if (!fs.existsSync(logDir)) {
						fs.mkdirSync(logDir, { recursive: true });
					}
					if (!fs.existsSync(logPath)) {
						fs.writeFileSync(logPath, "");
					}
					if (fs.statSync(logPath).isFile() && (fs.statSync(logPath).mode & 0o200)) {
						const logFile = fs.createWriteStream(logPath, { flags: "a" });
						const date = new Date().toISOString();
						logFile.write(`\n\n${date} Stripe #1:\n${JSON.stringify(ctx.params)}\n`);
						logFile.write(`\n\n${date} Stripe #2:\n${JSON.stringify(event)}\n`);
					}
				} catch (fileErr) {
					this.logger.warn("WEBHOOK : could not write debug log to .temp/webhook.log:", fileErr.message);
				}

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
				if (event?.data?.object?.parent?.subscription_details?.metadata) {
					metadata.type = event.data.object.parent.subscription_details.metadata.type;
					metadata.orderId = event.data.object.parent.subscription_details.metadata.orderId;
					metadata.subscriptionId = event.data.object.parent.subscription_details.metadata.subscriptionId;
					metadata.productId = event.data.object.parent.subscription_details.metadata.productId;
				}

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
				this.logger.info("WEBHOOK : paymentData?.metadata?.orderId:", paymentData?.metadata?.orderId);
				const orderId = event?.data?.object?.metadata?.orderId || paymentData?.metadata?.orderId;
				if (orderId) {
					let filter = { query: { _id: self.fixStringToId(orderId) }, limit: 1 };
					return ctx.call("orders.find", filter)
						.then(foundOrder => {
							this.logger.info("WEBHOOK : order found:", !!foundOrder);
							if (foundOrder) {
								foundOrder = foundOrder[0];
								if (foundOrder?._id && !foundOrder.id) {
									foundOrder.id = foundOrder._id;
								}
								return this.handleStripeWebhookEvent(ctx, event, foundOrder, paymentData);
							}
						})
						.catch(err => {
							this.logger.error("stripeWebhook order lookup error:", err);
							throw err;
						});
				}
				if (["invoice.payment_succeeded", "customer.subscription.deleted"].includes(event.type)) {
					// These subscription-level events carry no orderId in metadata — dispatch directly.
					return this.handleStripeWebhookEvent(ctx, event, null, paymentData);
				}

			}
		}

	},

	methods: {
		handleStripeWebhookEvent(ctx, event, order, paymentData) {
			let self = this;
			this.logger.info("payments.stripe.mixin handleStripeWebhookEvent() #0:", event, order);
			// Handle the event based on its type

			// Handle the event
			switch (event.type) {
				case "charge.succeeded":
				case "payment_intent.succeeded": { // payment of PRODUCTS succeeded
					this.logger.info("WEBHOOK : " + event.type + " ---------- ");
					const data = event.data;

					this.logger.info(event.type + " DATA : ", data, paymentData);

					// update order status according to payment data
					return self.orderPaymentReceived(ctx, order, paymentData, "stripe", "products");
				}

				case "customer.subscription.updated": { // subscription updated - maybe bound to payment method
					this.logger.info("WEBHOOK : " + event.type + " ---------- ");
					const data = event.data;

					this.logger.info("customer.subscription.updated DATA : ", data, paymentData);

					// update order status according to payment data
					self.orderPaymentReceived(ctx, order, paymentData, "stripe", "subscription");

					break;
				}

				case "invoice.payment_succeeded": {
					// ----- SET DEFAULT PAYMENT METHOD for future payments
					const paymentIntent = event.data.object;
					this.logger.info("WEBHOOK invoice.payment_succeeded: " + event.type + " ---------- PaymentIntent was successful!", paymentIntent);
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
					if (paymentIntentId && paymentIntentId != null) {
						stripe.paymentIntents.retrieve(paymentIntentId)
							.then(paymentIntentResult => {
								stripe.subscriptions.update(subscriptionStripeId, {
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
					} else if (paymentData?.metadata?.subscriptionId) {
						// if subscription ID is in metadata, update subscription log with payment info
						this.logger.info("WEBHOOK invoice.payment_succeeded - paymentData.metadata.subscriptionId:", paymentData.metadata);
						ctx.call("subscriptions.find", {
							query: {
								"_id": paymentData.metadata.subscriptionId
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
					}

					break;
				}


				case "charge.updated": {
					this.logger.info("WEBHOOK : " + event.type + " ---------- ");
					const data = event.data;

					this.logger.info("charge.updated DATA : ", data, paymentData);

					// update order status according to payment data
					self.orderPaymentReceived(ctx, order, paymentData, "stripe", "products");

					break;
				}

				case "customer.subscription.deleted": {
					const paymentMethod = event.data.object;
					let subscriptionStripeId = null;
					this.logger.info("WEBHOOK : customer.subscription.deleted local ---------- Subscription has been deleted for Customer!", paymentMethod);
					// get subscription object by its stripeId
					if (paymentMethod?.id && paymentMethod.id.trim() != "") {
						subscriptionStripeId = paymentMethod.id.trim();
					}
					this.logger.info("WEBHOOK customer.subscription.deleted - subscriptionStripeId:", subscriptionStripeId);
					if (subscriptionStripeId && subscriptionStripeId != null) {
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

		updateOrderStatePaidStripe(ctx, order, paymentData, action) {
			const availableActions = ["products", "subscription"];
			let self = this;

			if (order?.data && paymentData && availableActions.includes(action)) {
				if (action === "products") {
					if (paymentData?.status === "succeeded") {
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
						this.logger.error("payments.stripe.mixin updateOrderStateStripe() - payment issue (paid:bool, order product expected): ", paymentData);
					}
				} else if (
					action === "subscription" && order.data.subscription.ids.length > 0 &&
					paymentData?.metadata?.subscriptionId
				) {
					// update subscription payment status
					this.logger.info("payments.stripe.mixin updateOrderStateStripe() - subscription IDs:", order.data.subscription.ids);
					order.data.subscription.ids.some((id, i) => {
						if (
							id.subscription.toString().trim() !== "" &&
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
							self.addUpdateToSubscription(ctx, id.subscription, paymentData, order.data.paymentData.supplier);
							return true;
						}
					});
				}
			}
			this.logger.info("updateOrderStateStripe() order.data.paymentData.supplier:", order.data.paymentData.supplier, order.data.paymentData);
			return order;
		},


		addUpdateToSubscription(ctx, subscriptionId, paymentData, orderSupplierData) {
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


	}
};
