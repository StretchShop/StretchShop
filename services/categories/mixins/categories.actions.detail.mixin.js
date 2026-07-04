"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

module.exports = {
	actions: {
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
	}
};
