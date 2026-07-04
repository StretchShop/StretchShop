"use strict";
const { MoleculerClientError } = require("moleculer").Errors;
const { result, get } = require("lodash");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");
const DbService = require("../../../mixins/db.mixin");
const fetch = require("cross-fetch");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = {
	mixins: [ DbService("orders"), HelpersMixin, priceLevels ],
	methods: {
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
				expand: self.getStripeSubscriptionExpandFields(),
			});

			const stripeSubscription = {
				customer: related.customer.id,
				items: [{
					price: stripeSubsProductPriceId, // result of checkPrice()
				}],
				payment_behavior: "default_incomplete",
				payment_settings: {
					save_default_payment_method: "on_subscription",
				},
				expand: self.getStripeSubscriptionExpandFields(),
				// add metadata to receive them in webhook
				metadata: {
					"subscriptionId": related?.subscription?._id?.toString() || "",
					"orderId": related?.order?._id?.toString() || "",
					"productId": related?.product?._id?.toString() || "",
				}
			};
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
				}
			}

			this.logger.info("payments.stripe.mixin pSS() #4.1.1 stripeSubscription:", stripeSubscription);

			return stripe.subscriptions.create(stripeSubscription)
				.then(stripeSubscription => {
					this.logger.info("payments.stripe.mixin pSS() #4.2 stripeSubscription:", stripeSubscription);
					this.logger.info("payments.stripe.mixin pSS() #4.2 updateSubscription LI:", stripeSubscription?.latest_invoice);
					this.logger.info("payments.stripe.mixin pSS() #4.2 updateSubscription LI.confirmation_secret:", stripeSubscription?.latest_invoice?.confirmation_secret);
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
									};
									// TODO - check if order is paid (with related products & subscriptions)
									return true;
								}
							});
							this.logger.info("payments.stripe.mixin pSS() #4.4 updateOrder:", updateOrder);
							return ctx.call("orders.updateOrder", { order: updateOrder })
								.then(updatedOrder => {
									this.logger.info("payments.stripe.mixin pSS() #4.5 updateOrder:", updatedOrder);
									const clientSecret = self.getStripeSubscriptionClientSecret(stripeSubscription);
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
	}
};
