"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { readdirSync, statSync } = require("fs");

// global mixins
const DbService = require("../../mixins/db.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");
const priceLevels = require("../../mixins/price.levels.mixin");
const FileHelpers = require("../../mixins/file.helpers.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const sppf = require("../../mixins/subproject.helper");

// methods
const PageMethodsCore = require("./methods/core.methods");
const PageMethodsHelpers = require("./methods/helpers.methods");


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
		DbService("pages"),
		CacheCleanerMixin([
			"cache.clean.pages"
		]),
		HelpersMixin,
		priceLevels,
		FileHelpers,
		// methods
		PageMethodsCore,
		PageMethodsHelpers,
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
				datePublish: { type: "date", optional: true },
				dateHide: { type: "date", optional: true },
			}},
			note: { type: "string", optional: true },
			activity: { type: "object", optional: true, props: {
				start: { type: "date", optional: true },
				end: { type: "date", optional: true }
			}},
		},

		// ------------- PAGES VARIABLES AND SETTINGS -------------

		paths: {
			resources: process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../resources")
		}
	},


	/**
	 * Actions
	 */
	actions: {
		/**
		 * Add item to user's cart
		 *
		 * @actions
		 * @param {Object} user - User entity
		 *
		 * @returns {Object} Created entity & token
		 */
		pagesList: {
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
							let categoriesToListPagesIn = [ctx.params.category];
							if (category.subsSlugs && category.subsSlugs.length>0) {
								categoriesToListPagesIn = category.subsSlugs;
								categoriesToListPagesIn.push(ctx.params.category);
							}
							if ( categoriesToListPagesIn.length<1 ) {
								categoriesToListPagesIn = [categoriesToListPagesIn];
							}


							// fix filter if needed
							let filter = { query: {}, limit: 100};
							if (typeof ctx.params.filter !== "undefined" && ctx.params.filter) {
								filter = ctx.params.filter;
								if (typeof filter.query === "undefined" || !filter.query) {
									filter.query = {};
								}
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
								"categories": { "$in": categoriesToListPagesIn }
							});
							query = this.filterOnlyActivePages(query, ctx);
							filter.query = query;

							// set max of results
							if (filter.limit>100) {
								filter.limit = 100;
							}
							if (typeof filter.sort === "undefined" || !filter.sort) {
								filter.sort = "-dates.dateUpdated";
							}

							return ctx.call("pages.find", filter)
								.then(categoryPages => {
									let result = {
										"categoryDetail": category,
										"results": categoryPages
									};

									// TODO - check if this can be removed, if data not already in category var
									return ctx.call("categories.findActive", {
										"query": {
											parentPathSlug: category.pathSlug
										}
									})
										.then(categoriesList => {
											result["categories"] = categoriesList;
											if ( JSON.stringify(filter.query) != "{\"categories\":{\"$in\":"+JSON.stringify(categoriesToListPagesIn)+"}}" ) {
												return ctx.call("pages.count", filter)
													.then(filteredPagesCount => {
														result["filteredPagesCount"] = filteredPagesCount;
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
		 * list templates
		 */
		listTemplates: {
			auth: "required",
			params: {
				page: { type: "string", min: 2 },
				query: { type: "object" },
				group: { type: "string", min: 2, optional: true },
				withPages: { type: "boolean", optional: true }
			},
			handler(ctx) {
				let withPages = true;
				if (typeof ctx.params.withPages !== "undefined" && !ctx.params.withPages) {
					withPages = false;
				}
				// TODO - use group default option;
				let path = this.settings.paths.resources+"/pages/_default";
				let dirs = readdirSync(path).filter(function (file) {
					return statSync(path+"/"+file).isDirectory();
				});
				this.logger.info("pages.listTemplates() - dirs", dirs);
				let pageIndex = dirs.indexOf(ctx.params.page);
				if (pageIndex>-1) {
					dirs.splice(pageIndex, 1);
				}
				this.logger.info("pages.listTemplates() - ctx.params.query.slug:", ctx.params.query.slug);
				dirs = dirs.filter(function(dir) {
					return dir.indexOf(ctx.params.query.slug.toLowerCase())>-1;
				});

				if (withPages) {
					// pages
					return ctx.call("pages.findWithId", {
						"query": {
							"slug": { "$regex": ctx.params.query.slug.toLowerCase() }
						}
					})
						.then(pages => {
							let results = dirs;
							if (pages && pages.length>0) {
								pages.some(function(page){
									if (page && page.slug) {
										results.push(page.slug);
									}
								});
							}
							// categories
							return ctx.call("categories.find", {
								"query": {
									"slug": { "$regex": ctx.params.query.slug.toLowerCase() }
								}
							})
								.then(categories => {
									if (categories && categories.length>0) {
										categories.some(function(category){
											if (category && category.slug) {
												results.push(":"+category.slug);
											}
										});
									}
									return results;
								});
							//return results;
						});
				} else {
					return dirs;
				}
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
				
				query = this.filterOnlyActivePages(query, ctx);
				filter.query = query;

				// if categories sent, use them
				let categories = [];
				if (ctx.params.query.categories && typeof ctx.params.query.categories["$in"] !== "undefined") {
					categories = ctx.params.query.categories["$in"];
				}
				// if categories sent, use them
				let pages = [];
				if (ctx.params.query.pages && typeof ctx.params.query.pages["$in"] !== "undefined") {
					pages = ctx.params.query.pages["$in"];
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
				filter.sort = "-dates.dateUpdated";
				if (typeof ctx.params.sort !== "undefined" && ctx.params.sort) {
					filter.sort = ctx.params.sort;
				}

				this.logger.info("pages.findWithCount - filter", JSON.stringify(filter));
				return ctx.call("pages.find", filter)
					.then(categoryPages => {
						let result = {
							"categories": categories,
							"pages": pages,
							"results": categoryPages
						};

						if (typeof ctx.params.minimalData !== "undefined" && ctx.params.minimalData==true) {
							return result;
						} else {
							// count pages inside this category and its subcategories
							return ctx.call("pages.count", {
								"query": filter.query
							})
								.then(pagesCount => {
									result["filteredPagesCount"] = pagesCount;
									return result;
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
				});
			}
		},


		/**
		 * Get detail of page.
		 *
		 * @actions
		 *
		 * @returns {Object} Page entity
		 */
		detail: {
			// auth: "",
			params: {
				page: { type: "string", min: 2 }, 
				category: { type: "string", optional: true }, 
				lang: { type: "string", min: 2, optional: true } 
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				let lang = "en";
				if ( ctx.params.lang && ctx.params.lang.trim()!="" ) {
					lang = ctx.params.lang;
				}

				const tv = this.getTemplateVars(lang, ctx.params.page);
				
				return this.getPageDetail(ctx, tv)
				.catch(err => {
					this.logger.error('pages.detail error:', err);
					return err;
				});
			}
		},




		/**
		 * Get list of available tags
		 *
		 * @returns {Object} Tag list
		 */
		// tags: {
		// 	cache: {
		// 		keys: []
		// 	},
		// 	handler() { //(ctx)
		// 		return this.Promise.resolve()
		// 			.then(() => this.adapter.find({ fields: ["tagList"], sort: ["dates.dateCreated"] }))
		// 			.then(list => {
		// 				return _.uniq(_.compact(_.flattenDeep(list.map(o => o.tagList))));
		// 			})
		// 			.then(tags => ({ tags }));
		// 	}
		// },



		/**
		 * Import page data:
		 *  - pages - with categories
		 *
		 * @actions
		 *
		 * @returns {Object} Page entity
		 */
		import: {
			auth: "required",
			params: {
				pages: { type: "array", items: "object", optional: true },
			},
			cache: false,
			handler(ctx) {
				this.logger.info("pages.import - ctx.meta");
				let pages = ctx.params.pages;
				let promises = [];
				let self = this;

				if (ctx.meta.user.type=="admin") {
					if ( pages && pages.length>0 ) {
						// loop pages to import
						pages.forEach(function(entity) {
							promises.push(
								// add page results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										return self.importPageAction(ctx, entity, found);
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
		 * Delete page data by id
		 *
		 * @actions
		 *
		 * @returns {Object} Page entity
		 */
		delete: {
			auth: "required",
			params: {
				pages: { type: "array", items: "object", optional: true },
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				this.logger.info("pages.delete ctx.meta", ctx.meta);
				let pages = ctx.params.pages;
				let promises = [];
				let self = this;

				if (ctx.meta.user.type=="admin") {
					if ( pages && pages.length>0 ) {
						// loop pages to import
						pages.forEach(function(entity) {
							promises.push(
								// add page results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										if (found) { // page found, delete it
											self.logger.info("pages.delete - DELETING page: ", found);
											return ctx.call("pages.remove", {id: found._id} )
												.then((deletedCount) => {
													// after call action
													ctx.meta.afterCallAction = {
														name: "page delete",
														type: "render",
														data: {
															url: self.getRequestData(ctx)
														}
													};

													self.logger.info("pages.delete - deleted page Count: ", deletedCount);
													return deletedCount;
												}); // returns number of removed items
										} else {
											self.logger.error("pages.delete - entity.id "+entity.id+" not found");
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


		updatePageImage: {
			auth: "required",
			params: {
				data: { type: "object" },
				params: { type: "object" }
			},
			handler(ctx) {
				if (ctx.params.params && ctx.params.params.slug) {
					this.logger.info("page.updatePageImage - has slug: ", ctx.params.params.slug);
					return;
				}
				return;
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
