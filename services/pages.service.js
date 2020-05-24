"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

const { readdirSync, statSync, existsSync } = require("fs");
const pathResolve = require("path").resolve;

const DbService = require("../mixins/db.mixin");
const FileHelpers = require("../mixins/file.helpers.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");
const sppf = require("../mixins/subprojpathfix");

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
		FileHelpers,
		CacheCleanerMixin([
			"cache.clean.pages"
		])
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
			activity: { type: "number", optional: true },
		},

		// ------------- PAGES VARIABLES AND SETTINGS -------------

		paths: {
			resources: process.env.PATH_RESOURCES || sppf.subprojpathfix(__dirname, "/../resources")
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
				listSubs: { type: "boolean", optional: true },
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
							// set categories if from detail
							filter["query"]["categories"] = {
								"$in": categoriesToListPagesIn
							};
							// set max of results
							if (filter.limit>100) {
								filter.limit = 100;
							}
							if (typeof filter.sort === "undefined" || !filter.sort) {
								filter.sort = "price";
							}

							return ctx.call("pages.find", filter)
								.then(categoryPages => {
									let result = {
										"categoryDetail": category,
										"results": categoryPages
									};

									// TODO - check if this can be removed, if data not already in category var
									return ctx.call("categories.find", {
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
							return results;
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
				filter.sort = "price";
				if (typeof ctx.params.sort !== "undefined" && ctx.params.sort) {
					filter.sort = ctx.params.sort;
				}

				this.logger.info("pages.findWithCount - filter", filter);
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
				let self = this;
				let lang = "en";
				if ( ctx.params.lang && ctx.params.lang.trim()!="" ) {
					lang = ctx.params.lang;
				}

				let pageSlugArray = ctx.params.page.split("---");
				let pageName = pageSlugArray[0];
				let templateName = "_default";
				if ( pageSlugArray.length>1 ) {
					templateName = pageSlugArray[1];
				}
				let parentDir = this.settings.paths.resources+"/pages/"+templateName+"/"+pageName+"/";
				parentDir = this.removeParentTraversing(parentDir);
				let filepath = parentDir+pageName+"-"+lang+".html";
				filepath = pathResolve(filepath);

				// use default template if more relevant not found
				if ( !existsSync(filepath) ) {
					pageName = "default";
					parentDir = this.settings.paths.resources+"/pages/"+templateName+"/default/";
					parentDir = this.removeParentTraversing(parentDir);
					filepath = parentDir+"default-"+lang+".html";
				}
				
				// get template for that page
				return self.getCorrectFile(filepath)
					.then( (template) => {
						let result = { 
							body: template, 
							data: null, 
							global: {}, 
							staticData: null 
						};
						// get template static metadata
						// TODO - check if exists, if not, set default value {}
						return self.readFile(parentDir+pageName+".json")
							.then( (staticData) => {
								// return static metadata
								staticData = JSON.parse(staticData);
								result.staticData = staticData;
								return result;
							})
							.catch( err => {
								this.logger.error("pages.detail - readFile error: ", err);
							})
							.then( result => {
								// check if WYSIWYG editor placeholder exists in string
								let regex = /<!-- {{editor_WYSIWYG}} \/\/-->/gmi, regExResult, occurences = [];
								while ( (regExResult = regex.exec(result.body)) ) {
									occurences.push(regExResult.index);
								}
								// if WYSIWYG exists, check for record in page table
								if ( occurences.length>0 ) {
									return self.adapter.find({
										"query": {
											"slug": ctx.params.page
										}
									})
										.then(page => {
											// if WYSIWYG found, take first record
											if ( page && page.length>0 && typeof page[0] !== "undefined" ) {
												page = page[0];
											}
											// if WYSIWYG found, place first block
											if (page && page.data && page.data.blocks && page.data.blocks.length>0) {
												result.body = result.body.replace(
													"<!-- {{editor_WYSIWYG}} //-->",
													"<div data-editable data-name=\"content\">"+page.data.blocks[0][ctx.params.lang]+"</div>"
												);
											}
											// set page data into result
											result.data = page;
											return result;
										})
										.then( result => {
											// TODO - move into separate function
											// preparing to get parent category for breadcrumbs
											let category = null;
											// check what data for categories will be used
											let hasStaticCategories = ( result.staticData && result.staticData.categories && result.staticData.categories.length>0 );
											if ( hasStaticCategories ) {
												category = result.staticData.categories[0];
											}
											let hasCategories = ( result.data && result.data.categories && result.data.categories.length>0 );
											if ( hasCategories ) {
												category = result.data.categories[0];
											} 
											result.global.usedCategories = hasStaticCategories ? "static" : "dynamic";
											result.global.parentCategorySlug = category;
											//
											let pages = []; 
											// check what pages will be used
											let hasStaticPages = ( result.staticData && result.staticData.pages && result.staticData.pages.length>0 );
											if ( hasStaticPages ) {
												pages = result.staticData.pages;
											}
											let hasPages = ( result.data && result.data.pages && result.data.pages.length>0 );
											if ( hasPages ) {
												pages = result.data.pages;
											} 
											//
											if (ctx.params.category && (hasStaticCategories || hasCategories)) {
												return ctx.call("categories.detail", {
													categoryPath: category,
													type: "pages"
												})
													.then(parentCategoryDetail => {
														result = this.pageGlobalResultHelper_ParentCat(
															result, 
															parentCategoryDetail, 
															[hasCategories, hasStaticCategories]
														);
														// get related pages
														return ctx.call("pages.find", {
															"query": {
																"slug": {"$in": pages}
															}
														})
															.then(relatedPages => {
																result.global.relatedPage = pages;
																result.global.relatedPageObjects = relatedPages;
																return result;
															});
													});
											} else {
												return this.pageGlobalResultHelper_ParentCat(
													result, 
													null, 
													[hasCategories, hasStaticCategories]
												);
											}
										})
										.then( result => {
											let resultWithFunctions = self.checkAndRunPageFunctions(ctx, result.data, ctx.params.lang);
											if (resultWithFunctions && typeof resultWithFunctions.then == "function") {
												return resultWithFunctions.then(functions => {
													result.data.functions = functions;
													return result;
												});
											} else {
												result.data.functions = [];
												return result;
											}
										});
								}

								// no WYSIWYG in template, just try to use most you can
								if ( result && result.staticData && result.staticData.pages && result.staticData.pages.length>0 ) {
									// get related pages
									return ctx.call("pages.find", {
										"query": {
											"slug": {"$in": result.staticData.pages}
										}
									})
										.then(relatedPages => {
											result.global.relatedPage = result.staticData.pages;
											result.global.relatedPageObjects = relatedPages;
											return result;
										});
								}
								return result;
							});
					})
					.catch( error => {
						this.logger.error("pages.detail - error:", error);
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
										if (found) { // page found, update it

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
													self.logger.info("pages.import found - update entity:", entity);
													let entityId = entity.id;
													delete entity.id;
													const update = {
														"$set": entity
													};
													return self.adapter.updateById(entityId, update)
														.then(doc => self.transformDocuments(ctx, {}, doc))
														.then(json => self.entityChanged("updated", json, ctx).then(() => json));
												});
										} else { // no page found, create one
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
													return ctx.call("pages.find", {
														"query": {
															slug: entity.slug
														}
													})
														.then(slugFound => {
															if (slugFound && slugFound.constructor !== Array) {
																self.logger.error("pages.import notFound - insert - slugFound entity:", entity);
																return { "error" : "Slug "+entity.slug+" already used." };
															}

															// TODO - check if slug paths don't already exist
															if (ctx.meta.user && ctx.meta.user.email) {
																entity.publisher = ctx.meta.user.email.toString();
															}
															if (!entity.dates) {
																entity.dates = {};
															}
															entity.dates.dateCreated = new Date();
															entity.dates.dateUpdated = new Date();
															entity.dates.dateSynced = new Date();
															self.logger.info("pages.import - insert entity:", entity);

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
		
		pageGlobalResultHelper_ParentCat(result, parentCategoryDetail, options) {
			if (options[1]) { // hasStaticCategories
				result.staticData["parentCategoryDetail"] = parentCategoryDetail;
			}
			if (options[0]) { // hasCategories
				result.data["parentCategoryDetail"] = parentCategoryDetail;
			}
			result.global.parentCategoryDetail = parentCategoryDetail;
			return result;
		}, 

		/**
		 * Check if page code containes any functions placeholders
		 * if does, run them and return results
		 * 
		 * @param {*} page 
		 */
		checkAndRunPageFunctions(ctx, page, lang) {
			if ( page && page.data && page.data.blocks[0] && page.data.blocks[0][lang] ) {
				let pageFunctions = this.getPageFunctions(page.data.blocks[0][lang]);
				this.logger.info("pages.checkAndRunPageFunctions() - pageFunctions: ", pageFunctions);

				if (pageFunctions && pageFunctions.length>0) {
					let promises = [];
					for (let pfi in pageFunctions) {
						let pf = pageFunctions[pfi];
						if ( Object.prototype.hasOwnProperty.call(this.schema.methods, pf.method) ) {
							promises.push( this.schema.methods[pf.method](ctx, pf.params) );
						}
					}
					return Promise.all(promises).then((values) => {
						return values;
					});
				}
				return null;
			}
		},


		/**
		 * Get page functions form its content - eg. {{{getBestsellers(latest)}}}
		 * 
		 * @param {*} content 
		 */
		getPageFunctions(content) {
			let re = /\{\{\{(.*)\((.*)\)\}\}\}/g;
			let m;
			let results = [];
			
			do {
				m = re.exec(content);
				if (m) {
					let result = { 
						method: m[1], 
						params: m[2] 
					};
					if ( result.params.indexOf(";") > -1 ) {
						result.params = result.params.split(";");
					}
					results.push(result);
				}
			} while (m);

			return results;
		},


		getProductsById(ctx, orderCodes) {
			return ctx.call("products.find", {
				"query": {
					"orderCode": {"$in": orderCodes}
				}
			})
				.then(products => {
					if ( products && products.length>0 ) {
						let categoriesSlugs = [];
						products.forEach(function(product) {
							if ( product.categories && product.categories.length>0 ) {
								categoriesSlugs.push(...product.categories);
							}
						});
						return ctx.call("categories.find", {
							"query": {
								"pathSlug": {"$in": categoriesSlugs}
							}
						})
							.then(categories => {
								let catSlugsMap = {};
								for ( let i=0; i<categories.length; i++ ) {
									catSlugsMap[categories[i].pathSlug] = categories[i];
								}
								for ( let i=0; i<products.length; i++ ) {
									products[i]["categoriesData"] = {};
									for ( let j=0; j<products[i].categories.length; j++ ) {
										let catKey = products[i]["categories"];
										let catVal = catSlugsMap[catKey];
										products[i]["categoriesData"][catKey] = catVal;
									}
								}
								return {
									name: "getProductsById",
									data: products,
									template: "ProductBox"
								};
							});
					} else {
						return {
							name: "getProductsById",
							data: products,
							template: "ProductBox"
						};
					}
				});
		}

	},

	events: {
		// "cache.clean.cart"() {
		// 	if (this.broker.cacher)
		// 		this.broker.cacher.clean(`${this.name}.*`);
		// }
	}
};
