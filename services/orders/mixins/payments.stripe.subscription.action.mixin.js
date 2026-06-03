"use strict";
const { MoleculerClientError } = require("moleculer").Errors;
const { result, get } = require("lodash");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");
const DbService = require("../../../mixins/db.mixin");
const fetch = require("cross-fetch");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = {
	settings: { paymentsConfigs: {} },
	mixins: [ DbService("orders"), HelpersMixin, priceLevels ],
	actions: {
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



	}
};
