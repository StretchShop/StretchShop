"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

// global mixins
const DbService = require("../../mixins/db.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");

// methods
const CategoriesMethodsCore = require("./methods/core.methods");
const CategoriesActionsList = require("./mixins/categories.actions.list.mixin");
const CategoriesActionsDetail = require("./mixins/categories.actions.detail.mixin");
const CategoriesActionsAdmin = require("./mixins/categories.actions.admin.mixin");

const CategoriesMethodsHelpers = require("./methods/helpers.methods");
const openApiActionMetadata = require("../../mixins/openapi.action-metadata.mixin");


/**
 * Category represents ...
 */

module.exports = {
	name: "categories",
	mixins: [
		CacheCleanerMixin([
			"cache.clean.cart"
		]),
		HelpersMixin,
		// methods
		CategoriesMethodsCore,
		CategoriesMethodsHelpers,
		// actions
		CategoriesActionsList,
		CategoriesActionsDetail,
		CategoriesActionsAdmin,
		openApiActionMetadata("categories"),
		DbService("categories"), // has to be the last to not override actions
	],

	/**
	 * Default settings
	 */
	settings: {
		/** Public fields */
		fields: [
			"_id", "externalId", "slug", "pathSlug", "parentPath", "parentPathSlug", // parentPath = array
			"publisher",
			"type", "subtype",
			"name", "descriptionShort", "descriptionLong",
			"tax", "priceLevels", // different currencies, customers, ...
			"properties", "data", // {color, size, ...}, {assets, posible upgrades, ...}
			"dates", // dateCreated, dateUpdated, dateSynced
			"note", "activity"
		],

		/** Validator schema for entity */
		entityValidator: {
			externalId: { type: "string", min: 3 },
			slug: {type: "string" },
			pathSlug: {type: "string", optional: true },
			parentPath: {type: "array", items: "string" },
			parentPathSlug: {type: "string", optional: true },
			publisher: {type: "string", min: 3 },
			type: { type: "string", min: 3 },
			subtype: { type: "string", min: 3, optional: true },
			name: { type: "object" },
			descriptionShort: { type: "object", optional: true },
			descriptionLong: { type: "object", optional: true },
			tax: { type: "number", optional: true },
			priceLevels: { type: "object", optional: true, props: {
				priceLevelId: { type: "string" },
				price: { type: "number" }
			} },
			properties: { type: "object", optional: true, props: {
			} },
			data: { type: "object", optional: true, props: {
			} },
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
		}
	},

	events: {
		// "cache.clean.cart"() {
		// 	if (this.broker.cacher)
		// 		this.broker.cacher.clean(`${this.name}.*`);
		// }
	}
};
