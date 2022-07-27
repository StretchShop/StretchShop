"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

const slug = require("slug");

module.exports = {

	/**
	 * Methods
	 */
	methods: {


		/**
		 * Basic logic for importing a page
		 * 
		 * @param {Object} ctx - context data
		 * @param {Object} entity - entity sent
		 * @param {Object} found - found record of object
		 * @returns 
		 */
		importPageAction(ctx, entity, found) {
			let self = this;

			if (found) { // page found, update it
				if ( entity ) {
					if ( entity.dates ) {
						Object.keys(entity.dates).forEach(function(key) {
							let date = entity.dates[key];
							if ( date && date!=null && date.trim()!="" ) {
								entity.dates[key] = new Date(entity.dates[key]);
							}
						});
					}
					if ( entity.activity ) {
						Object.keys(entity.activity).forEach(function(key) {
							let date = entity.activity[key];
							if ( date && date!=null && date.trim()!="" ) {
								entity.activity[key] = new Date(entity.activity[key]);
							}
						});
					}
				}
				// update existing page from entity
				entity.data.blocks = this.unJsString(entity.data.blocks);
				return self.importPageActionUpdateFound(ctx, entity);

			} else { // no page found, create one
				return self.validateEntity(entity)
					.then(() => {
						// create new page from entity
						entity.data.blocks = this.unJsString(entity.data.blocks);
						return self.importPageActionCreateNew(ctx, entity);
					})
					.catch(err => {
						self.logger.error("pages import insert validateEntity err:", err);
					});
			}
		},


		/**
		 * Update existing product using entity object from param.
		 * Part of import action
		 * 
		 * @param {Object} ctx 
		 * @param {Object} entity 
		 * @returns 
		 */
		importPageActionUpdateFound(ctx, entity) {
			let self = this;

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

					// after call action
					ctx.meta.afterCallAction = {
						name: "page update",
						type: "render",
						data: {
							url: self.getRequestData(ctx)
						}
					};

					return self.adapter.updateById(entityId, update)
						.then(doc => self.transformDocuments(ctx, {}, doc))
						.then(json => self.entityChanged("updated", json, ctx).then(() => json));
				})
				.catch(err => {
					self.logger.error("pages import update validateEntity err:", err);
				});
		},




		/**
		 * Create new page using entity object from param.
		 * Part of import action
		 * 
		 * @param {Object} ctx 
		 * @param {Object} entity 
		 * @returns Object
		 */
		importPageActionCreateNew(ctx, entity) {
			let self = this;

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

					// after call action
					ctx.meta.afterCallAction = {
						name: "page insert",
						type: "render",
						data: {
							url: self.getRequestData(ctx)
						}
					};

					return self.adapter.insert(entity)
						.then(doc => self.transformDocuments(ctx, {}, doc))
						.then(json => self.entityChanged("created", json, ctx).then(() => json));
				});
		},
		


		/**
		 * Getting page detail consists of two steps:
		 * 1. getting the right template and related data.
		 * 2. get data from DB if any exists and process them with template.
		 * 
		 * @param {Object} ctx - context data
		 * @param {*} tv - template variables
		 * @returns Object - complete page detail data
		 */
		getPageDetail(ctx, tv) {
			let self = this;

			// get template for that page
			return self.getCorrectFile(tv.filepath)
				.then( (template) => {
					let result = { 
						body: template, 
						data: null, 
						global: {}, 
						staticData: null 
					};
					// get template static metadata
					// TODO - check if exists, if not, set default value {}
					return self.readFile(tv.parentDir + tv.pageName+".json")
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
								return this.processPageWysiwygContent(ctx, result);
							}

							// check if page requires user to have some product
							if ( 
								!(ctx.meta && ctx.meta.user && ctx.meta.user.type === "admin") && 
								result && result.staticData?.data?.requirements?.userdata?.products?.length > 0 
							) {
								// if we have user, check his contentDependencies
								if ( ctx.meta.user && ctx.meta.user.data?.contentDependencies?.list?.length > 0 ) {
									// get intersection of user and page contentDependencies 
									const filteredArray = result.staticData.data.requirements.userdata.products.filter(value => ctx.meta.user.data.contentDependencies.list.includes(value));
									if ( filteredArray.length <= 0 ) {
										return Promise.reject(new MoleculerClientError("Page not found!", 403, "", [{ field: "page", message: "forbidden", data: { orderCodes: filteredArray } }]));
									}
								} else {
									// no user, page cannot be displayed
									return Promise.reject(new MoleculerClientError("Page not found!", 401, "", [{ field: "page", message: "unauthorized", data: { orderCodes: result.staticData?.data?.requirements?.userdata?.products } }]));
								}
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
		},



		/**
		 * Process dynamic data:
		 * - dates
		 * - WYSIWYG
		 * - other related data
		 * 
		 * @param {Object} ctx 
		 * @param {Object} result 
		 * @returns Promise
		 */
		processPageWysiwygContent(ctx, result) {
			let self = this;

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

					// check if page requires user to have some product
					if ( 
						!(ctx.meta && ctx.meta.user && ctx.meta.user.type === "admin") && 
						page.data?.requirements?.userdata?.products?.length > 0 
					) {
						// if we have user, check his contentDependencies
						this.logger.info("pages core processPageWysiwygContent() user:", ctx.meta.user);
						if ( ctx.meta.user && ctx.meta.user.data?.contentDependencies?.list?.length > 0 ) {
							// get intersection of user and page contentDependencies 
							const filteredArray = page.data.requirements.userdata.products.filter(value => ctx.meta.user.data.contentDependencies.list.includes(value));
							this.logger.info("pages core processPageWysiwygContent() filteredArray:", filteredArray);
							if ( filteredArray.length <= 0 ) {
								return Promise.reject(new MoleculerClientError("Page not found!", 403, "", [{ field: "page", message: "forbidden", data: { orderCodes: filteredArray } }]));
							}
						} else {
							// no user, page cannot be displayed
							return Promise.reject(new MoleculerClientError("Page not found!", 401, "", [{ field: "page", message: "unauthorized", data: { orderCodes: page.data?.requirements?.userdata?.products } }]));
						}
					}

					// check dates
					if ( ctx.meta.user && ctx.meta.user.type!="admin" && 
						ctx.meta.user.email!=page.publisher && page.activity && 
						((page.activity.start && page.activity.start!=null) || 
						(page.activity.end && page.activity.end))
					) {
						let now = new Date();
						if (page.activity.start) {
							let startDate = new Date(page.activity.start);
							if (startDate > now) { // not started
								this.logger.info("page.detail - page not active (start)");
								return Promise.reject(new MoleculerClientError("Page not found!", 400, "", [{ field: "page", message: "not found"}]));
							}
						}
						if (page.activity.end) {
							let endDate = new Date(page.activity.end);
							if (endDate < now) { // ended
								this.logger.info("page.detail - page not active (end)");
								return Promise.reject(new MoleculerClientError("Page not found!", 400, "", [{ field: "page", message: "not found"}]));
							}
						}
					}

					// if WYSIWYG found, place first block
					if (page && page.data && page.data.blocks && page.data.blocks.length>0) {
						result.body = result.body.replace(
							"<!-- {{editor_WYSIWYG}} //-->",
							"<div data-editable data-name=\"content\">"+page.data.blocks[0][ctx.params.lang]+"</div>"
						);
					} else {
						result.body = result.body.replace(
							"<!-- {{editor_WYSIWYG}} //-->",
							""
						);
					}
					// set page data into result
					result.data = page;
					return result;
				})
				.catch(err => {
					this.logger.error('xxxxx ERR:', err);
					return err;
				})
				.then( result => {
					return this.processPageDetailResult(ctx, result);
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
		},



		/**
		 * Process related data for displaying:
		 * - categories
		 * - pages
		 * - related items
		 * - urls
		 * 
		 * @param {Object} ctx 
		 * @param {Object} result 
		 */
		processPageDetailResult(ctx, result) {
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
			if (typeof result.global === "undefined") {
				result.global = {};
			}
			result.global.usedCategories = hasStaticCategories ? "static" : "dynamic";
			result.global.parentCategorySlug = category;
			//
			let pagesTemp = [];
			// check what pages will be used
			let hasStaticPages = ( result.staticData && result.staticData.pages && result.staticData.pages.length>0 );
			if ( hasStaticPages ) {
				pagesTemp = result.staticData.pages;
			}
			let hasPages = ( result.data && result.data.pages && result.data.pages.length>0 );
			if ( hasPages ) {
				pagesTemp = result.data.pages;
			} 
			// fill related items
			let pages = [];
			let categories = [];
			let urls = [];
			if (pagesTemp.length>0) {
				pagesTemp.forEach(p => {
					if (p.substring(0,8)=="https://" || p.substring(0,7)=="http://" || p.substring(0,7)=="./" || p.charAt(0)=="/") {
						urls.push(p);
					} else if (p.charAt(0)==":") {
						categories.push(p.substring(1));
					} else {
						pages.push(p);
					}
				});
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
								// get related categories
								return ctx.call("categories.find", {
									"query": {
										"slug": {"$in": categories}
									}
								})
									.then(relatedCategories => {
										result.global.relatedCat = categories;
										result.global.relatedCatObjects = relatedCategories;
										// urls
										result.global.relatedUrls = urls;
										return result;
									});
								//return result;
							});
					});
			} else {
				return this.pageGlobalResultHelper_ParentCat(
					result, 
					null, 
					[hasCategories, hasStaticCategories]
				);
			}
		},




		/**
		 * 
		 * @param {*} ctx 
		 * @param {*} orderCodes 
		 * @returns 
		 */
		getProductsById(ctx, orderCodes) {
			let self = this;
			return ctx.call("products.find", {
				"query": {
					"orderCode": {"$in": orderCodes}
				}
			})
				.then(products => {
					if ( products && products.length>0 ) {
						let categoriesSlugs = [];
						products.forEach(function(product, i) {
							products[i] = self.priceByUser(product, ctx.meta.user);
							if ( product.categories && product.categories.length>0 ) {
								categoriesSlugs.push(...product.categories);
							}
						});
						return ctx.call("categories.findActive", {
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
		},

	}

};
