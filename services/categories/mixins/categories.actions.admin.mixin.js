"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

module.exports = {
	actions: {
		import: {
			auth: "required",
			params: {
				categories: { type: "array", items: "object", optional: true },
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				this.logger.info("categories.import - ctx.meta");
				let categories = ctx.params.categories;
				let promises = [];
				let self = this;

				if (ctx.meta.user.type == "admin") {
					if (categories && categories.length > 0) {
						// loop categories to import
						categories.forEach(function (entity) {
							promises.push(
								// add category results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										if (found) { // category found, update it
											if (entity) {
												entity = self.fixEntityDates(entity);
											}

											return self.validateEntity(entity)
												.then(() => {
													if (!entity.dates) {
														entity.dates = {};
													}
													entity.dates.dateUpdated = new Date();
													entity.dates.dateSynced = new Date();

													self.logger.info("categories.import found - update entity:", entity);
													let entityId = entity.id;
													delete entity.id;
													delete entity._id;
													const update = {
														"$set": entity
													};

													// after call action
													ctx.meta.afterCallAction = {
														name: "category update",
														type: "render",
														data: {
															url: self.getRequestData(ctx)
														}
													};

													return self.adapter.updateById(entityId, update)
														.then(doc => self.transformDocuments(ctx, {}, doc))
														.then(json => self.entityChanged("updated", json, ctx)
															.then(() => json))
														.catch(err => {
															console.error('categories.import update error: ', err);
															return this.Promise.reject(new MoleculerClientError("Category import update error", 422, "", []));
														});
												})
												.catch(err => {
													console.error('categories.import update validation error: ', err);
													return this.Promise.reject(new MoleculerClientError("Category import update validation error", 422, "", []));
												});
										} else { // no category found, create one
											return self.validateEntity(entity)
												.then(() => {
													// set generic variables
													if (!entity.slug || entity.slug.trim() == "") {
														let lang = ctx.meta.localsDefault.lang;
														if (ctx.meta.localsDefault.lang.code) {
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
															if (slugFound && slugFound.constructor !== Array) {
																self.logger.error("categories.import notFound - insert - slugFound entity:", entity);
																return { "error": "Slug " + entity.slug + " already used." };
															}

															if (!entity.parentPathSlug || entity.parentPathSlug.trim() == "") {
																entity.parentPathSlug = slug(entity.parentPath.join("-"), { lower: true });
															}
															entity.pathSlug = entity.slug;
															if (entity.slug && entity.parentPathSlug) {
																entity.pathSlug = entity.parentPathSlug + "-" + entity.slug;
															}
															if (ctx.meta.user?.email) {
																entity.publisher = ctx.meta.user.email.toString();
															}
															if (!entity.dates) {
																entity.dates = {};
															}
															entity.dates.dateCreated = new Date();
															entity.dates.dateUpdated = new Date();
															entity.dates.dateSynced = new Date();
															self.logger.info("categories.import - insert entity:", entity);

															// after call action
															ctx.meta.afterCallAction = {
																name: "category insert",
																type: "render",
																data: {
																	url: self.getRequestData(ctx)
																}
															};

															return self.adapter.insert(entity)
																.then(doc => self.transformDocuments(ctx, {}, doc))
																.then(json => self.entityChanged("created", json, ctx)
																	.then(() => json))
																.catch(err => {
																	console.error('categories.import insert error: ', err);
																	return this.Promise.reject(new MoleculerClientError("Category import insert error", 422, "", []));
																});
														})
														.catch(err => {
															console.error('categories.import insert slug-check error: ', err);
															return this.Promise.reject(new MoleculerClientError("Category import insert slug-check error", 422, "", []));
														});
												})
												.catch(err => {
													console.error('categories.import insert validation error: ', err);
													return this.Promise.reject(new MoleculerClientError("Category import insert validation error", 422, "", []));
												});
										} // else end
									})
									.catch(err => {
										console.error('categories.import findById error: ', err);
										return this.Promise.reject(new MoleculerClientError("Category import find error", 422, "", []));
									})); // push with find end
						}); // categories foreach loop end
					}

					// return multiple promises results
					return Promise.all(promises).then(prom => {
						return prom;
					})
						.catch(err => {
							console.error('categories.import promises error: ', err);
							return this.Promise.reject(new MoleculerClientError("Category import all error", 422, "", []));
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
				this.logger.info("categories.delete ctx.meta", ctx.meta);
				let categories = ctx.params.categories;
				let promises = [];
				let self = this;

				if (ctx.meta.user.type == "admin") {
					if (categories && categories.length > 0) {
						// loop products to import
						categories.forEach(function (entity) {
							promises.push(
								// add product results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										if (found) { // product found, update it
											self.logger.info("categories.delete - DELETING category: ", found);
											return ctx.call("categories.remove", { id: found._id })
												.then((deletedCount) => {
													// after call action
													ctx.meta.afterCallAction = {
														name: "category delete",
														type: "remove",
														data: {
															url: self.getRequestData(ctx)
														}
													};

													self.logger.info("categories.delete - deleted category Count: ", deletedCount);
													return deletedCount;
												}) // returns number of removed items
												.catch(err => {
													console.error('categories.delete remove error: ', err);
													return this.Promise.reject(new MoleculerClientError("Category delete error", 422, "", []));
												});
										} else {
											self.logger.error("categories.delete - entity.id " + entity.id + " not found");
										}
									})
									.catch(err => {
										console.error('categories.delete find error: ', err);
										return this.Promise.reject(new MoleculerClientError("Category delete find error", 422, "", []));
									})
							); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises).then(() => {
						return promises;
					})
						.catch(err => {
							console.error('categories.delete promises error: ', err);
							return this.Promise.reject(new MoleculerClientError("Category delete all error", 422, "", []));
						});
				} else { // not admin user
					return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
				}
			}
		},



		// check category authorship
		checkAuthor: {
			auth: "required",
			params: {
				data: { type: "object" }
			},
			handler(ctx) {
				if (ctx.params.data?.slug && ctx.params.data.publisher) {
					return this.adapter.find({
						"query": {
							"slug": ctx.params.data.slug,
							"publisher": ctx.params.data.publisher
						}
					})
						.then(categories => {
							if (categories && categories.length > 0 && categories[0].slug == ctx.params.data.slug) {
								return true;
							}
						})
						.catch(err => {
							this.logger.error("categories.checkAuthor() - error: ", err);
							return false;
						});
				}
				return false;
			}
		},



		updateCategoryImage: {
			auth: "required",
			params: {
				data: { type: "object" },
				params: { type: "object" }
			},
			handler(ctx) {
				if (ctx.params.params?.slug) {
					this.logger.info("page.updateCategoryImage - has slug: ", ctx.params.params.slug);
					return;
				}
				return;
			}
		},


	}
};
