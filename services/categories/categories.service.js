"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

// global mixins
const DbService = require("../../mixins/db.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");

// methods
const CategoriesMethodsCore = require("./methods/core.methods");
const CategoriesMethodsHelpers = require("./methods/helpers.methods");


/**
 * Category represents ...
 */

module.exports = {
	name: "categories",
	mixins: [
		DbService("categories"),
		CacheCleanerMixin([
			"cache.clean.cart"
		]),
		HelpersMixin,
		// methods
		CategoriesMethodsCore,
		CategoriesMethodsHelpers
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


	/**
	 * Actions
	 */
	actions: {

		/**
		 * disable cache for find action
		 */
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
						if (Object.prototype.hasOwnProperty.call(filter.query, q)) {
							let obj = {};
							obj[q] = filter.query[q];
							query["$and"].push(obj);
						}
					}
				}

				query = this.filterOnlyActiveCategories(query, ctx);
				filter.query = query;

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
		detail: {
			// auth: "",
			params: {
				categoryPath: { type: "string", min: 3 }
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				return ctx.call("categories.find", {
					"query": {
						pathSlug: ctx.params.categoryPath
					}
				})
					.then(found => {
						if (found && found.length>0) { // category found, return it
							found = found[0];
							return ctx.call("categories.find", {
								"query": {
									"$or": [
										{"parentPath": {"$in": [found.slug]}},
										{"slug": {"$in": found.parentPath}},
									]
								}
							})
								.then(matchingCategories => {
									let childParentPath = [];
									if (found.parentPath && found.parentPath.length>0) {
										childParentPath = found.parentPath.slice();
									}
									childParentPath.push(found.slug);
									found["parentCategories"] = this.extractParentCategoriesByArrayOrder(matchingCategories, found.parentPath);
									let subs = this.extractChildCategoriesByArrayOrder(matchingCategories, childParentPath);
									// TODO - make function that picks only those categories,
									// that have categories ordered like this category
									found["subs"] = subs;
									found["subsSlugs"] = this.getAllPathSlugs(subs);

									let categoriesToListProductsIn = [ctx.params.categoryPath];
									if (found.subsSlugs && found.subsSlugs.length>0) {
										categoriesToListProductsIn = found.subsSlugs;
										categoriesToListProductsIn.push(ctx.params.categoryPath);
									}
									if ( categoriesToListProductsIn.length<1 ) {
										categoriesToListProductsIn = [categoriesToListProductsIn];
									}

									// count products inside this category and its subcategories
									/* 
									set conservativeType where products & services are merged
									as they are listed with same engine (products), and pages 
									are separated because of custom listing engine (services)
									*/
									let conservativeType = found.type;
									if (conservativeType=="services") {
										conservativeType = "products";
									}
									return ctx.call(conservativeType+".count", {
										"query": {
											"categories": {"$in": categoriesToListProductsIn}
										}
									})
										.then(productsCount => {
											found["count"] = productsCount;
											// return found;
											if (found.type=="pages") {
												found["minMaxPrice"] = { min: null, max: null };
												return found;
											} else {
												return ctx.call("products.getMinMaxPrice", {
													categories: categoriesToListProductsIn
												}).then(minMaxPrice => {
													if ( minMaxPrice.length>0 ) {
														minMaxPrice = minMaxPrice[0];
														if ( typeof minMaxPrice._id !== "undefined" ) {
															delete minMaxPrice._id;
														}
													}
													found["minMaxPrice"] = minMaxPrice;
													return found;
												})
												.catch(err => {
													console.error('categories.detail - products.getMinMaxPrice error: ', err);
													return this.Promise.reject(new MoleculerClientError("Category detail error", 422, "", []));
												});
											}
										})
										.catch(err => {
											console.error('categories.detail - items count error: ', err);
											return this.Promise.reject(new MoleculerClientError("Category items count error", 422, "", []));
										});
								})
								.catch(err => {
									console.error('categories.detail - subcategories error: ', err);
									return this.Promise.reject(new MoleculerClientError("Category subcategories error", 422, "", []));
								});
						} else { // no category found
							return Promise.reject(new MoleculerClientError("Category not found", 403, "", null)); // do not return category, just null
						}
					})
					.catch(err => {
						console.error('categories.detail - categories.find error: ', err);
						return this.Promise.reject(new MoleculerClientError("Category detail error", 422, "", []));
					});
			}
		},


		/**
		 * Import category data:
		 *  - categories - with parent slug and level data
		 *
		 * @actions
		 *
		 * @returns {Object} Category entity
		 */
		import: {
			auth: "required",
			params: {
				categories: { type: "array", items: "object", optional: true },
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				this.logger.info("categories.import - ctx.meta");
				let categories = ctx.params.categories;
				let promises = [];
				let self = this;

				if (ctx.meta.user.type=="admin") {
					if ( categories && categories.length>0 ) {
						// loop categories to import
						categories.forEach(function(entity) {
							promises.push(
								// add category results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										if (found) { // category found, update it
											if ( entity ) {
												entity = self.fixEntityDates(entity);
											}

											return self.validateEntity(entity)
												.then(() => {
													if (!entity.dates) {
														entity.dates = {};
													}
													entity.dates.dateUpdated = new Date();
													entity.dates.dateSynced = new Date();
													
													self.logger.info("categories.import found - update entity:", entity);
													let entityId = entity.id;
													delete entity.id;
													delete entity._id;
													const update = {
														"$set": entity
													};

													// after call action
													ctx.meta.afterCallAction = {
														name: "category update",
														type: "render",
														data: {
															url: self.getRequestData(ctx)
														}
													};

													return self.adapter.updateById(entityId, update)
														.then(doc => self.transformDocuments(ctx, {}, doc))
														.then(json => self.entityChanged("updated", json, ctx)
														.then(() => json))
														.catch(err => {
															console.error('categories.import update error: ', err);
															return this.Promise.reject(new MoleculerClientError("Category import update error", 422, "", []));
														});
												})
												.catch(err => {
													console.error('categories.import update validation error: ', err);
													return this.Promise.reject(new MoleculerClientError("Category import update validation error", 422, "", []));
												});
										} else { // no category found, create one
											return self.validateEntity(entity)
												.then(() => {
													// set generic variables
													if ( !entity.slug || entity.slug.trim() == "") {
														let lang = ctx.meta.localsDefault.lang;
														if ( ctx.meta.localsDefault.lang.code ) {
															lang = ctx.meta.localsDefault.lang.code;
														}
														entity.slug = slug(entity.name[lang], { lower: true }); // + "-" + (Math.random() * Math.pow(36, 6) | 0).toString(36);
													}
													return ctx.call("categories.find", {
														"query": {
															slug: entity.slug
														}
													})
														.then(slugFound => {
															if (slugFound && slugFound.constructor !== Array) {
																self.logger.error("categories.import notFound - insert - slugFound entity:", entity);
																return { "error" : "Slug "+entity.slug+" already used." };
															}

															if ( !entity.parentPathSlug || entity.parentPathSlug.trim() == "") {
																entity.parentPathSlug = slug(entity.parentPath.join("-"), { lower: true });
															}
															entity.pathSlug = entity.slug;
															if ( entity.slug && entity.parentPathSlug ) {
																entity.pathSlug = entity.parentPathSlug +"-"+ entity.slug;
															}
															if (ctx.meta.user && ctx.meta.user.email) {
																entity.publisher = ctx.meta.user.email.toString();
															}
															if (!entity.dates) {
																entity.dates = {};
															}
															entity.dates.dateCreated = new Date();
															entity.dates.dateUpdated = new Date();
															entity.dates.dateSynced = new Date();
															self.logger.info("categories.import - insert entity:", entity);

															// after call action
															ctx.meta.afterCallAction = {
																name: "category insert",
																type: "render",
																data: {
																	url: self.getRequestData(ctx)
																}
															};

															return self.adapter.insert(entity)
																.then(doc => self.transformDocuments(ctx, {}, doc))
																.then(json => self.entityChanged("created", json, ctx)
																.then(() => json))
																.catch(err => {
																	console.error('categories.import insert error: ', err);
																	return this.Promise.reject(new MoleculerClientError("Category import insert error", 422, "", []));
																});
														})
														.catch(err => {
															console.error('categories.import insert slug-check error: ', err);
															return this.Promise.reject(new MoleculerClientError("Category import insert slug-check error", 422, "", []));
														});
												})
												.catch(err => {
													console.error('categories.import insert validation error: ', err);
													return this.Promise.reject(new MoleculerClientError("Category import insert validation error", 422, "", []));
												});
										} // else end
									})
									.catch(err => {
										console.error('categories.import findById error: ', err);
										return this.Promise.reject(new MoleculerClientError("Category import find error", 422, "", []));
									})); // push with find end
						}); // categories foreach loop end
					}

					// return multiple promises results
					return Promise.all(promises).then(prom => {
						return prom;
					})
					.catch(err => {
						console.error('categories.import promises error: ', err);
						return this.Promise.reject(new MoleculerClientError("Category import all error", 422, "", []));
					});
				} else { // not admin user
					return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
				}	
			}
		},

		
		/**
		 * Delete category data by id
		 *
		 * @actions
		 *
		 * @returns {Object} Category entity
		 */
		delete: {
			auth: "required",
			params: {
				categories: { type: "array", items: "object", optional: true },
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				this.logger.info("categories.delete ctx.meta", ctx.meta);
				let categories = ctx.params.categories;
				let promises = [];
				let self = this;

				if (ctx.meta.user.type=="admin") {
					if ( categories && categories.length>0 ) {
						// loop products to import
						categories.forEach(function(entity) {
							promises.push(
								// add product results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										if (found) { // product found, update it
											self.logger.info("categories.delete - DELETING category: ", found);
											return ctx.call("categories.remove", {id: found._id} )
												.then((deletedCount) => {
													// after call action
													ctx.meta.afterCallAction = {
														name: "category delete",
														type: "remove",
														data: {
															url: self.getRequestData(ctx)
														}
													};

													self.logger.info("categories.delete - deleted category Count: ", deletedCount);
													return deletedCount;
												}) // returns number of removed items
												.catch(err => {
													console.error('categories.delete remove error: ', err);
													return this.Promise.reject(new MoleculerClientError("Category delete error", 422, "", []));
												}); 
										} else {
											self.logger.error("categories.delete - entity.id "+entity.id+" not found");
										}
									})
									.catch(err => {
										console.error('categories.delete find error: ', err);
										return this.Promise.reject(new MoleculerClientError("Category delete find error", 422, "", []));
									})
							); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises).then(() => {
						return promises;
					})
					.catch(err => {
						console.error('categories.delete promises error: ', err);
						return this.Promise.reject(new MoleculerClientError("Category delete all error", 422, "", []));
					});
				} else { // not admin user
					return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
				}
			}
		},



		// check page authorship
		checkAuthor: {
			auth: "required",
			params: {
				data: { type: "object" }
			},
			handler(ctx) {
				if (ctx.params.data && ctx.params.data.slug && ctx.params.data.publisher) {
					return this.adapter.find({
						"query": {
							"slug": ctx.params.data.slug,
							"publisher": ctx.params.data.publisher
						}
					})
						.then(pages => {
							if (pages && pages.length>0 && pages[0].slug==ctx.params.data.slug) {
								return true;
							}
						})
						.catch(err => {
							this.logger.error("pages.checkAuthor() - error: ", err);
							return false;
						});
				}
				return false;
			}
		},



		updateCategoryImage: {
			auth: "required",
			params: {
				data: { type: "object" },
				params: { type: "object" }
			},
			handler(ctx) {
				if (ctx.params.params && ctx.params.params.slug) {
					this.logger.info("page.updateCategoryImage - has slug: ", ctx.params.params.slug);
					return;
				}
				return;
			}
		},



	}, // *** actions end




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
