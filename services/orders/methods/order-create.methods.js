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
		createEmptyOrder(ctx) {
			let order = {
				"externalId": null,
				"externalCode": null,
				"status": "cart",
				"user": {
					"id": (ctx.meta.user && ctx.meta.user._id) ? ctx.meta.user._id : null,
					"externalId": (ctx.meta.user && ctx.meta.user.externalId) ? ctx.meta.user.externalId : null,
					"username": (ctx.meta.user && ctx.meta.user.username) ? ctx.meta.user.username : null,
					"email": (ctx.meta.user && ctx.meta.user.email) ? ctx.meta.user.email : null,
				},
				"ip": ctx.meta.remoteAddress,
				"dates": {
					"dateCreated": new Date(),
					"dateChanged": null,
					"dateSent": null,
					"datePaid": null,
					"dateExpeded": null,
					"userConfirmation": null
				},
				"lang": this.getValueByCode(ctx.meta.localsDefault.langs, ctx.meta.localsDefault.lang),
				"country": this.getValueByCode(ctx.meta.localsDefault.countries, ctx.meta.localsDefault.country),
				"addresses": {
					"invoiceAddress": null,
					"deliveryAddress": null
				},
				"prices": {
					"currency": this.getValueByCode(ctx.meta.localsDefault.currencies, ctx.meta.localsDefault.currency),
					"taxData": SettingsMixin.getSiteSettings('business')?.taxData?.global,
					"priceTotal": null,
					"priceTotalNoTax": null,
					"priceItems": null,
					"priceItemsNoTax": null,
					"priceTaxTotal": null,
					"priceDelivery": null,
					"pricePayment": null
				},
				"items": [],
				"data": {
					"deliveryData": null,
					"paymentData": null,
					"couponData": null,
				},
				"notes": {
					"customerNote": null,
					"sellerNote": null,
				}
			};

			return order;
		},



		/**
		 * Entrance action to get progress of active user order
		 * 
		 * @param {Object} ctx 
		 * @param {Object} cart 
		 * @param {Object} order 
		 * @returns 
		 */
		getOrderProgressAction(ctx, cart, order) {
			let updateResult = this.settings.emptyUpdateResult;

			if (order && order.status == "cart") {
				// update order items
				if (cart.items) {
					order.items = cart.items;
				}
				// manage user if not exists
				this.settings.orderErrors.userErrors = [];
				this.logger.info("order.progress - ctx.params.orderParams: ", ctx.params.orderParams);
				return this.manageUser(ctx)
					.then(ctx => {  // promise for user
						// run processOrder(orderParams) to proces user input and
						// update order data according to it
						this.settings.orderTemp = order;
						updateResult = this.processOrder(ctx);
						this.logger.info("order.progress - updateResult: ", updateResult);
						this.getAvailableOrderSettings();
						this.logger.info("order.progress - cart order found updated (COFU):", updateResult, "\n\n");
						// if no params (eg. only refreshed), return original order
						if (!ctx.params.orderParams || Object.keys(ctx.params.orderParams).length < 1) {
							let orderProcessedResult = {};
							orderProcessedResult.order = order;
							orderProcessedResult.result = updateResult;
							if (!updateResult.success) {
								orderProcessedResult.errors = this.settings.orderErrors;
							}
							return orderProcessedResult;
						}
						// if order check returns success, order can be saved
						// otherwise remains in cart status
						if (updateResult.success) {
							this.settings.orderTemp.status = "saved";
						}
						// order ready to save and send - update order data in related variables
						order = this.settings.orderTemp;
						this.logger.info("order.progress - cart: ", cart);
						return ctx.call("cart.updateMyCart", { cartNew: { order: this.idToString(order._id) } })
							.then(() => { //(cart2)
								return this.adapter.updateById(this.idToString(order._id), this.prepareForUpdate(order))
									.then(orderUpdated => {
										this.entityChanged("updated", orderUpdated, ctx);
										// if order was processed with errors, add them to result for frontend
										let orderProcessedResult = {};
										orderProcessedResult.order = orderUpdated;
										orderProcessedResult.result = updateResult;
										if (!updateResult.success) {
											orderProcessedResult.errors = this.settings.orderErrors;
										} else {
											// order was processed without errors, run afterSaveActions
											orderProcessedResult = this.orderAfterSaveActions(ctx, orderProcessedResult);
										}
										return orderProcessedResult;
									});
							});
						// order updated
					})
					.catch(ctxWithUserError => {
						this.logger.error("user error: ", ctxWithUserError);
						return null;
					});

			} else {
				// cart has order id, but order with 'cart' status not found
				this.logger.info("order.progress - orderId from cart not found");

				if (
					(
						!this.settings.orderTemp.user ||
						(typeof this.settings.orderTemp.user.id === "undefined" || this.settings.orderTemp.user.id === null || this.settings.orderTemp.user.id == "")
					) &&
					(ctx.params.orderParams.addresses && ctx.params.orderParams.addresses.invoiceAddress && ctx.params.orderParams.addresses.invoiceAddress.email)
				) {
					// create user if not found and return him in ctx
					return this.manageUser(ctx)
						.then(ctxWithUser => {  // promise #2
							return this.createOrderAction(cart, ctxWithUser, this.adapter);
						})
						.catch(ctxWithUserError => {
							this.logger.error("user error: ", ctxWithUserError);
							return null;
						});
				} else { // default option, creates new order if none found
					return this.createOrderAction(cart, ctx, this.adapter);
				}
			}
		},



		createOrderAction(cart, ctx, adapter) {
			let updateResult = this.settings.emptyUpdateResult;
			let order = this.createEmptyOrder(ctx);
			// if user lang available, set it
			if (ctx.meta.user && ctx.meta.user.settings && ctx.meta.user.settings.language) {
				order.lang = this.getValueByCode(ctx.meta.localsDefault.langs, ctx.meta.user.settings.language);
			}
			// update order items
			if (cart.items) {
				order.items = cart.items;
			}
			// run processOrder(orderParams) to update order data
			this.settings.orderTemp = order;
			this.getAvailableOrderSettings();
			if (ctx.params.orderParams) {
				updateResult = this.processOrder(ctx);
				this.logger.info("orders.createOrderAction() - updateResult: ", updateResult);
				if (!updateResult.success) {
					this.logger.error("orders.createOrderAction() - Order !updateResult.success: ", this.settings.orderErrors);
				}
			}
			// update order data in related variables
			order = this.settings.orderTemp;
			this.logger.info("orders.createOrderAction() - order before save: ", order);
			cart.order = this.idToString(order._id);
			// save new order
			return adapter.insert(order)
				.then(orderNew => {
					this.entityChanged("updated", orderNew, ctx);
					cart.order = this.idToString(orderNew._id); // order id is not saved to cart
					this.logger.info("orders.createOrderAction() - order after save: ", orderNew);
					return ctx.call("cart.updateMyCart", { "cartNew": cart })
						.then(() => { //(cart2)
							let orderProcessedResult = {};
							orderProcessedResult.order = orderNew;
							orderProcessedResult.result = updateResult;
							if (!updateResult.success) {
								orderProcessedResult.errors = this.settings.orderErrors;
							}
							return orderProcessedResult;
						});
				});
		},


		/**
		 * Main service to call on order updates from
		 * Returns these states:
		 * 0: missing cart items
		 * 1: missing user data
		 * 2: missing order data
		 * 3: order ready but not confirmed
		 * 4: order confirmed, ready to save with "saved" status
		 */
		processOrder(ctx) {
			if (this.settings.orderTemp) {
				// update order params
				if (typeof ctx.params.orderParams !== "undefined" && ctx.params.orderParams) {
					this.settings.orderTemp = this.updateBySentParams(this.settings.orderTemp, ctx.params.orderParams);
					if (ctx.meta.userNew && ctx.meta.userNew === true) {
						this.logger.info("orders.processOrder() - setting new user data");
						this.settings.orderTemp.user.id = ctx.params.orderParams.user.id;
						this.settings.orderTemp.user.email = ctx.params.orderParams.user.email;
						this.settings.orderTemp.user.token = ctx.params.orderParams.user.token;
					}
				}
				this.settings.orderTemp.dates.dateChanged = new Date();
				this.logger.info("orders.processOrder() - orderTemp updated by params: ", this.settings.orderTemp);

				if (this.checkCartItems()) {
					if (this.checkUserData(ctx)) { // check if (invoice address) is set and valid
						if (this.checkOrderData()) { // check if order data (delivery, payment) are set and done
							if (this.checkConfirmation()) {
								return { "id": 4, "name": "confirmed", "success": true };
							} else {
								return { "id": 3, "name": "missing confirmation", "success": false };
							}
						} else {
							return { "id": 2, "name": "missing order data", "success": false };
						}
					} else {
						return { "id": 1, "name": "missing user data", "success": false };
					}
				} else {
					return { "id": 0, "name": "missing cart items", "success": false };
				}
			}

			return false;
		},


		/**
		 * Updates order parameters using parameters from request
		 * according to template created with createEmptyOrder().
		 * From level 2 it enables to create objects by request.
		 */
		updateBySentParams(orderParams, updateParams, level) {
			level = (typeof level !== "undefined") ? level : 0;
			let self = this;
			let level1protectedProps = ["user", "id"];
			// loop updateParams and check, if they exist in orderParams
			Object.keys(updateParams).forEach(function (key) {
				if (!(level == 0 && level1protectedProps.includes(key))) {
					if (((orderParams && Object.prototype.hasOwnProperty.call(orderParams, key)) || level >= 2)) { // order has this property
						// update it
						if (orderParams === null) {
							orderParams = {};
						}
						if (typeof updateParams[key] === "object") {
							if (!orderParams[key] || orderParams[key] === null) {
								orderParams[key] = {};
							}
							if (updateParams[key] !== null) {
								orderParams[key] = self.updateBySentParams(orderParams[key], updateParams[key], level + 1);
							} else {
								orderParams[key] = null;
							}
						} else {
							orderParams[key] = updateParams[key];
						}
					}
				}
			});

			return orderParams;
		},


		/**
		 * Check if there are cart items set
		 */
		checkCartItems() {
			this.settings.orderErrors.itemErrors = [];
			if (this.settings.orderTemp && this.settings.orderTemp.items) {
				if (this.settings.orderTemp.items.length > 0) {
					return true;
				} else {
					this.settings.orderErrors.itemErrors.push({ "value": "Cart items", "desc": "no items" });
				}
			} else {
				this.settings.orderErrors.itemErrors.push({ "value": "Cart items", "desc": "not set" });
			}
			return false;
		},


		/**
		 * Check if all items to register user and make order on his name are set
		 */
	}
};
