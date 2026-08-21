"use strict";

require("dotenv").config();
const passGenerator = require("generate-password");
const fetch = require("cross-fetch");
const jwt = require("jsonwebtoken");
const handlebars = require("handlebars");
const { writeFileSync, ensureDir, createWriteStream } = require("fs-extra");
const pathResolve = require("path").resolve;
const SettingsMixin = require("../../../mixins/settings.mixin");
const PdfPrintMixin = require("../../../mixins/pdfprint.mixin");
const { subscriptionPaymentStatuses } = require("../constants/subscription.constants");
const { productStatuses } = require("../constants/product.constants");
const { orderStatuses } = require("../constants/order.constants");
const { update } = require("lodash");

const calcExcludedTypes = ["subscription"];

module.exports = {
	methods: {
		orderPaymentReceived(ctx, order, paymentData, paymentProvider, action) {
			// TODO - HERE check if order is fully paid or just partially
			if (paymentProvider && paymentProvider !== 'admin') {
				this.logger.info("orders.orderPaymentReceived() - payment received:", { order: order._id, provider: paymentProvider, action: action, paymentData: paymentData });
				const updatedOrder = this.updateOrderPaymentState(ctx, order, paymentData, paymentProvider, action);
				// get order payment status after payment update
				const status = this.getOrderPaymentStatus(updatedOrder);
				if (status.order.status == "paid") {
					this.updatePaidOrderData(updatedOrder, paymentData);
				}
			}
			if (order.dates?.emailPaidSent && order.invoice?.id) {
				this.logger.info("orders.orderPaymentReceived() - skip invoice/email, already sent", { orderId: order._id });
				return this.adapter.updateById(order._id, this.prepareForUpdate(order))
					.then(orderUpdated => {
						this.entityChanged("updated", orderUpdated, ctx);
						return orderUpdated.invoice;
					});
			}
			// order should already have updated amount paid in 
			return this.generateInvoice(order, ctx)
				.then(invoice => {
					order.invoice["html"] = invoice.html;
					order.invoice["path"] = invoice.path;
					return this.adapter.updateById(order._id, this.prepareForUpdate(order))
						.then(orderUpdated => {
							this.entityChanged("updated", orderUpdated, ctx);
							return orderUpdated.invoice;
						});
				});
		},


		updateOrderPaymentState(ctx, order, paymentData, paymentProvider, action) {
			// get payment data and compare it with order data
			// according to it, update order status
			const expectedAmounts = {
				"products": 0,
				"subscriptions": {}
			};
			if (order?.items?.length > 0) {
				order.items.forEach(item => {
					const itemId = item._id ? item._id : item.id;
					if (item.type === "subscription") {
						expectedAmounts.subscriptions[itemId] = {
							amount: item.price,
							status: order?.data
						};
					} else {
						expectedAmounts.products += item.price;
					}
				});
			}
			this.logger.info("orders.updateOrderPaymentState() - expectedAmounts:", expectedAmounts);

			// ---- STRIPE SPECIFIC
			// by default we consider it's payment for "products"
			// that means all products in the order except subscriptions
			if (action === "subscription") {
				// get subscription price and compare it to order price
				const expectedAmount = expectedAmounts.subscriptions[paymentData?.metadata?.productId]?.amount;
				this.logger.info("orders.updateOrderPaymentState() - paymentData.amount:", paymentData.amount, " expectedAmount:", expectedAmount);
				if (
					((expectedAmount * 10) < paymentData.amount && paymentData.amount/100 >= expectedAmount) || 
					((expectedAmount * 10) > paymentData.amount && paymentData.amount >= expectedAmount) // in case stripe sends amount without decimals
				) {
					this.updateOrderStatePaidStripe(ctx, order, paymentData, action);
				} else {
					this.logger.warn("orders.updateOrderPaymentState() - payment amount does not fit order amount", { 
						provider: paymentProvider,
						expected: expectedAmounts.subscriptions[paymentData?.metadata?.subscriptionId], 
						actual: paymentData.amount,
						order: order._id
					});
				}
			} else {
				// get product price and compare it to order price
				// if price fits, update order status
				if ( 
					((expectedAmounts.products * 10) < paymentData.amount && paymentData.amount/100 >= expectedAmounts.products) ||  
					((expectedAmounts.products * 10) > paymentData.amount && paymentData.amount >= expectedAmounts.products) ) { // in case stripe sends amount without decimals
					this.updateOrderStatePaidStripe(ctx, order, paymentData, action);
				} else {
					this.logger.warn("orders.updateOrderPaymentState() - payment amount does not fit order amount", { 
						provider: paymentProvider,
						expected: expectedAmounts.products, 
						actual: paymentData.amount,
						order: order._id
					});
				}
			}

			return order;
		},


		getPaymentResultDedupeKey(element) {
			if (!element || typeof element !== "object") {
				return null;
			}
			const object = element.originalData?.data?.object || element;
			return object.payment_intent || element.payment_intent || element.id || null;
		},


		extractPaymentAmount(element) {
			if (!element || typeof element !== "object") {
				return 0;
			}
			if (element.status !== "succeeded") {
				return 0;
			}
			if (element.amount_received != null) {
				return parseFloat(element.amount_received) / 100;
			}
			if (typeof element.amount === "number") {
				return parseFloat(element.amount) || 0;
			}
			return 0;
		},


		calculatePaidAmountTotal(paymentData) {
			let total = 0;
			const seen = new Set();
			for (const element of paymentData?.lastResponseResult || []) {
				const key = this.getPaymentResultDedupeKey(element);
				if (key) {
					if (seen.has(key)) {
						continue;
					}
					seen.add(key);
				}
				total += this.extractPaymentAmount(element);
			}
			return total;
		},


		/**
		 * 
		 * @param {Object} order 
		 * @param {Object} response 
		 * 
		 * @returns {Object} order updated
		 */
		updatePaidOrderData(order, paymentData) {
			order.dates.datePaid = new Date();
			order.status = "paid";
			order.data.paymentData.lastStatus = paymentData.status;
			order.data.paymentData.lastDate = new Date();
			if ( !order.data.paymentData.lastResponseResult ) {
				order.data.paymentData.lastResponseResult = [];
			}
			const paymentId = paymentData?.id;
			const alreadyLogged = paymentId && order.data.paymentData.lastResponseResult.some(
				(element) => element && element.id === paymentId
			);
			if (paymentData && !alreadyLogged) {
				order.data.paymentData.lastResponseResult.push(paymentData);
			}
			order.data.paymentData.paidAmountTotal = this.calculatePaidAmountTotal(order.data.paymentData);
			if (!order.data.paymentData.paidAmountTotal && paymentData?.status === "succeeded") {
				order.data.paymentData.paidAmountTotal = parseFloat(
					paymentData?.amount || order.prices?.priceTotal || 0
				) || 0;
			}
			order.prices.priceTotalToPay = order.prices.priceTotal - order.data.paymentData.paidAmountTotal;

			return order;
		},


		/**
		 * Get order summary status of payment from its products and subscriptions
		 * 
		 * @param {Object} order
		 * 
		 * @returns {string} status
		 */
		getOrderPaymentStatus(order) {
			/*
			 * Set default status: 
			 * saved = stored in database, not created in payment gateway, not paid
			 * prepared = created in payment gateway, not paid
			 * running = paid in payment gateway,
			 * completed = paid in payment gateway, all subscriptions paid, ended by desired date or by user
			 * failed = any error
			 */
			const paymentStatuses = subscriptionPaymentStatuses;
			let orderPaymentStatus = 0; // 0: saved -> 1: prepared -> 2: running

			// get status of products
			let productsStatus = null; // saved as starting status => null means no products
			const productPaymentId = order?.data?.paymentData?.paymentRequestId || order?.data?.paymentData?.supplier?.id;
			console.log("id ------- >: ", productPaymentId);
		  if (productPaymentId && productPaymentId.toString().trim() !== "" && order?.items?.length) {
				productsStatus = 0;
				if (order?.data?.paymentData?.supplier?.status === "paid" && order?.data?.paymentData?.supplier?.paid) {
					productsStatus = 2;
				}
			}

			// get status of subscriptions
			let subscriptionsStatus = null; // saved as starting status
			let countRemainingSubscriptions2pay = 0;
			let countRemainingSubscriptions2prepare = 0;
			let nextSubscription = null; // next subscription to use
			let nextSubscriptionToPay = null;
			let nextSubscriptionToPrepare = null;
			if (order?.data?.subscription?.ids) {
				// find worst subscription state
				const statuses = [];
			  for (const idItem of order.data.subscription.ids) {
					if (idItem?.subscription && idItem.subscription.toString().trim() !== "") {
						let thisStatus = 0;
						const supplierStatus = idItem.supplier?.status || idItem.status;
						if (supplierStatus === "prepared") {
							thisStatus = 1;
							countRemainingSubscriptions2pay++;
							if (!nextSubscription) {
								nextSubscription = idItem;
							}
							if (!nextSubscriptionToPay) {
								nextSubscriptionToPay = idItem;
							}
						} else if (supplierStatus === "trialing") {
							thisStatus = 2;
						} else if ( supplierStatus === "active" ) {
							thisStatus = 3;
						} else if (supplierStatus === "completed") {
							thisStatus = 4;
						} else if (
							supplierStatus.trim() !== "" &&
							["paused", "canceled", "failed"].includes(supplierStatus)
						) {
							thisStatus = 4;
						} else { // is only in stretchshop DB
							countRemainingSubscriptions2prepare++;
							countRemainingSubscriptions2pay++;
							if (!nextSubscription) {
								nextSubscription = idItem;
							}
							if (!nextSubscriptionToPrepare) {
								nextSubscriptionToPrepare = idItem;
							}
						}
						statuses.push(thisStatus);
					}
			  }
				subscriptionsStatus = Math.min(...statuses);
			}

			// calculate status for the whole order
			let orderTempStatus = 0;
			if (productPaymentId && !order?.data?.subscription?.ids) { // only products
				orderTempStatus = productsStatus || 0;
			} else if (order?.data?.subscription?.ids.length > 0) { // only subscriptions
				orderTempStatus = subscriptionsStatus || 0;
			} else { // get minimum of both, if both are null, set to 0
				orderTempStatus = Math.min(productsStatus, subscriptionsStatus) || 0;
			}
			// set status of order
			if (orderTempStatus >=0 && orderTempStatus <= 1) {
				orderPaymentStatus = orderTempStatus; // saved or prepared
			} else if (orderTempStatus >= 2 && orderTempStatus <= 3) {
				orderPaymentStatus = 2; // paid
			} else if (orderTempStatus === 4) {
				orderPaymentStatus = 3; // finished
			} else if (productsStatus === 5 || [5, 6].includes(subscriptionsStatus)) {
				orderPaymentStatus = 4; // stopped
			} else {
				orderPaymentStatus = 5; // failed
			}

			return {
				order: {
					index: orderPaymentStatus,
					status: orderStatuses[orderPaymentStatus] || null
				},
				products: {
					count: order?.items?.filter((i) => i.type !== "subscription").length || 0,
					index: productsStatus,
					status: productStatuses[productsStatus] || (order?.items?.length ? "saved" : null)
				},
				subscriptions: {
					index: subscriptionsStatus,
					status: subscriptionPaymentStatuses[subscriptionsStatus] || null,
					counters: {
						total: order?.data?.subscription?.ids?.length,
						remaining: {
							toPay: countRemainingSubscriptions2pay,
							toPrepare: countRemainingSubscriptions2prepare
						}
					},
					next: {
						use: nextSubscription, // next subscription to use
						toPay: nextSubscriptionToPay,
						toPrepare: nextSubscriptionToPrepare
					}
				}
			};
		},


		/**
		 * Update order state according to payment provider and received data
		 * 
		 * @param {Object} ctx - context
		 * @param {Object} order
		 * @param {Object} updateData
		 * @param {string} provider
		 */
		updateOrderState(ctx, updateData, provider, action) {
			let self = this;
			this.logger.info("updateOrderState #1: ", updateData, provider, action);

			if (updateData && provider) {
				this.logger.info("updateOrderState #2: ", provider, provider === "stripe");
			
				const filter = { query: {
					_id: self.fixStringToId(updateData.object.metadata.orderId),
				}, limit: 1 };

				ctx.call("orders.find", filter)
					.then(foundOrder => {
						if (foundOrder) {
							foundOrder = foundOrder[0];
							if (!foundOrder.id) {
								foundOrder.id = foundOrder._id;
							}
							this.logger.info("WEBHOOK charge.succeeded - order foundOrder:", foundOrder);
							// update order with payment data
							if (foundOrder.data?.paymentData?.lastResponseResult) {
								foundOrder.data.paymentData.lastResponseResult.push(updateData);
							} else {
								if (!foundOrder.data.paymentData) {
									foundOrder.data.paymentData = {
										lastResponseResult: []
									};
								}
								foundOrder.data.paymentData.lastResponseResult = [updateData];
							}

							// update provider specific information
							if (provider === "stripe") {
								this.logger.info("updateOrderState #3 Stripe");
								foundOrder = this.updateOrderStatePaidStripe(ctx, foundOrder, updateData, action);
							}
							
							// save updated order
							return ctx.call("orders.updateOrder", { order: foundOrder })
							.then(updatedOrder => {
								this.logger.info("WEBHOOK charge.succeeded - order updated:", updatedOrder);
							});
						}
					})
					.catch(error => {
						self.logger.error("WEBHOOK charge.succeeded find error", error);
					});
			}
		}

	}
};
