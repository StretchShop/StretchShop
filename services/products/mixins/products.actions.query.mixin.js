"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { rmSync } = require("fs");
const SettingsMixin = require("../../../mixins/settings.mixin");

module.exports = {
	actions: {
		find: { // with price & tax 
			params: {
				populate: { type: "array", items: { type: "string"}, optional: true },
				fields: { type: "array", items: { type: "string"}, optional: true },
				offset: { type: "number", optional: true },
				limit: { type: "number", optional: true },
				sort: { type: "string", optional: true },
				search: { type: "string", optional: true },
				searchFields: { type: "string", optional: true },
				query: { type: "object" }
			},
			cache: false,
			handler(ctx) {
				if (!ctx.params) { ctx.params = { limit: 10 }; }
				if (!ctx.params?.limit || ctx.params?.limit > 100) {
					ctx.params.limit = 100;
				}
				let filter = ctx.params;
				let self = this;
				this.logger.info("products.find filter before FRI:", JSON.stringify(filter));
				this.fixRequestIds(filter);
				if (filter.query?.["$and"] && Array.isArray(filter.query["$and"]) && filter.query["$and"].length <= 1) {
					filter.query = filter.query["$and"][0];
				}
				this.logger.info("products.find filter after FRI:", JSON.stringify(filter));
				return this.adapter.find(filter)
					.then( results => {
						if (results && results.length>0) {
							results.forEach(result => {
								result = self.priceByUser(result, ctx.meta.user);
								result = self.getProductTaxData(
									result, 
									SettingsMixin.getSiteSettings("business")?.taxData
								);
							});
						}
						return results;
					})
					.catch(err => {
						this.logger.error("products.find error:", err);
						return this.Promise.reject(new MoleculerClientError("Products find error", 422, "", []));
					});
			}
		},


		/**
		 * List products in GET with minimal params
		 *
		 * @actions
		 * @param {String} category - category name
		 * @param {Object} filter - filter object
		 *
		 * @returns {Array.<Object>} List of products with additional data
		 */
		productsListGet: {
			cache: false,
			params: {
				category: { type: "string", min: 2 },
				limit: { type: "string", optional: true }
			},
			handler(ctx) {
				let params = { 
					category: ctx.params.category, 
					filter: {}
				};
				if (ctx.params.limit && parseInt(ctx.params.limit) > 0) {
					params.filter = {
						limit: ctx.params.limit
					};
				}
				return ctx.call("products.productsList", params)
					.catch(err => {
						this.logger.error("products.productsListGet error:", err);
						return this.Promise.reject(new MoleculerClientError("Products findG error", 422, "", []));
					});
			}
		},


		/**
		 * List products in category
		 *
		 * @actions
		 * @param {String} category - category name
		 * @param {Object} filter - filter object
		 *
		 * @returns {Array.<Object>} List of products with additional data
		 */
		productsList: {
			cache: false,
			// cache: {
			// 	keys: ["#user", "category", "filter"],
			// 	ttl: 30
			// },
			// auth: "",
			params: {
				category: { type: "string", min: 2 },
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
							category["taxData"] = SettingsMixin.getSiteSettings("business")?.taxData?.global;

							// fix filter if needed
							let filter = { query: {}, limit: 30};
							if (ctx.params.filter !== undefined && ctx.params.filter) {
								filter = ctx.params.filter;
							}

							// add queries to $and array
							let query = {"$and": []};
							if (filter.query !== undefined && filter.query) {
								for (let q in filter.query) {
									if (Object.hasOwn(filter.query, q)) {
										let obj = {};
										obj[q] = filter.query[q];
										query["$and"].push(obj);
									}
								}
							}
							// set categories if from detail
							query["$and"].push({
								"categories": { "$in": categoriesToListProductsIn }
							});
							query = this.filterOnlyActiveProducts(query, ctx.meta.user);
							filter.query = query;

							// set max of results
							if (filter.limit>100) {
								filter.limit = 100;
							}
							// sort
							filter = this.getFilterSort(filter, ctx);

							return ctx.call("products.find", filter)
								.then(categoryProducts => {
									categoryProducts.forEach((product, i) => {
										categoryProducts[i] = this.priceByUser(product, ctx.meta.user);
									});

									let result = {
										"categoryDetail": category,
										"results": categoryProducts
									};

									// TODO - check if this can be removed, if data not already in category var
									return ctx.call("categories.findActive", {
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
													})
													.catch(err => {
														this.logger.error("products.productsList count error:", err);
														return this.Promise.reject(new MoleculerClientError("Products findL count error", 422, "", []));
													});
											}
											return result;
										})
										.catch(err => {
											this.logger.error("products.productsList categories.findActive error:", err);
											return this.Promise.reject(new MoleculerClientError("Products findL cat findA error", 422, "", []));
										});
								})
								.catch(err => {
									this.logger.error("products.productsList find error:", err);
									return this.Promise.reject(new MoleculerClientError("Products findL error", 422, "", []));
								})
								.then(productsResult => {
									return ctx.call("products.getCategoryProductsProperties", {
										categories: categoriesToListProductsIn
									})
										.then(properties => {
											productsResult["filterProperties"] = properties;
											return productsResult;
										});
								});
						}
					})
					.catch(err => {
						this.logger.error("products.productsList error:", err);
						return this.Promise.reject(new MoleculerClientError("Products findL catD error", 422, "", []));
					});
			}
		},


		/**
		 * Gets page of products by filter 
		 * with count of total that match filter
		 *
		 * @actions
		 * @param {Object} query - Main query
		 * @param {Number} limit - Limit
		 * @param {Number} offset - Offset
		 * @param {String} sort - Sorting string
		 * @param {Boolean} minimalData - Return only minimal data without count
		 *
		 * @returns {Object} Object with results and total count
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
				if ( ctx.params.query?.categories && typeof ctx.params.query?.categories["$in"] !== "undefined") {
					categories = ctx.params.query?.categories["$in"];
				}

				// add queries to $and array
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
				query = this.filterOnlyActiveProducts(query, ctx.meta.user);
				filter.query = query;

				// set offset
				if (ctx.params.offset !== undefined && ctx.params.offset>0) {
					filter.offset = ctx.params.offset;
				}
				// set max of results
				if (ctx.params.limit !== undefined && ctx.params.limit) {
					filter.limit = ctx.params.limit;
				}
				if (filter.limit>100) {
					filter.limit = 100;
				}
				// sort
				filter = this.getFilterSort(filter, ctx);

				return ctx.call("products.find", filter)
					.then(categoryProducts => {
						categoryProducts.forEach((product, i) => {
							categoryProducts[i] = this.priceByUser(product, ctx.meta.user);
						});

						let result = {
							"categories": categories,
							"results": categoryProducts
						};

						if (typeof ctx.params.minimalData !== "undefined" && ctx.params.minimalData==true) {
							return result;
						} else {
							return ctx.call("products.getMinMaxPrice", {
								categories: categories
							})
								.then(minMaxPrice => {
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
										})
										.catch(err => {
											this.logger.error("products.findWithCount count error:", err);
											return this.Promise.reject(new MoleculerClientError("Products findC count error", 422, "", []));
										});
								})
								.catch(err => {
									this.logger.error("products.findWithCount getMinMaxPrice error:", err);
									return this.Promise.reject(new MoleculerClientError("Products findC minmax error", 422, "", []));
								});
						}
					})
					.catch(err => {
						this.logger.error("products.findWithCount error:", err);
						return this.Promise.reject(new MoleculerClientError("Products findC error", 422, "", []));
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
								result = self.priceByUser(result, ctx.meta.user);
								result = self.getProductTaxData(
									result, 
									SettingsMixin.getSiteSettings("business")?.taxData
								);
							});
						}
						return results;
					})
					.catch(err => {
						this.logger.error("products.findWithId find error:", err);
						return this.Promise.reject(new MoleculerClientError("Products findI error", 422, "", []));
					});
			}
		},


		/**
		 * Get detail of product.
		 *
		 * @actions
		 * @param {String} product - product ID
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
				let edit = false;
				if (ctx.params.edit && ctx.params.edit=="true") {
					edit = true;
				}
				return this.adapter.findById(ctx.params.product)
					.then(found => {
						if (found) { // product found, return its basic data
							return this.detailActionAddBasicData(ctx, found, edit);
						} else { // no product found
							this.logger.info("products.detail - product not found");
							return Promise.reject(new MoleculerClientError("Product not found!", 400, "", [{ field: "product", message: "not found"}]));
						}
					})
					.catch(err => {
						this.logger.error("products.detail - found error:", err);
						return this.Promise.reject(new MoleculerClientError("Products detail error", 422, "", []));
					})
					.then(found => {
						// optional data
						if (found && typeof found.variationGroupId !== "undefined" && found.variationGroupId && found.variationGroupId.trim()!="") {
							// get Variations of this product
							return this.detailActionAddVariatonData(ctx, found);
						}
						return found;
					})
					.then(found => {
						if (found && typeof found.data!=="undefined" && found.data.related && found.data.related.products && found.data.related.products.length>0) {
							// get products Related to this product
							return this.detailActionAddRelatedData(ctx, found);
						}
						return found;
					});
			}
		},


		/**
		 * Get min&max price for category
		 * 
		 * @actions
		 * @param {Array.<String>} categories - categories ID
		 *
		 * @returns {Object} Product entity
		 */
		getMinMaxPrice: {
			// auth: "",
			params: {
				categories: { type: "array", items: "string" }
			},
			cache: {
				keys: ["categories"]
			},
			handler(ctx) {
				const categories = ctx.params.categories;
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
					})
					.catch(err => {
						this.logger.error("products.getMinMaxPrice error:", err);
						return this.Promise.reject(new MoleculerClientError("Products minmax error", 422, "", []));
					});
			}
		},


		/**
		 * Get properties for products of selected category/ries
		 * 
		 * @actions
		 * @param {Array.<String>} categories - categories ID
		 *
		 * @returns {Object} Product entity
		 */
		getCategoryProductsProperties: {
			// auth: "",
			params: {
				categories: { type: "array", items: "string" }
			},
			cache: {
				keys: ["categories"]
			},
			handler(ctx) {
				let categories = ctx.params.categories;
				this.logger.debug("product.getCategoryProductsProperties categories: ", categories);
				return this.adapter.collection.aggregate([
					{ "$match": {
						"categories": {"$in": categories}
					}},
					{ "$group": {
						"_id": null,
						"properties": { "$addToSet": "$properties" },
					}},
					{ "$limit": 600 }
				]).toArray()
					.then(catProps => {
						return this.processCategoryProductsProperties(catProps[0].properties);
					})
					.catch(err => {
						this.logger.error("products.getCategoryProductsProperties error:", err);
						return this.Promise.reject(new MoleculerClientError("Products getCategoryProductsProperties error", 422, "", []));
					});
			}
		},



		/**
		 * Import product data:
		 *  - products - with categories
		 *
		 * @actions
		 * @param {Array.<Object>} products - Array of product objects to import
		 *
		 * @returns {Array} Import results
		 */
	}
};
