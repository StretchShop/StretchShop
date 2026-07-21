"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { readdirSync, statSync, rmSync } = require("fs");

// global mixins
const DbService = require("../../mixins/db.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");
const priceLevels = require("../../mixins/price.levels.mixin");
const FileHelpers = require("../../mixins/file.helpers.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const sppf = require("../../mixins/subproject.helper");

// methods
const PageMethodsCore = require("./methods/core.methods");
const PagesActionsList = require("./mixins/pages.actions.list.mixin");
const PagesActionsContent = require("./mixins/pages.actions.content.mixin");

const PageMethodsHelpers = require("./methods/helpers.methods");
const openApiActionMetadata = require("../../mixins/openapi.action-metadata.mixin");


/**
 * Page is represented by two parts:
 *  - static template file, which can be same for all languages or localized eg. ./resources/pages/info-en.html
 *  - record in "pages" table in database.
 * It enables:
 *  - templating, 
 *  - templates can be used even without table record,
 *  - *.json supports metadata files, that support.
 * 
 * Every page template has its own directory in ./resources/pages
 * Templates can be grouped into groups in this directory
 * To set group, use its name before name separated by "---" (3 dashes) 
 * 
 * Database record enables to:
 *  - list in categories (if set),
 *  - search.
 * 
 * Both - template json and database record - do support:
 * 	- pages - slugs to related pages - show in left menu,
 *  - categories - slugs to categories - show in parent directory page listing.
 * If both are present, only data from database record are used.
 */

module.exports = {
	name: "pages",
	mixins: [
		CacheCleanerMixin([
			"cache.clean.pages"
		]),
		HelpersMixin,
		priceLevels,
		FileHelpers,
		// methods
		PageMethodsCore,
		PageMethodsHelpers,
		// actions
		PagesActionsList,
		PagesActionsContent,
		openApiActionMetadata("pages"),
		DbService("pages"), // has to be the last to not override actions
	],

	/**
	 * Default settings
	 */
	settings: {
		/** Public fields */
		idField: "_id",

		fields: [
			"_id", "externalId", "variationGroupId", "slug",
			"publisher", "authors", // authors = object
			"type", "subtype",
			"name", "descriptionShort", "descriptionLong",
			"editorBlocks", 
			"properties", "data", // {color, size, ...}, {assets, posible upgrades, ...}
			"categories", // list of category slugs of parent categories
			"pages", // list of page slugs of parent pages
			"dates", // dateCreated, dateUpdated, dateSynced
			"note", "activity"
		],

		/** Validator schema for entity */
		entityValidator: {
			externalId: { type: "string", min: 3 },
			variationGroupId: {type: "string", optional: true },
			slug: {type: "string", optional: true },
			publisher: {type: "string", min: 3 },
			authors: { type: "array", optional: true, items:
				{ type: "object", props: {
					name: { type: "string", optional: true },
					email: { type: "string", min: 8 }
				} }
			},
			type: { type: "string", min: 3 },
			subtype: { type: "string", min: 3, optional: true },
			name: { type: "object" },
			descriptionShort: { type: "object", optional: true },
			descriptionLong: { type: "object", optional: true },
			properties: { type: "object", optional: true, props: {
			} },
			data: { type: "object", optional: true, props: {
				blocks: { type: "array", items: "object", optional: true }, // WYSIWYG strings
				tagList: { type: "array", items: "string", optional: true }
			} },
			categories: { type: "array", items: "string", optional: true }, // parent categories paths
			pages: { type: "array", items: "string", optional: true }, // parent pages paths
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

		// ------------- PAGES VARIABLES AND SETTINGS -------------

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
