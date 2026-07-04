"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { rmSync } = require("fs");

// global mixins
const DbService = require("../../mixins/db.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");
const priceLevels = require("../../mixins/price.levels.mixin");
const SettingsMixin = require("../../mixins/settings.mixin");
const sppf = require("../../mixins/subproject.helper");

// methods
const ProductsMethodsCore = require("./methods/core.methods");
const ProductsActionsQuery = require("./mixins/products.actions.query.mixin");
const ProductsActionsMutation = require("./mixins/products.actions.mutation.mixin");

const ProductsMethodsHelpers = require("./methods/helpers.methods");



/**
 * Product si represented by price and stock model.
 * That means NOT as page defined by url.
 * 
 * It's up to business and stock model, if every property would have 
 * its product and business keeps stock information about every variation:
 * Product #1 - T-shirt Jam - url: /t-shirt-jam-m-red - size M, color Red (24 pcs in stock)
 * Product #2 - T-shirt Jam - url: /t-shirt-jam-m-blue - size M, color Blue (12 pcs in stock)
 * Product #3 - T-shirt Jam - url: /t-shirt-jam-l-red - size L, color Red (2 pcs in stock)
 * 
 * or if business doesn't keep track of available stock amount
 * (in total or for specific variation)
 * you can set one page for all product variations:
 *  * Product #1 - T-shirt Jam - url: /t-shirt-jam - all sizes and colors
 * In that case you should set properties for specific sizes and colors.
 * 
 * Product types can be: product, subscription, ...
 * Product subtypes can be: physical, digital, ... 
 */

module.exports = {
	name: "products",
	mixins: [
		CacheCleanerMixin([
			"cache.clean.products"
		]),
		HelpersMixin,
		priceLevels,
		// methods
		ProductsMethodsCore,
		ProductsMethodsHelpers,
		// actions
		ProductsActionsQuery,
		ProductsActionsMutation,
		DbService("products"), // has to be the last to not override actions
	],

	/**
	 * Default settings
	 */
	settings: {
		idField: "_id",

		/** Public fields */
		fields: [
			"_id", "externalId", "orderCode", "variationGroupId", "slug",
			"publisher", "sellers", // selers = object
			"type", "subtype",
			"country",
			"name", "descriptionShort", "descriptionLong",
			"price", "tax", "priceLevels", // different currencies, customers, ...
			"properties", "data", // {color, size, ...}, {assets, posible upgrades, ...}
			"categories", // list of category slugs
			"stockAmount", "expectedDate", "expectedCount",
			"dates", // dateCreated, dateUpdated, dateSynced
			"note", "activity"
		],

		/** Validator schema for entity */
		entityValidator: {
			type: { type: "string", min: 3 }, // product, subscription
			subtype: { type: "string", min: 3, optional: true }, // digital, physical
			externalId: { type: "string", min: 3 },
			orderCode: {type: "string", optional: true, min: 3 },
			variationGroupId: {type: "string", optional: true },
			slug: {type: "string", optional: true },
			publisher: {type: "string", min: 3 },
			sellers: { type: "array", optional: true, items:
				{ type: "object", props: {
					name: { type: "string", optional: true },
					email: { type: "string", min: 8 }
				} }
			},
			country: { type: "string", min: 2, optional: true },
			name: { type: "object" },
			descriptionShort: { type: "object", optional: true },
			descriptionLong: { type: "object", optional: true },
			price: { type: "number" },
			tax: { type: "number", optional: true },
			priceLevels: { type: "object", optional: true, props: {
				/*
				{
					"user": {
						"partner": {
							"type": "calculated", // calculated, defined
							"price": 12.5
						}
					}
				}
				*/
				// prop names from business.priceLevels.validUserTypes
				// and exact price for that type
			} },
			properties: { type: "object", optional: true, props: {
			} },
			data: { type: "object", optional: true, props: {
			} },
			categories: { type: "array", items: "string", optional: true }, // category paths
			stockAmount: { type: "number", optional: true },
			expectedDate: { type: "date", optional: true },
			expectedCount: { type: "number", optional: true },
			dates: { type: "object", optional: true, props: {
				dateCreated: { type: "date", optional: true },
				dateUpdated: { type: "date", optional: true },
				dateSynced: { type: "date", optional: true },
			}},
			note: { type: "string", optional: true },
			activity: { type: "object", optional: true, props: {
				start: { type: "date", optional: true },
				end: { type: "date", optional: true }
			}},
		}, 

		// ------------- PRODUCTS VARIABLES AND SETTINGS -------------

		paths: {
			resources: process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../resources"),
			assets: process.env.PATH_PUBLIC || sppf.subprojectPathFix(__dirname, "/../../public")
		},
	},

	events: {
		// "cache.clean.cart"() {
		// 	if (this.broker.cacher)
		// 		this.broker.cacher.clean(`${this.name}.*`);
		// }
	}
};
