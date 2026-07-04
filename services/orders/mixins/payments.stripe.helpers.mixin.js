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

	methods: {
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


		updateOrderStatePaidStripe(ctx, order, paymentData, action) {
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


		addUpdateToSubscription(ctx, subscriptionId, paymentData, orderSupplierData)	{
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
		},


		/**
		 * Client secret for Stripe Payment Element on subscriptions.
		 * Stripe API 2025-03-31+ exposes invoice.confirmation_secret instead of invoice.payment_intent.
		 *
		 * @param {Object} stripeSubscription
		 * @returns {string|null}
		 */
		getStripeSubscriptionClientSecret(stripeSubscription) {
			if (stripeSubscription?.pending_setup_intent?.client_secret) {
				return stripeSubscription.pending_setup_intent.client_secret;
			}
			if (stripeSubscription?.latest_invoice?.confirmation_secret?.client_secret) {
				return stripeSubscription.latest_invoice.confirmation_secret.client_secret;
			}
			// Legacy Stripe API (< 2025-03-31.basil)
			return stripeSubscription?.latest_invoice?.payment_intent?.client_secret || null;
		},


		getStripeSubscriptionExpandFields() {
			return ["latest_invoice.confirmation_secret", "pending_setup_intent"];
		}

	}
};
