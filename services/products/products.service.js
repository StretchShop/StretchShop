"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

// global mixins
const DbService = require("../../mixins/db.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");
const priceLevels = require("../../mixins/price.levels.mixin");

// methods
const ProductsMethodsCore = require("./methods/core.methods");
const ProductsMethodsHelpers = require("./methods/helpers.methods");

const sppf = require("../../mixins/subproject.helper");
const resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../resources");
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
		}
	},


	/**
	 * Actions
	 */
	actions: {

		/**
		 * disable cache for find action
		 */
		// find: {
		// 	cache: false
		// },



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
				let filter = ctx.params;
				this.logger.info("products.find filter:", filter);
				let self = this;
				this.fixRequestIds(filter);
				return this.adapter.find(filter)
					.then( results => {
						if (results && results.length>0) {
							results.forEach(result => {
								result = self.priceByUser(result, ctx.meta.user);
								result = self.getProductTaxData(result, businessSettings.taxData);
							});
						}
						this.logger.info("products.find results after:", results);
						return results;
					})
					.catch(e => {
						this.logger.error("products.find error:", e);
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
							category["taxData"] = businessSettings.taxData.global;

							// fix filter if needed
							let filter = { query: {}, limit: 100};
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
		 * Gets page of products by filter 
		 * with count of total that match filter
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
								result = self.priceByUser(result, ctx.meta.user);
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
						this.logger.error("products.detail - found error", err);
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


		/**
		 * After image for product was uploaded
		 * @actions
		 * 
		 * @param {object} data
		 * @param {object} params
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
		},


		/**
		 * External product price level rebuild
		 * @actions
		 * @param {string} id - product id
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
							);
						}
						return Promise.all(promisesChunks).then(chunks => {
							for (let i=0; i<chunks.length; i++) {
								result.products = result.products.concat(chunks[i]);
							}
							return result;
						});
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
