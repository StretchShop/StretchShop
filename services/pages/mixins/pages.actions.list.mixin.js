"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { readdirSync, statSync, rmSync } = require("fs");

module.exports = {
	actions: {
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
							let filter = { query: {}, limit: 30};
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
													})
													.catch(err => {
														console.error('pages.pagesList count error: ', err);
														return this.Promise.reject(new MoleculerClientError("Pages count error", 422, "", []));
													});
											}
											return result;
										})
										.catch(err => {
											console.error('pages.pagesList findActive error: ', err);
											return this.Promise.reject(new MoleculerClientError("Pages findA error", 422, "", []));
										});
								})
								.catch(err => {
									console.error('pages.pagesList find error: ', err);
									return this.Promise.reject(new MoleculerClientError("Pages find error", 422, "", []));
								});
						}
					})
					.catch(err => {
						console.error('pages.pagesList category error: ', err);
						return this.Promise.reject(new MoleculerClientError("Pages category error", 422, "", []));
					});
			}
		},


		/**
		 * List templates
		 *
		 * @actions
		 * @param {String} page - Page to get template for
		 * @param {Object} query - Query to filter pages
		 * @param {String} group - Template group
		 * @param {Boolean} withPages - Return result with pages
		 *
		 * @returns {Object} Filtered pages, category detail
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
					const { escapeRegex } = require("../../../mixins/mongo.security");
					const safeSlug = escapeRegex(ctx.params.query.slug.toLowerCase());
					// pages
					return ctx.call("pages.findWithId", {
						"query": {
							"slug": { "$regex": safeSlug }
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
									"slug": { "$regex": safeSlug }
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
								})
								.catch(err => {
									console.error('pages.listTemplates categories.find error: ', err);
									return this.Promise.reject(new MoleculerClientError("Pages templates cats error", 422, "", []));
								});
							//return results;
						})
						.catch(err => {
							console.error('pages.listTemplates find error: ', err);
							return this.Promise.reject(new MoleculerClientError("Pages templates find error", 422, "", []));
						});
				} else {
					return dirs;
				}
			}
		},


		/**
		 * Find pages with count
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
								})
								.catch(err => {
									console.error('pages.findWithCount count error: ', err);
									return this.Promise.reject(new MoleculerClientError("Pages findC count error", 422, "", []));
								});
						}
					})
					.catch(err => {
						console.error('pages.findWithCount find error: ', err);
						return this.Promise.reject(new MoleculerClientError("Pages findC error", 422, "", []));
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
	}
};
