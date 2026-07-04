"use strict";

require("dotenv").config();
const pathResolve = require("path").resolve;
const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("@stretchshop/moleculer-cron");
const { createReadStream } = require("fs-extra");

// global mixins
const DbService = require("../../mixins/db.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");
const priceLevels = require("../../mixins/price.levels.mixin");
const FileHelpers = require("../../mixins/file.helpers.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const SettingsMixin = require("../../mixins/settings.mixin");
const { getRequiredSecret } = require("../../mixins/env.helpers");

// methods
const OrdersMethodsCore = require("./methods/core.methods");
const OrdersMethodsHelpers = require("./methods/helpers.methods");
const OrdersMethodsSubscription = require("./methods/subscription.methods");
// service specific mixins
const paymentWebhook = require("./mixins/payments.webhook.mixin");
const paymentsStripe = require("./mixins/payments.stripe.mixin");
const OrderActionsProgress = require("./mixins/order-actions.progress.mixin");
const OrderActionsLifecycle = require("./mixins/order-actions.lifecycle.mixin");
const OrderActionsPayment = require("./mixins/order-actions.payment.mixin");
const OrderActionsFulfillment = require("./mixins/order-actions.fulfillment.mixin");


// settings
const sppf = require("../../mixins/subproject.helper");
const { ReadStream } = require("fs");
let resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../resources");



module.exports = {
	name: "orders",
	mixins: [
		HelpersMixin,
		priceLevels,
		FileHelpers,
		// methods
		OrdersMethodsCore,
		OrdersMethodsHelpers,
		OrdersMethodsSubscription,
		// mixins
		paymentWebhook,
		paymentsStripe,
		OrderActionsProgress,
		OrderActionsLifecycle,
		OrderActionsPayment,
		OrderActionsFulfillment,
		// events
		CacheCleanerMixin([
			"cache.clean.orders"
		]),
		Cron,
		DbService("orders"), // has to be the last to not override actions
	],

	/**
	 * Default settings
	 */
	settings: {
		cronJobs: [{
			name: "OrdersCleaner",
			cronTime: "10 1 * * *",
			onTick: function() {

				this.logger.info("Starting to Clean up the Orders");

				this.broker.call("orders.cleanOrders")
					.then((data) => {
						this.logger.info("Orders Cleaned up", data);
					});
			}
		}],

		/** Secret for JWT */
		JWT_SECRET: getRequiredSecret("JWT_SECRET", "jwt-stretchshop-secret"),

		/** Public fields */
		fields: [
			"_id", "externalId", "externalCode",
			"status", "user", "ip",
			"dates",
			"lang", "country", "addresses",
			"prices", "items",
			"data",
			"notes",
			"settings",
			"invoice"
		],

		/** Validator schema for entity */
		entityValidator: {

			externalId: { type: "string", min: 3 },
			externalCode: { type: "string", min: 3 },
			status: { type: "string", min: 3 },
			user: {
				type: "object", props: {
					id: { type: "string", min: 3 },
					externalId: { type: "string", min: 3 },
					username: { type: "string", min: 2 },
					email: { type: "email" },
				}
			},
			ip: { type: "string", min: 4 },
			dates: {
				type: "object", props: {
					dateCreated: { type: "date" },
					dateChanged: { type: "date" },
					dateSent: { type: "date" },
					datePaid: { type: "date" },
					dateExpeded: { type: "date" },
					emailSent: { type: "date" }
				}
			},
			lang: { type: "string", min: 2 },
			country: { type: "string", min: 2 },
			addresses: {
				type: "object", props: {
					invoiceAddress: { type: "object" },
					deliveryAddress: { type: "object" },
				}
			},
			prices: {
				type: "object", props: {
					currency: { type: "string" },
					priceTotal: { type: "number" },
					priceTotalNoTax: { type: "number" },
					priceGoods: { type: "number" },
					priceGoodsNoTax: { type: "number" },
					priceDelivery: { type: "number" },
					pricePayment: { type: "number" }
				}
			},
			items: { type: "array", items: { type: "object", props:
				{
					id: { type: "string", min: 2 },
					externalId: { type: "string", min: 1 },
					orderCode: { type: "string", min: 1 },
					amount: { type: "number", positive: true },
					parentId: { type: "number", positive: true },
					itemDesc: {
						type: "object", props: {
							name: { type: "string", min: 1, optional: true },
							description: { type: "string", min: 1, optional: true },
						}
					},
					properties: {
						type: "object", props: { // size, color, upgrades, serial number, ...
						}
					},
					prices: {
						type: "object", props: {
							price: { type: "number", positive: true },
							priceNoTax: { type: "number", positive: true },
							priceTotal: { type: "number", positive: true },
							priceTotalNoTax: { type: "number", positive: true },
							tax: { type: "number", positive: true },
						}
					},
					url: { type: "string", min: 2 },
				}
			}},
			data: {
				type: "object", props: {
					deliveryData: { type: "object" },
					paymentData: { type: "object" },
					couponData: { type: "object", optional: true },
					requirements: { type: "object", optional: true },
					optional: { type: "object", optional: true }
				}
			},
			notes: {
				type: "object", props: {
					customerNote: { type: "string" },
					sellerNote: { type: "string" },
				}
			},
			settings: { type: "object" },
			invoice: { type: "object", optional: true }
		},

		// ------------- ORDER VARIABLES AND SETTINGS -------------
		defaultConstants: {
			tax: 0.2
		},

		order: SettingsMixin.getSiteSettings("orders", true),

		orderTemp: {},
		orderErrors: {
			"itemErrors": [],
			"userErrors": [],
			"orderErrors": []
		},
		emptyUpdateResult: { "id": -1, "name": "order not processed", "success": false },

		paymentsConfigs: {
		}, 

		paths: {
			resources: process.env.PATH_RESOURCES || resourcesDirectory
		}
	},


	/**
	 * Core methods required by this service are located in
	 * /methods/code.methods.js
	 */
	methods: {

		/**
		 * Update this function as you need after project created using npm install
		 */
		/**
		 * After order was paid, perform actions that help to deliver digital goods
		 * @param {*} order 
		 * @param {*} ctx 
		 */
		afterPaidActions(order, ctx) {
			// replace this action with your own
			this.logger.info("afterPaidActions default");
		},


		/**
		 * After order was paid, update user.data.contentDependencies
		 * @param {*} order 
		 * @param {*} ctx 
		 */
		afterPaidUserUpdates(order, ctx) {
			this.logger.info("afterPaidUserUpdates default");
			let cdProductCodes = [];
			if (order?.items?.length > 0) {
				order.items.forEach(oi => {
					if (oi?.contentDependency === true && oi.orderCode) {
						cdProductCodes.push(oi.orderCode);
					}
				});
			}

			if (!order?.user?.id || cdProductCodes.length === 0) {
				return Promise.resolve({ user: null, order });
			}

			let cdProductCodesUniq = cdProductCodes;
			if (ctx.meta.user) {
				if (!ctx.meta.user.data) {
					ctx.meta.user.data = { contentDependencies: { list: [] } };
				}
				if (!ctx.meta.user.data.contentDependencies) {
					ctx.meta.user.data.contentDependencies = { list: [] };
				}
				if (!ctx.meta.user.data.contentDependencies.list) {
					ctx.meta.user.data.contentDependencies.list = [];
				}
				cdProductCodesUniq = this.mergeContentDependencyCodes(
					ctx.meta.user.data.contentDependencies.list,
					cdProductCodes
				);
				ctx.meta.user.data.contentDependencies.list = cdProductCodesUniq;
			}

			return ctx.call("users.updateContentDependencies", {
				userId: order.user.id,
				productCodes: cdProductCodesUniq
			})
				.then(result => {
					this.logger.info("user contentDependencies updated:", result);
					return { user: result, order };
				})
				.catch(err => {
					this.logger.error("order.afterPaidUserUpdates() error:", err);
					return Promise.reject(err);
				});
		},


		/**
		 * After order was paid, perform actions that help to deliver digital goods
		 * @param {*} order 
		 * @param {*} ctx 
		 */
		receivedPayment(order, ctx, paymentData) {
			// replace this action with your own
			this.logger.info("receivedPayment: ", order, ctx, paymentData);
		}

	},

	events: {
		"cache.clean.order"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
