"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

// global mixins
const Cron = require("@stretchshop/moleculer-cron");
const DbService = require("../../mixins/db.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");

// methods
const CartActionsShop = require("./mixins/cart.actions.shop.mixin");
const CartActionsAdmin = require("./mixins/cart.actions.admin.mixin");

const CartMethodsCore = require("./methods/core.methods");
const openApiActionMetadata = require("../../mixins/openapi.action-metadata.mixin");

module.exports = {
	name: "cart",
	mixins: [
		CacheCleanerMixin([
			"cache.clean.cart"
		]),
		Cron,
		// methods
		CartMethodsCore,
		// actions
		CartActionsShop,
		CartActionsAdmin,
		openApiActionMetadata("cart"),
		DbService("cart"), // has to be the last to not override actions
	],

	/**
	 * Default settings
	 */
	settings: {
		cronJobs: [{
			name: "CartsCleaner",
			cronTime: "0 1 * * *",
			onTick: function() {

				this.logger.info("Starting to Clean up the Carts");

				this.broker.call("cart.cleanCarts")
					.then((data) => {
						this.logger.info("Carts Cleaned up", data);
					});
			}
		}],

		/** Public fields */
		fields: ["_id", "user", "ip", "hash", "order", "dateCreated", "dateUpdated", "items"],

		/** Validator schema for entity */
		entityValidator: {
			user: { type: "string" },
			ip: { type: "string", min: 4 },
			hash: {type: "string", min: 32 },
			order: { type: "string" },
			dateCreated: { type: "date" },
			dateUpdated: { type: "date" },
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
					requirements: { type: "array", items: { type: "object", props: 
						{
							codename: { type: "string" },
							value: { type: "string" }
						}
					}},
					url: { type: "string", min: 2 },
				}
			}}
		}
	},

	events: {
		"cache.clean.cart"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
