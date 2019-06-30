"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

//const crypto 		= require("crypto");
const Cookies   = require("cookies");

const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

module.exports = {
	name: "pages",
	mixins: [
		DbService("pages"),
		// CacheCleanerMixin([
		// 	"cache.clean.cart"
		// ])
	],

	/**
	 * Default settings
	 */
	settings: {
		/** Public fields */
		fields: [
			"_id", "slug"
		],

		/** Validator schema for entity */
		entityValidator: {
			slug: { type: "string", min: 3 },
		},

		// ------------- PAGES VARIABLES AND SETTINGS -------------
	},


	/**
	 * Actions
	 */
	actions: {
		/**
		 * Get current order progress according to cart
		 *
		 * @returns {Object} cart entity with items
		 */
		show: {
			// auth: "required",
			params: {
				slug: { type: "string" }
			},
			handler(ctx) {
				// return content of the page
			}
		},

	},

	/**
	 * Methods
	 */
	methods: {
		
	},

	events: {
		// "cache.clean.cart"() {
		// 	if (this.broker.cacher)
		// 		this.broker.cacher.clean(`${this.name}.*`);
		// }
	}
};
