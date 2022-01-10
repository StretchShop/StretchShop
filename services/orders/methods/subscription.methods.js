"use strict";


module.exports = {
	methods: {

		/**
		 * Updates order amount according to response from subscription
		 * agreement
		 * 
		 * @param {Object} order 
		 * @param {Object} response 
		 * 
		 * @returns {Object} order updated
		 */
		updatePaidOrderSubscriptionData(order, response) { // RESPONSE
			order.dates.datePaid = new Date();
			if ( order.data.paymentData.codename && 
			order.data.paymentData.codename.indexOf("online_stripe") > -1 ) {
				order.data.paymentData.lastStatus = response.status;
			} else {
				order.data.paymentData.lastStatus = response.state;
			}
			order.data.paymentData.lastDate = new Date();
			order.data.paymentData.paidAmountTotal = 0;
			if ( !order.data.paymentData.lastResponseResult ) {
				order.data.paymentData.lastResponseResult = [];
			}
			// add response (= data from webhook) to payment history
			order.data.paymentData.lastResponseResult.push(response);
			// count total paid from order payment data by reference
			if ( order.data.paymentData.codename && 
			order.data.paymentData.codename.indexOf("online_stripe") > -1 ) {
				this.getPaidTotalStripe(order.data.paymentData);
			} else {
				this.getPaidTotalPaypal(order.data.paymentData);
			}
			
			// calculate how much to pay
			order.prices.priceTotalToPay = order.prices.priceTotal - order.data.paymentData.paidAmountTotal;

			// decide if set PAID status
			if (order.prices.priceTotalToPay <= 0) {
				order.status = "paid";
			}

			this.logger.info("orders.updatePaidOrderSubscriptionData() - status, dates & paidAmountTotal:", order.status, order.dates, order.data.paymentData.paidAmountTotal );

			return order;
		},



		/**
		 * Get inactive subscriptions related to specific order & user
		 * 
		 * @param {Object} ctx 
		 * @param {Object} order 
		 */
		getOrderSubscriptionsToProcess(ctx, order) {
			// const today = new Date();
			const query = {
				userId: order.user.id,
				orderOriginId: order._id.toString(),
				// "dates.dateOrderNext": { "$lte": today },
				// "dates.dateEnd": { "$gte": today },
				status: "inactive"
			};
			this.logger.info("orders.getOrderSubscriptionsToProcess - query", query);

			return ctx.call("subscriptions.find", {
				"query": query
			})
				.then(found => {
					this.logger.info("orders.getOrderSubscriptionsToProcess - subscriptions.find FOUND:", found);

					// check if found any inactive subscriptions
					if (found && found.length>0) {
						// those found are NOT confirmed - remaing are the ones already working in this order
						// return array of those that need to be confirmed
						return found;
					}
					return null;
				})
				.catch(error => {
					this.logger.error("orders.getOrderSubscriptionsToProcess - error:", error);
				});
		},



		/**
		 * SUBSCRIPTION FLOW - 3.3 (API->BE)
		 * 
		 * @param {Object} ctx 
		 * @param {Object} subscription - related subscription object 
		 * 
		 * @returns {Object} updated subscription
		 */
		subscriptionCancelled(ctx, subscription) {
			subscription.status = "canceled";
			subscription.dates["dateStopped"] = new Date();
			subscription.history.push(
				{
					action: "canceled",
					type: "user",
					date: new Date(),
					data: {
						webhookResponse: JSON.stringify(ctx.params.data),
						relatedOrder: null
					}
				}
			);

			subscription.id = subscription._id.toString();
			delete subscription._id;

			return ctx.call("subscriptions.save", {
				entity: subscription
			})
				.then(updated => {
					this.logger.info("subscriptions to webhook cancel - subscriptions.save:", updated);
					let result = { 
						success: false, 
						url: null, 
						message: "subscription canceled", 
						data: {
							subscription: updated
						}
					};
					delete result.data.subscription.history;
					return result;
				})
				.catch(error => {
					this.logger.error("subscriptions to webhook cancel - subscriptions.save error: ", error);
					return null;
				});
		},



		/**
		 * Webhook logic - step #2.2
		 * Perform actions after subscription payment received
		 * 
		 * @param {Object} ctx 
		 * @param {Object} subscription 
		 */
		subscriptionPaymentReceived(ctx, subscription) {
			let self = this;
			let agreement = null;
			let type = "webhook";
			if (ctx.params.data && ctx.params.data.type) {
				type = ctx.params.data.type;
			}
			
			// get related original order
			let queryOrders = {
				"query": {
					"_id": self.fixStringToId(subscription.orderOriginId),
				}
			};
			// only administrator can edit subscription of any other user
			if (ctx.meta && ctx.meta.user && ctx.meta.user.type && ctx.meta.user.type!="admin") {
				queryOrders.query["user.id"] = ctx.meta.user._id.toString();
			}
			return ctx.call("orders.find", queryOrders)
				.then(orders => {
					if ( orders && orders.length>0 && orders[0] ) {
						let order = orders[0];

						// if stripe, fill with stripe data
						if ( order.data.paymentData.codename && 
						order.data.paymentData.codename.indexOf("online_stripe") > -1 ) {
							agreement = subscription.data.order.data.paymentData.lastResponseResult;
							agreement[agreement.length - 1];
						} else if ( subscription.data && subscription.data.agreement && subscription.data.agreement != null ) {
							agreement = subscription.data.agreement;
						}

						/**
						 * check out what payment or this subscription it is:
						 * 1st payment of this subcription - original order
						 * 2nd & later payment of this subsc - create new
						 * */
						let paymentCount = 0;
						self.logger.info("orders.subscriptionPaymentReceived() - subscription.history", subscription.history );
						if (subscription.history && subscription.history.length>0) {
							subscription.history.forEach(h => {
								self.logger.info("orders.subscriptionPaymentReceived() - h.action", h.action );
								if (h && h.action=="payment") {
									paymentCount++;
									self.logger.info("orders.subscriptionPaymentReceived() - paymentCount++" );
								}
							});
						}

						// add message into history
						let historyRecord = {
							action: "payment",
							type: type,
							date: new Date(),
							data: {
								message: ctx.params.data,
								relatedOrder: null
							}
						};
						subscription.history.push(historyRecord);

						// DECISION MAKING - if first payment for this subscription
						// update original order, else create new one
						self.logger.info("orders.subscriptionPaymentReceived() - paymentCount", paymentCount );
						if (paymentCount<=0) { 
							// original order - recalculated based on paid amount
							self.logger.info("orders.subscriptionPaymentReceived() - original order" );
							order = self.updatePaidOrderSubscriptionData(order, agreement);
							return this.afterSubscriptionPaidOrderActions(
								ctx, 
								order, 
								subscription
							);
						} else {
							// create order for >1st subscription
							return ctx.call("subscriptions.createPaidSubscriptionOrder", {subscription: subscription} )
								.then(result => {
									self.logger.info("orders.subscriptionPaymentReceived() - new order" );
									return this.afterSubscriptionPaidOrderActions(
										ctx, 
										result.order, 
										result.subscription
									);
								})
								.catch(error => {
									self.logger.error("payments.paypal1.mixin.subscriptionPaymentReceived - subscriptions.createPaidSubscriptionOrder - paypal execute error: ", JSON.stringify(error));
								});
						}

					}
				});

		},


		/**
		 * Perform order action after related subscription was paid
		 * 
		 * @param {Object} ctx 
		 * @param {Object} order 
		 * @param {Object} subscription 
		 * @param {Object} agreement 
		 */
		afterSubscriptionPaidOrderActions(ctx, order, subscription) {
			let self = this;
			let urlPathPrefix = "/";
			if ( process.env.NODE_ENV=="development" ) {
				urlPathPrefix = "http://localhost:8080/";
			}

			return self.generateInvoice(order, ctx)
				.then(invoice => {
					// set invoices into order
					order.invoice["html"] = invoice.html;
					order.invoice["path"] = invoice.path;
					// set related subscription product and data as paid
					if (order.items && order.items.length>0) {
						for (let i=0; i<order.items.length; i++) {
							if (order.items[i].type==="subscription" && 
							order.items[i]._id.toString()===subscription.data.product._id.toString()) {
								order.items[i]["paid"] = true;
							}
						}
					}
					if (order.data && order.data.subscription && 
					order.data.subscription.ids && 
					order.data.subscription.ids.length>0) {
						for (let i=0; i<order.data.subscription.ids.length; i++) {
							if (order.data.subscription.ids[i].subscription==subscription._id.toString()) {
								order.data.subscription.ids[i]["paid"] = new Date();
							}
						}
					}
					// updating order after all set
					return self.adapter.updateById(order._id, self.prepareForUpdate(order))
						.then(orderUpdated => {
							self.entityChanged("updated", orderUpdated, ctx);
							self.logger.info("orders.afterSubscriptionPaidOrderActions() - invoice generated, order updated", { success: true, response: "paid", redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id.toString() } );
							if ( order.prices.priceTotalToPay==0 && typeof self.afterPaidActions !== "undefined" ) {
								self.afterPaidActions(order, ctx); // custom actions
							}
							return self.updateSubscriptionAfterPaid(ctx, subscription)
								.then(updatedSubscr => {
									self.logger.info(" - updatedSubscr", updatedSubscr );
									// send email to customer and admin
									self.sendEmailPaymentReceivedSubscription(ctx, updatedSubscr);
									// redirect to original Order to make user accept all ordered subscriptions
									return { success: true, response: "paid", redirect: urlPathPrefix+order.lang.code+"/user/orders/"+order._id.toString() };
								});
						});
				});
		},


		/**
		 * Update subscription making it active and adding history
		 * 
		 * @param {*} ctx 
		 * @param {*} subscription 
		 * 
		 * @returns {Object} updated subscription
		 */
		updateSubscriptionAfterPaid(ctx, subscription) {
			// always use dateOrderNext if available
			// in the begining it's same as dateStart, later it's updated
			let dateToStart = subscription.dates.dateOrderNext;
			if (!dateToStart || dateToStart===null) {
				subscription.dates.dateStart;
			}
			// update date of subscription end only if it is not set yet
			let withDateEnd = true;
			if (subscription.dates.dateEnd && subscription.dates.dateEnd!==null) {
				withDateEnd = false;
			}
			return ctx.call("subscriptions.calculateDates", {
				period: subscription.period,
				duration: subscription.duration,
				dateStart: dateToStart.toISOString(),
				cycles: subscription.cycles,
				withDateEnd: withDateEnd
			})
				.then(resultDates => {
					this.logger.info("payments.paypal1.mixin - updateSubscriptionAfterPaid resultDates & payment codename && cycles", resultDates, subscription.data.order.data.paymentData.codename, subscription.cycles);
					// if stripe subscription
					if ( 
						subscription.data.order.data.paymentData.codename === "online_stripe" && 
						this.countSubscriptionPaidCycles(subscription.history).counter >= subscription.cycles
					) {
						let historyRecord = {
							action: "stopped",
							type: "system",
							date: new Date(),
							data: {
								relatedOrder: null,
								relatedData: null
							}
						};
						subscription.history.push(historyRecord);

						subscription.status = "stopped";
						subscription.dates.dateEnd = new Date();
					} else {
						let historyRecord = {
							action: "calculateDateOrderNext",
							type: "user",
							date: new Date(),
							data: {
								relatedOrder: null,
								relatedData: resultDates
							}
						};
						subscription.history.push(historyRecord);
	
						subscription.status = "active";
						subscription.dates.dateOrderNext = resultDates.dateOrderNext;
						if (resultDates.dateEnd && resultDates.dateEnd!==null) {
							subscription.dates.dateEnd = resultDates.dateEnd;
						}
					}
					subscription.id = subscription._id.toString();
					
					delete subscription._id;

					if (resultDates && resultDates.dateOrderNext && resultDates.dateEnd) {
					// update subscription
						return ctx.call("subscriptions.save", {
							entity: subscription
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
						this.logger.error("payments.paypal1.mixin - updateSubscriptionAfterPaid resultDates wrong: ", resultDates);
						return null;
					}
				})
				.catch(error => {
					this.logger.error("payments.paypal1.mixin - updateSubscriptionAfterPaid calculateDates error: ", error);
					return null;
				});
		},


		/**
		 * 
		 * @param {Object} ctx 
		 * @param {Object} subscription 
		 */
		sendEmailPaymentReceivedSubscription(ctx, subscription) {
			// configuring email message
			let emailSetup = {
				settings: {
					to: [subscription.data.order.user.email, "support@stretchshop.app"]
				},
				functionSettings: {
					language: subscription.data.order.user.settings.language,
					subject: process.env.SITE_NAME +" - Payment Received"
				},
				template: "order/payment/paymentreceived",
				data: {
					webname: ctx.meta.siteSettings.name,
					username: subscription.data.order.user.username,
					email: subscription.data.order.user.email, 
					support_email: ctx.meta.siteSettings.supportEmail
				}
			};
			this.logger.info("subscription.methods sendEmailPaymentReceivedSubscription() - preparing to send");
			// sending email
			ctx.call("users.sendEmail", emailSetup)
				.then(json => {
					this.logger.info("subscription.methods sendEmailPaymentReceivedSubscription() - email sent:", json);
				})
				.catch(error => {
					this.logger.error("subscription.methods sendEmailPaymentReceivedSubscription() - error:", error);
				});
		}, 


		/**
		 * 
		 * @param {Array} history - array of history records
		 * @returns 
		 */
		countSubscriptionPaidCycles(history) {
			let paymentsCounter = 0;
			let paymentsTotal = 0;
			if (history && history.length > 0) {
				history.forEach(h => {
					if (h.action && h.action === "payment" && h.data.message) {
						let paymentData = JSON.parse(h.data.message);
						paymentsCounter++;
						if (paymentData && paymentData.data.object && paymentData.data.object.total) {
							paymentsTotal += paymentData.data.object.total;
						}
					}
				});
			}

			this.logger.info("subscription.methods countSubscriptionPaidCycles() result:", {
				counter: paymentsCounter,
				total: paymentsTotal
			});

			return {
				counter: paymentsCounter,
				total: paymentsTotal
			};
		},



	}
};
