"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

module.exports = {
	actions: {
		find: {
			cache: false
		},
		
		/**
		 * list categories
		 *
		 * @actions
		 * @param {Object} user - User entity
		 *
		 * @returns {Object} Created entity & token
		 */
		categoriesList: {
			// auth: "",
			params: {
				category: { type: "number", positive: true },
				filter: { type: "object" }
			},
			handler(ctx) {
				return ctx.call("categories.detail", { categoryPath: ctx.params.category })
					.then(category => {
						// 1. category exists
						if (category) {
							return ctx.call("products.find", {
								"query": {"parentPathSlug": ctx.params.category}
							})
								.then(categoryProducts => {
									categoryProducts.forEach((product, i) => {
										categoryProducts[i] = this.priceByUser(product, ctx.meta.user);
									});
									return categoryProducts;
								})
								.catch(err => {
									console.error('categories.categoriesList error: ', err);
									return this.Promise.reject(new MoleculerClientError("Categories error", 422, "", []));
								});
						}
					});
			}
		},


		/**
		 * Extension of build-in find action, with filtering only active categories
		 * 
		 * @actions
		 * @param {Object} filter - filter object
		 *
		 * @returns {Array.<Object>} List of categories with additional data
		 */
		findActive: {
			params: {
				limit: { type: "number", optional: true },
				offset: { type: "number", optional: true },
				sort: { type: "string", optional: true },
				query: { type: "object" }
			},
			handler(ctx) {
				// fix filter if needed
				let filter = { query: {}, limit: 100};
				if (typeof ctx.params.query !== "undefined" && ctx.params.query) {
					filter.query = ctx.params.query;
				}
				if (typeof ctx.params.limit !== "undefined" && ctx.params.limit) {
					filter.limit = ctx.params.limit;
				}
				if (typeof ctx.params.offset !== "undefined" && ctx.params.offset) {
					filter.offset = ctx.params.offset;
				}
				if (typeof ctx.params.sort !== "undefined" && ctx.params.sort) {
					filter.sort = ctx.params.sort;
				}

				let query = {"$and": []};
				if (typeof filter.query !== "undefined" && filter.query) {
					for (let q in filter.query) {
						if (Object.hasOwn(filter.query, q)) {
							let obj = {};
							obj[q] = filter.query[q];
							query["$and"].push(obj);
						}
					}
				}

				query = this.filterOnlyActiveCategories(query, ctx);
				filter.query = query;
				console.log("categories.findActive filter: ", filter);

				return ctx.call("categories.find", filter)
					.then(categories => {
						return categories;
					})
					.catch(err => {
						this.logger.error("categories findActive error: ", err);
						return this.Promise.reject(new MoleculerClientError("Categories findA error", 422, "", []));
					});
			}
		},


		/**
		 * Return category with related page
		 * 
		 * @actions
		 * @param {Object} query - query object
		 * @param {String} lang - page language
		 * 
		 * @returns {Object} - object with category & page data
		 */
		findWithContent: {
			params: {
				query: { type: "object" },
				lang: { type: "string", min: 2, optional: true } 
			},
			handler(ctx) {
				return ctx.call("categories.findActive", { query: ctx.params.query })
					.then(categories => {
						return ctx.call("pages.detail", { 
							page: ctx.params.query.type,
							lang: ctx.params.lang
						})
							.then(page => {
								return {
									categories, 
									page
								};
							})
							.then(result => {
								return result;
							})
							.catch(err => {
								console.error('categories.findWithContent pages.detail error: ', err);
								return this.Promise.reject(new MoleculerClientError("Category page error", 422, "", []));
							});
					})
					.catch(err => {
						console.error('categories.categoriesList error: ', err);
						return this.Promise.reject(new MoleculerClientError("Categories error", 422, "", []));
					});
			}
		},


		/**
		 * Get detail of Category.
		 *
		 * @actions
		 *
		 * @returns {Object} Category entity
		 */
	}
};
