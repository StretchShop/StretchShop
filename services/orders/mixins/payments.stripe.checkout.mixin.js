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

const pathResolve = require("path").resolve;

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
									status: "created",
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

		stripeOrderNotification: {
			cache: false,
			auth: "required",
			params: {
				orderId: { type: "string", min: 3 },
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
							if (!order) {
								return this.Promise.reject(new MoleculerClientError("Item not found!", 404));
							}
							const orderPaymentStatus = self.getOrderPaymentStatus(order);
							self.logger.info("payments.stripe.mixin stripeOrderNotification() orderPaymentStatus:", orderPaymentStatus);
							if (data?.lastPrepared === "products") {
								// update order product status to "prepared"
							} else {
								// check if subscription status matches status in order
								// update order subscription status to "prepared"
							}
							result.success = true;
							result.paymentStatus = orderPaymentStatus;
							return result;
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
		 * Resume a paused Stripe subscription, or create a new one when the
		 * previous billing agreement was canceled (Stripe cannot resume canceled).
		 *
		 * @actions
		 *
		 * @param {String} billingRelatedId - Stripe subscription id
		 * @param {Object} subscription - local subscription (metadata, cancel_at)
		 *
		 * @returns {Object} Stripe subscription (and recreate flags)
		 */
		stripeReactivateBillingAgreement: {
			cache: false,
			params: {
				billingRelatedId: { type: "string" },
				subscription: { type: "object", optional: true }
			},
			handler(ctx) {
				const self = this;
				const billingRelatedId = ctx.params.billingRelatedId;
				const localSubscription = ctx.params.subscription || null;

				self.logger.info("payments.stripe.mixin stripeReactivateBillingAgreement:", billingRelatedId);

				return stripe.subscriptions.retrieve(billingRelatedId, {
					expand: ["default_payment_method", "customer"]
				})
					.catch(error => {
						self.logger.warn("payments.stripe.mixin stripeReactivateBillingAgreement retrieve failed:", error?.message || error);
						if (localSubscription?.data?.stripe?.id) {
							return localSubscription.data.stripe;
						}
						return Promise.reject(error);
					})
					.then(stripeSub => {
						if (!stripeSub?.id) {
							return Promise.reject(new MoleculerClientError("Stripe subscription not found", 404, "STRIPE_SUB_NOT_FOUND", []));
						}
						if (["active", "trialing"].includes(stripeSub.status) && !stripeSub.pause_collection) {
							return { existing: true, resumed: false, recreated: false, subscription: stripeSub };
						}
						if (stripeSub.pause_collection || stripeSub.status === "paused") {
							return stripe.subscriptions.resume(billingRelatedId, {
								billing_cycle_anchor: "now"
							})
								.then(resumed => {
									self.logger.info("payments.stripe.mixin stripeReactivateBillingAgreement resumed:", resumed?.id);
									return { existing: false, resumed: true, recreated: false, subscription: resumed };
								});
						}
						const createParams = self.buildStripeSubscriptionRecreateParams(stripeSub, localSubscription);
						if (!createParams.customer || !createParams.items.length) {
							return Promise.reject(new MoleculerClientError(
								"Cannot recreate Stripe subscription — missing customer or price",
								422,
								"STRIPE_RECREATE_INCOMPLETE",
								[]
							));
						}
						if (!createParams.default_payment_method) {
							return Promise.reject(new MoleculerClientError(
								"No payment method on file to reactivate subscription",
								422,
								"NO_PAYMENT_METHOD",
								[]
							));
						}
						return stripe.subscriptions.create(createParams)
							.then(created => {
								self.logger.info("payments.stripe.mixin stripeReactivateBillingAgreement recreated:", created?.id);
								return { existing: false, resumed: false, recreated: true, subscription: created };
							});
					})
					.catch(error => {
						self.logger.error("payments.stripe.mixin stripeReactivateBillingAgreement error:", JSON.stringify(error));
						if (error instanceof MoleculerClientError) {
							return Promise.reject(error);
						}
						return Promise.reject(new MoleculerClientError(
							error?.message || "Stripe reactivate failed",
							422,
							"STRIPE_REACTIVATE_FAILED",
							[]
						));
					});
			}
		}

	},
};
