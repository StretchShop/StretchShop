"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

//const crypto 		= require("crypto");

const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

/**
 * Category represents ...
 */

module.exports = {
	name: "categories",
	mixins: [
		DbService("categories"),
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
			activity: { type: "number", optional: true },
		}
	},


	/**
	 * Actions
	 */
	actions: {
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
				return ctx.call('categories.detail', { categoryPath: ctx.params.category })
					.then(category => {
						// 1. category exists
						if (category) {
							return ctx.call("products.find", {
								"query": {"parentPathSlug": ctx.params.category}
							})
							.then(categoryProducts => {
								return categoryProducts;
							});
						}
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
									"parentPath": {"$in": [found.slug]}
								}
							})
							.then(subs => {
								let childParentPath = [];
								if (found.parentPath && found.parentPath.length>0) {
									childParentPath = found.parentPath.slice();
								}
								childParentPath.push(found.slug);
								subs = this.extractChildCategoriesByArrayOrder(subs, childParentPath);
								// TODO - make function that picks only those categories,
								// that have categories ordered like this category
								found['subs'] = subs;
								found['subsSlugs'] = this.getAllPathSlugs(subs);
								return found;
							});
						} else { // no category found, create one
							return Promise.reject(new MoleculerClientError("Category not found!", 400, "", [{ field: "product", message: "not found"}]));
						}
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
				console.log('--- import categories ---');
				let categories = ctx.params.categories;
				let promises = [];
				let mythis = this;

				if (ctx.meta.user.type=='admin') {
					if ( categories && categories.length>0 ) {
						// loop products to import
						categories.forEach(function(entity) {
							promises.push(
								// add product results into result variable
								mythis.adapter.findById(entity.id)
									.then(found => {
										if (found) { // product found, update it
											return mythis.validateEntity(entity)
												.then(() => {
  												console.log("found: ", entity);
  												if (!entity.dates) {
  													entity.dates = {};
  												}
  												entity.dates.dateUpdated = new Date();
  												entity.dates.dateSynced = new Date();
                          let entityId = entity.id;
                          delete entity.id;
          								const update = {
          									"$set": entity
          								};
  												return mythis.adapter.updateById(entityId, update);
												});
										} else { // no product found, create one
											return mythis.validateEntity(entity)
												.then(() => {
													console.log("new: ", entity);

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
														console.log("\n\n*********************** category.import.slugFound:",slugFound);
														if (slugFound && slugFound.constructor !== Array) {
															return { 'error' : "Slug "+entity.slug+" already used." };
														}

														if ( !entity.parentPathSlug || entity.parentPathSlug.trim() == "") {
															entity.parentPathSlug = slug(entity.parentPath.join('-'), { lower: true });
														}
														entity.pathSlug = entity.slug;
														if ( entity.slug && entity.parentPathSlug ) {
															entity.pathSlug = entity.parentPathSlug +'-'+ entity.slug;
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

														return mythis.adapter.insert(entity)
														.then(doc => mythis.transformDocuments(ctx, {}, doc))
														.then(json => mythis.entityChanged("created", json, ctx).then(() => json));
												});
											});
										} // else end
									})); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises).then(prom => {
						console.log("\n\n------------import prom---:", prom);
					  return prom;
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
				console.log('--- delete categories ---');
				let categories = ctx.params.categories;
				let promises = [];
				let mythis = this;

				if (ctx.meta.user.type=='admin') {
					if ( categories && categories.length>0 ) {
						// loop products to import
						categories.forEach(function(entity) {
							promises.push(
								// add product results into result variable
								mythis.adapter.findById(entity.id)
									.then(found => {
										if (found) { // product found, update it
	                    console.log("DELETING category "+found._id);
											return ctx.call("categories.remove", {id: found._id} )
	                    .then((deletedCount) => {
	                      console.log("deleted category Count: ",deletedCount);
	                      return deletedCount;
	                    }); // returns number of removed items
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
			}
		},



	}, // *** actions end




	/**
	 * Methods
	 */
	methods: {
		// get only categories that match parent category order
		extractChildCategoriesByArrayOrder(childCategories, masterArray) {
			let result = [];

			for (var i=0; i<childCategories.length; i++) {
				let addChild = true;
				for (var j=0; j<masterArray.length; j++) {
					console.log( " ----- ----- ----- ----- ----- " );
					console.log( childCategories[i].parentPath[j] +" != "+ masterArray[j] );
					if ( childCategories[i].parentPath[j] != masterArray[j] ) {
						addChild = false;
					}
				}
				if (addChild) {
					result.push(childCategories[i]);
				}
			}

			return result;
		},

		// return slugs of all items in array
		getAllPathSlugs(slugsToList) {
			let result = [];

			for (var i=0; i<slugsToList.length; i++) {
				if (slugsToList[i].pathSlug) {
					result.push(slugsToList[i].pathSlug);
				}
			}

			return result
		},

		// create all parent paths
		getAllParentPathsOfCategory(categoryParentPathsArray) {
			let results = [];

			if (categoryParentPathsArray && categoryParentPathsArray.length>0) {
				let latestPath = [];
				for (var i=0; i<categoryParentPathsArray.length; i++) {
					latestPath.push( categoryParentPathsArray[i] );
					results.push( slug(latestPath.join('-')) );
				}
			}

			return results;
		}
	},

	events: {
		// "cache.clean.cart"() {
		// 	if (this.broker.cacher)
		// 		this.broker.cacher.clean(`${this.name}.*`);
		// }
	}
};
