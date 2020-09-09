"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

const HelpersMixin = require("../mixins/helpers.mixin");

const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

const sppf = require("../mixins/subproject.helper");
let resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../resources");
const businessSettings = require( resourcesDirectory+"/settings/business");


/**
 * Product represents one product as definition with properties.
 * That means not as page, defined by url, that can group multiple products with
 * different properties, but as item, that has different properties than any
 * other product available. eg.:
 * Product #1 - T-shirt Jam - url: /t-shirt-jam-m-red - size M, color Red
 * Product #2 - T-shirt Jam - url: /t-shirt-jam-m-blue - size M, color Blue
 * Product #3 - T-shirt Jam - url: /t-shirt-jam-l-red - size L, color Red
 *
 * When loading url of detail product /t-shirt-jam all these three products will be loaded and
 * used for creating available options for ordering in front-end app.
 */

module.exports = {
	name: "products",
	mixins: [
		DbService("products"),
		HelpersMixin,
		CacheCleanerMixin([
			"cache.clean.products"
		])
	],

	/**
	 * Default settings
	 */
	settings: {
		/** Public fields */
		idField: "_id",

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
			type: { type: "string", min: 3 },
			subtype: { type: "string", min: 3, optional: true },
			country: { type: "string", min: 2, optional: true },
			name: { type: "object" },
			descriptionShort: { type: "object", optional: true },
			descriptionLong: { type: "object", optional: true },
			price: { type: "number" },
			tax: { type: "number", optional: true },
			priceLevels: { type: "array", optional: true, items:
				{ type: "object", props: {
					priceLevelId: { type: "string" },
					priceLevelType: { type: "string", optional: true }, // can be price or percentage
					price: { type: "number" }
				} }
			},
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
		}
	},


	/**
	 * Actions
	 */
	actions: {
		/**
		 * List products in category
		 *
		 * @actions
		 * @param {Object} user - User entity
		 *
		 * @returns {Object} Created entity & token
		 */
		productsList: {
			// auth: "",
			params: {
				category: { type: "string", min: 2 },
				listSubs: { type: "boolean", optional: true },
				filter: { type: "object", optional: true }
			},
			handler(ctx) {
				return ctx.call("categories.detail", { categoryPath: ctx.params.category })
					.then(category => {
						// 1. category exists
						if (category) {
							let categoriesToListProductsIn = [ctx.params.category];
							if (category.subsSlugs && category.subsSlugs.length>0) {
								categoriesToListProductsIn = category.subsSlugs;
								categoriesToListProductsIn.push(ctx.params.category);
							}
							if ( categoriesToListProductsIn.length<1 ) {
								categoriesToListProductsIn = [categoriesToListProductsIn];
							}
							category["taxData"] = businessSettings.taxData.global;

							// fix filter if needed
							let filter = { query: {}, limit: 100};
							if (typeof ctx.params.filter !== "undefined" && ctx.params.filter) {
								filter = ctx.params.filter;
								if (typeof filter.query === "undefined" || !filter.query) {
									filter.query = {};
								}
							}
							// set categories if from detail
							filter["query"]["categories"] = {
								"$in": categoriesToListProductsIn
							};
							// set max of results
							if (filter.limit>100) {
								filter.limit = 100;
							}
							if (typeof filter.sort === "undefined" || !filter.sort) {
								filter.sort = "price";
							}

							return ctx.call("products.find", filter)
								.then(categoryProducts => {
									let result = {
										"categoryDetail": category,
										"results": categoryProducts
									};

									// TODO - check if this can be removed, if data not already in category var
									return ctx.call("categories.find", {
										"query": {
											parentPathSlug: category.pathSlug
										}
									})
										.then(categoriesList => {
											result["categories"] = categoriesList;
											if ( JSON.stringify(filter.query) != "{\"categories\":{\"$in\":"+JSON.stringify(categoriesToListProductsIn)+"}}" ) {
												return ctx.call("products.count", filter)
													.then(filteredProductsCount => {
														result["filteredProductsCount"] = filteredProductsCount;
														return result;
													});
											}
											return result;
										});
								});
						}
					});
			}
		},

		/**
		 * Add item to user's cart
		 *
		 * @actions
		 * @param {Object} user - User entity
		 *
		 * @returns {Object} Created entity & token
		 */
		findWithCount: {
			// auth: "",
			params: {
				query: { type: "object", optional: true },
				limit: { type: "number", optional: true },
				offset: { type: "number", optional: true },
				sort: { type: "string", optional: true },
				minimalData: { type: "boolean", optional: true }
			},
			handler(ctx) {
				// fix filter if needed
				let filter = { query: {}, limit: 100};
				if (typeof ctx.params.query !== "undefined" && ctx.params.query) {
					filter.query = ctx.params.query;
				}
				// if categories sent, use them
				let categories = [];
				if ( ctx.params.query.categories && typeof ctx.params.query.categories["$in"] !== "undefined") {
					categories = ctx.params.query.categories["$in"];
				}
				// set offset
				if (ctx.params.offset && ctx.params.offset>0) {
					filter.offset = ctx.params.offset;
				}
				// set max of results
				if (typeof ctx.params.limit !== "undefined" && ctx.params.limit) {
					filter.limit = ctx.params.limit;
				}
				if (filter.limit>100) {
					filter.limit = 100;
				}
				// sort
				filter.sort = "price";
				if (typeof ctx.params.sort !== "undefined" && ctx.params.sort) {
					filter.sort = ctx.params.sort;
				}

				return ctx.call("products.find", filter)
					.then(categoryProducts => {
						let result = {
							"categories": categories,
							"results": categoryProducts
						};

						if (typeof ctx.params.minimalData !== "undefined" && ctx.params.minimalData==true) {
							return result;
						} else {
							return ctx.call("products.getMinMaxPrice", {
								categories: categories
							}).then(minMaxPrice => {
								if ( minMaxPrice.length>0 ) {
									minMaxPrice = minMaxPrice[0];
									if ( typeof minMaxPrice._id !== "undefined" ) {
										delete minMaxPrice._id;
									}
								}
								result["filter"] = {
									"minMaxPrice": minMaxPrice
								};
								// count products inside this category and its subcategories
								return ctx.call("products.count", {
									"query": filter.query
								})
									.then(productsCount => {
										result["filteredProductsCount"] = productsCount;
										return result;
									});
							});
						}

					});

			}
		},


		/**
     * Mongo specific search with _id included
     *
     * @param {Object} query - original query with _id
     *
     * @returns {Object}
     */
		findWithId: {
			params: {
				query: { type: "object" }
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				let queryObject = ctx.params.query;
				let self = this;
				Object.keys(queryObject).forEach(function(key) {
					if (key==="_id" && typeof queryObject[key] === "string") {
						queryObject[key] = self.fixStringToId(queryObject[key]);
					}
				});
				return this.adapter.find({
					"query": queryObject
				})
					.then( results => {
						if (results && results.length>0) {
							results.forEach(result => {
								result = self.getProductTaxData(result, businessSettings.taxData);
							});
						}
						return results;
					});
			}
		},


		/**
		 * Get detail of product.
		 *
		 * @actions
		 *
		 * @returns {Object} Product entity
		 */
		detail: {
			// auth: "",
			params: {
				product: { type: "string", min: 2 }
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				return this.adapter.findById(ctx.params.product)
					.then(found => {
						if (found) { // product found, return it
							found["taxData"] = businessSettings.taxData.global;
							if (found.categories.length>0) {
								return ctx.call("categories.detail", {
									categoryPath: found.categories[0],
									type: "products"
								})
									.then(parentCategoryDetail => {
										found["parentCategoryDetail"] = parentCategoryDetail;
										return found;
									});
							} else {
								found["parentCategoryDetail"] = null;
								return found;
							}
						} else { // no product found
							this.logger.info("products.detail - product not found");
							return Promise.reject(new MoleculerClientError("Product not found!", 400, "", [{ field: "product", message: "not found"}]));
						}
					})
					.catch(err => {
						this.logger.error("products.detail - found error", err);
					})
					.then(found => {
						// optional data
						if (found && typeof found.variationGroupId !== "undefined" && found.variationGroupId && found.variationGroupId.trim()!="") {
							return this.adapter.find({
								"query": {
									"variationGroupId": found.variationGroupId,
									"_id": { "$ne": found._id }
								}
							})
								.then(variations => {
									if (!found.data) {
										found.data = {};
									}
									variations.forEach((variation) => {
										if (variation && variation.data) {
											if (variation.data.variations) {
												variation.data.variations = null;
											}
											if (variation.data.related) {
												variation.data.related = null;
											}
										}
									});
									found.data.variations = variations;
									return found;
								});
						}
						return found;
					})
					.then(found => {
						if (found && typeof found.data!=="undefined" && found.data.related && found.data.related.products && found.data.related.products.length>0) {
							return this.adapter.find({
								"query": {
									"orderCode": {"$in": found.data.related.products}
								}
							})
								.then(related => {
									related.forEach((rel) => {
										if (rel && rel.data) {
											if (rel.data.variations) {
												rel.data.variations = null;
											}
											if (rel.data.related) {
												rel.data.related = null;
											}
										}
									});
									found.data.related.productResults = related;
									return found;
								});
						}
						return found;
					});
			}
		},



		getMinMaxPrice: {
			// auth: "",
			params: {
				categories: { type: "array" }
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				let categories = ctx.params.categories;
				return this.adapter.collection.aggregate([
					{ "$match": {
						"categories": {"$in": categories}
					}},
					{ "$group": {
						"_id": null,
						"max": { "$max": "$price" },
						"min": { "$min": "$price" }
					}}
				]).toArray()
					.then(minMaxPrice => {
						return minMaxPrice;
					});
			}
		},



		/**
		 * Import product data:
		 *  - products - with categories
		 *
		 * @actions
		 *
		 * @returns {Object} Product entity
		 */
		import: {
			auth: "required",
			params: {
				products: { type: "array", items: "object", optional: true },
			},
			cache: false,
			handler(ctx) {
				this.logger.info("products.import - ctx.meta", ctx.meta);
				let products = ctx.params.products;
				let promises = [];
				let self = this;

				if (ctx.meta.user.type=="admin") {
					if ( products && products.length>0 ) {
						// loop products to import
						products.forEach(function(entity) {
							promises.push(
								// add product results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										if (found) { // product found, update it
											if ( entity && entity.dates ) {
												Object.keys(entity.dates).forEach(function(key) {
													let date = entity.dates[key];
													if ( date && date!=null && date.trim()!="" ) {
														entity.dates[key] = new Date(entity.dates[key]);
													}
												});
											}

											return self.validateEntity(entity)
												.then(() => {
													if (!entity.dates) {
														entity.dates = {};
													}
													entity.dates.dateUpdated = new Date();
													entity.dates.dateSynced = new Date();
													self.logger.info("products.import found - update entity:", entity);
													let entityId = entity.id;
													delete entity.id;
													delete entity._id;
													const update = {
														"$set": entity
													};

													// after call action
													ctx.meta.afterCallAction = {
														name: "product update",
														type: "render",
														data: {
															url: self.getRequestData(ctx)
														}
													};

													return self.adapter.updateById(entityId, update);
												});
										} else { // no product found, create one
											return self.validateEntity(entity)
												.then(() => {
													// set generic variables
													if ( !entity.slug || entity.slug.trim() == "") {
														let lang = ctx.meta.localsDefault.lang;
														if ( ctx.meta.localsDefault.lang.code ) {
															lang = ctx.meta.localsDefault.lang.code;
														}
														entity.slug = slug(entity.name[lang], { lower: true });
														// + "-" + (Math.random() * Math.pow(36, 6) | 0).toString(36);
													}
													return ctx.call("products.find", {
														"query": {
															slug: entity.slug
														}
													})
														.then(slugFound => {
															if (slugFound && slugFound.constructor !== Array) {
																self.logger.error("products.import notFound - insert - slugFound entity:", entity);
																return { "error" : "Slug "+entity.slug+" already used." };
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
															self.logger.info("products.import - insert entity:", entity);

															// after call action
															ctx.meta.afterCallAction = {
																name: "product insert",
																type: "render",
																data: {
																	url: self.getRequestData(ctx)
																}
															};

															return self.adapter.insert(entity)
																.then(doc => self.transformDocuments(ctx, {}, doc))
																.then(json => self.entityChanged("created", json, ctx).then(() => json));
														});
												});
										}
									})); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises).then(prom => {
						return prom;
					});
				} else { // not admin user
					return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
				}
			} // handler end
		},


		/**
		 * Delete product data by id
		 *
		 * @actions
		 *
		 * @returns {Object} Product entity
		 */
		delete: {
			auth: "required",
			params: {
				products: { type: "array", items: "object", optional: true },
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				this.logger.info("products.delete ctx.meta", ctx.meta);
				let products = ctx.params.products;
				let promises = [];
				let self = this;

				if (ctx.meta.user.type=="admin") {
					if ( products && products.length>0 ) {
						// loop products to import
						products.forEach(function(entity) {
							promises.push(
								// add product results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										if (found) { // product found, delete it
											self.logger.info("products.delete - DELETING product: ", found);
											return ctx.call("products.remove", {id: found._id} )
												.then((deletedCount) => {

													// after call action
													ctx.meta.afterCallAction = {
														name: "product delete",
														type: "render",
														data: {
															url: self.getRequestData(ctx)
														}
													};

													self.logger.info("products.delete - deleted product Count: ", deletedCount);
													return deletedCount;
												}); // returns number of removed items
										} else {
											self.logger.error("products.delete - entity.id "+entity.id+" not found");
										}
									})); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises).then(() => {
						return promises;
					});
				} else { // not admin user
					return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
				}
			} // handler end
		},

		updateProductImage: {
			auth: "required",
			params: {
				data: { type: "object" },
				params: { type: "object" }
			},
			handler(ctx) {
				this.logger.info("products.updateProductImage ctx.params+meta:", {
					params: ctx.params,
					meta: ctx.meta
				});
				if (ctx.params.params && ctx.params.params.orderCode) {
					if (ctx.params.params.type=="gallery") {
						this.adapter.find({
							"query": {
								"orderCode": ctx.params.params.orderCode
							}
						})
							.then(product => {
								if (product) {
									if ( product[0] ) {
										product = product[0];
									}
								// let extension =
								// self.adapter.updateById(product._id, {
								//  "$set": {
								//    data.gallery.images: ["p1.jpg", ...]
								//  }
								// });
								}
							});
					}
				}
				return;
			}
		},

		// check product authorship
		checkAuthor: {
			auth: "required",
			params: {
				data: { type: "object" }
			},
			handler(ctx) {
				if (ctx.params.data && ctx.params.data.orderCode && ctx.params.data.publisher) {
					return this.adapter.find({
						"query": {
							"orderCode": ctx.params.data.orderCode,
							"publisher": ctx.params.data.publisher
						}
					})
						.then(products => {
							if (products && products.length>0 && products[0].orderCode==ctx.params.data.orderCode) {
								return true;
							}
						})
						.catch(err => {
							this.logger.error("products.checkAuthor error: ", err);
							return false;
						});
				}
				return false;
			}
		}


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
