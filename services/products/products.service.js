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
		DbService("products"),
		CacheCleanerMixin([
			"cache.clean.products"
		]),
		HelpersMixin,
		priceLevels,
		// methods
		ProductsMethodsCore,
		ProductsMethodsHelpers,
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


	/**
	 * Actions
	 */
	actions: {

		/**
		 * Find products - endpoint NOT for listing but only to find products
		 * mostly for autocomplete menus
		 * 
		 * @actions
		 * 
		 * @param {Array} populate - 
		 * @param {Array} fields - 
		 * @param {Number} limit - Limit
		 * @param {Number} offset - Offset
		 * @param {String} sort - Sorting string
		 * @param {String} search - 
		 * @param {String} searchFields - 
		 * @param {Object} query - Main query
		 * 
		 * @returns {Array.<Object>} List of products with additional data
		 */
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
				if (!ctx.params) { ctx.params = { limit: 10 } }
				if (!ctx.params?.limit || ctx.params?.limit > 100) {
					ctx.params.limit = 100;
				}
				let filter = ctx.params;
				let self = this;
				this.logger.info("products.find filter before FRI:", JSON.stringify(filter));
				this.fixRequestIds(filter);
				this.logger.info("products.find filter after FRI:", JSON.stringify(filter));
				return this.adapter.find(filter)
					.then( results => {
						// this.logger.info("products.find results before:", results);
						if (results && results.length>0) {
							results.forEach(result => {
								result = self.priceByUser(result, ctx.meta.user);
								result = self.getProductTaxData(
									result, 
									SettingsMixin.getSiteSettings('business')?.taxData
								);
							});
						}
						// this.logger.info("products.find results after:", results);
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
					}
				}
				return ctx.call('products.productsList', params)
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
							category["taxData"] = SettingsMixin.getSiteSettings('business')?.taxData?.global;

							// fix filter if needed
							let filter = { query: {}, limit: 30};
							if (typeof ctx.params.filter !== "undefined" && ctx.params.filter) {
								filter = ctx.params.filter;
							}

							// add queries to $and array
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
										})
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
				if ( ctx.params.query.categories && typeof ctx.params.query.categories["$in"] !== "undefined") {
					categories = ctx.params.query.categories["$in"];
				}

				// add queries to $and array
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
				query = this.filterOnlyActiveProducts(query, ctx.meta.user);
				filter.query = query;

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
									SettingsMixin.getSiteSettings('business')?.taxData
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
		import: {
			auth: "required",
			params: {
				products: { type: "array", items: "object", optional: true },
			},
			cache: false,
			handler(ctx) {
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
										return self.importProductAction(ctx, entity, found);
									})
									.catch(err => {
										this.logger.error("products.import find error:", err);
										return this.Promise.reject(new MoleculerClientError("Products import find error", 422, "", []));
									})); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises)
						.then(prom => {
							return prom;
						})
						.catch(err => {
							this.logger.error("products.import promises error:", err);
							return this.Promise.reject(new MoleculerClientError("Products import all error", 422, "", []));
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
		 * @param {Array.<Object>} products - Array of product objects to delete
		 *
		 * @returns {Array} Delete results
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
											const orderCode = found?.orderCode?.toString().trim();
											self.logger.info("products.delete - DELETING product: ", found);
											return ctx.call("products.remove", {id: found._id} )
												.then((deletedCount) => {

													// delete product assets
													const pageBaseDir = self.settings.paths.assets +"/"+ process.env.ASSETS_PATH +"pages/";
													self.logger.info("product.delete - deleted product - before assets deleted for product slug: ", orderCode);
													if (orderCode) {
														const chunkedCode = self.stringChunk(orderCode, process.env.CHUNKSIZE_PRODUCT || 3);
														const productDir = pageBaseDir + chunkedCode;
														rmSync(productDir, { recursive: true, force: true });
													}

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
												})
												.catch(err => {
													self.logger.error("products.delete products.remove error:", err);
													return this.Promise.reject(new MoleculerClientError("Products delete remove error", 422, "", []));
												}); // returns number of removed items
										} else {
											self.logger.error("products.delete - entity.id "+entity.id+" not found");
										}
									})
									.catch(err => {
										this.logger.error("products.delete find error:", err);
										return this.Promise.reject(new MoleculerClientError("Products delete find error", 422, "", []));
									})); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises)
						.then(() => {
							return promises;
						})
						.catch(err => {
							this.logger.error("products.delete promises error:", err);
							return this.Promise.reject(new MoleculerClientError("Products delete all error", 422, "", []));
						});
				} else { // not admin user
					return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
				}
			} // handler end
		},


		/**
		 * After image for product was uploaded
		 * @actions
		 * 
		 * @param {object} data
		 * @param {object} params
		 * 
		 * @returns none
		 */
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
							})
							.catch(err => {
								this.logger.error("products.updateProductImage error:", err);
							});
					}
				}
				return;
			}
		},


		/**
		 * Check product authorship
		 * 
		 * @actions
		 * @param {Object} data - product data to check
		 * 
		 * @returns {Boolean}
		 */ 
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
		},


		/**
		 * External product price level rebuild
		 * @actions
		 * @param {string} id - product id
		 * 
		 * @returns {Object} - rebuilded product with new price levels
		 */
		rebuildProductPriceLevels: {
			auth: "required",
			params: {
				id: { type: "string" }
			},
			handler(ctx) {
				if ( ctx.meta.user && ctx.meta.user.type=="admin" ) { // TODO - add user verification for author
					let ids = [];
					ids.push(ctx.params.id);
					return ctx.call("products.rebuildProducts", {
						limit: 1,
						ids: ids
					})
						.then(rebuildSuccess => {
							if (rebuildSuccess && rebuildSuccess.products && rebuildSuccess.products[0]) {
								return rebuildSuccess.products[0];
							}
							return null;
						})
						.catch(err => {
							this.logger.error("products.rebuildProductPriceLevels products.rebuildProducts error:", err);
							return this.Promise.reject(new MoleculerClientError("Products levels rebuild error", 422, "", []));
						});
				} else {
					return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
				}
			}
		},

		
		/**
		 * Internal action to rebuild products
		 * DON'T MAKE this action AVAILABLE from your API
		 * until you know what you're doing. Rather use
		 * mol $ call products.rebuildProducts
		 * 
		 * @actions
		 * @param {number} limit - maximum number of records to work with (paging)
		 * @param {number} from - offset to read records from
		 * @param {array} ids - array of record ids {string(s)}
		 * 
		 * @returns {Object} - rebuilded products with count
		 */
		rebuildProducts: {
			params: {
				limit: { type: "number", optional: true },
				offset: { type: "number", optional: true },
				ids: { type: "array", optional: true, items: { type: "string" } }
			},
			handler(ctx) {
				let chunkSize = 100;
				let limit = (typeof ctx.params.limit !== "undefined") ?  ctx.params.limit : null;
				let offset = (typeof ctx.params.offset !== "undefined") ?  ctx.params.offset : 0;
				let ids = (typeof ctx.params.ids !== "undefined") ?  ctx.params.ids : null;
				let self = this;
				let result = {
					count: 0,
					products: []
				};
				let promisesChunks = [];

				let filter = { query: {} };
				// add ids
				if (ids) { 
					let idsObjs = [];
					ids.forEach(id => {
						idsObjs.push(self.fixStringToId(id));
					});
					filter.query = {
						_id: { "$in": idsObjs }
					};
				}
				// filter
				// add limit and offset
				if (limit && limit!=null) {
					filter.limit = limit;
				}
				filter.offset = offset;

				return ctx.call("products.count", filter)
					.then(filteredProductsCount => {
						result.count = filteredProductsCount;

						const chunksCount = Math.ceil(filteredProductsCount / limit);
						// filter - set chunk size
						filter.limit = chunkSize;

						// start selecting the chunks
						for (let i=0; i<chunksCount; i++) {
							// filter - set where chunk should start
							filter.offset = chunkSize * i;
							// create chunk data block
							promisesChunks.push(
								ctx.call("products.find", filter)
									.then(products => {
										return this.rebuildProductChunks(products);
									})
									.catch(err => {
										this.logger.error("products.rebuildProducts products.find error:", err);
										return this.Promise.reject(new MoleculerClientError("Products rebuild findP error", 422, "", []));
									})
							);
						}
						return Promise.all(promisesChunks)
							.then(chunks => {
								for (let i=0; i<chunks.length; i++) {
									result.products = result.products.concat(chunks[i]);
								}
								return result;
							})
							.catch(err => {
								this.logger.error("products.rebuildProducts promises error:", err);
								return this.Promise.reject(new MoleculerClientError("Products rebuild all error", 422, "", []));
							});
					})
					.catch(err => {
						this.logger.error("products.rebuildProducts count error:", err);
						return this.Promise.reject(new MoleculerClientError("Products rebuild count error", 422, "", []));
					});
				
			}
		},


	}, // *** actions end




	/**
	 * Core methods required by this service are located in
	 * /methods/code.methods.js
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
