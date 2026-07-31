"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { readdirSync, statSync, rmSync } = require("fs");

module.exports = {
	actions: {
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
				Object.keys(queryObject).forEach(function (key) {
					if (key === "_id" && typeof queryObject[key] === "string") {
						queryObject[key] = self.fixStringToId(queryObject[key]);
					}
				});
				return this.adapter.find({
					"query": queryObject
				})
					.catch(err => {
						console.error('pages.findWithId find error: ', err);
						return this.Promise.reject(new MoleculerClientError("Pages findI error", 422, "", []));
					});
			}
		},


		/**
		 * Get detail of page.
		 *
		 * @actions
		 * @param {String} page - 
		 * @param {String} category - 
		 * @param {String} lang - 
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
				if (ctx.params.lang && ctx.params.lang.trim() != "") {
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
		 * @param {Array} pages - pages objects to import
		 *
		 * @returns {Object} Array of imported pages results
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

				if (ctx.meta.user.type == "admin") {
					if (pages && pages.length > 0) {
						// loop pages to import
						pages.forEach(function (entity) {
							promises.push(
								// add page results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										return self.importPageAction(ctx, entity, found);
									})
									.catch(err => {
										console.error('pages.import find error: ', err);
										return this.Promise.reject(new MoleculerClientError("Pages import find error", 422, "", []));
									})); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises).then(prom => {
						return prom;
					})
						.catch(err => {
							console.error('pages.import promises error: ', err);
							return this.Promise.reject(new MoleculerClientError("Pages import all error", 422, "", []));
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
		 * @param {Array} pages - pages objects to delete
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

				if (ctx.meta.user.type == "admin") {
					if (pages && pages.length > 0) {
						// loop pages to import
						pages.forEach(function (entity) {
							promises.push(
								// add page results into result variable
								self.adapter.findById(entity.id)
									.then(found => {
										if (found) { // page found, delete it
											let slug = found?.slug?.toString().trim();
											self.logger.info("pages.delete - DELETING page: ", found);
											return ctx.call("pages.remove", { id: found._id })
												.then((deletedCount) => {

													// delete page assets
													const pageBaseDir = self.settings.paths.assets + "/" + process.env.ASSETS_PATH + "pages/";
													self.logger.info("pages.delete - deleted page - before assets deleted for page slug: ", slug);
													if (slug) {
														const coverDir = pageBaseDir + "cover/" + slug;
														rmSync(coverDir, { recursive: true, force: true });
														const editorDir = pageBaseDir + "editor/" + slug;
														rmSync(editorDir, { recursive: true, force: true });
													}

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
												})
												.catch(err => {
													self.logger.error('pages.delete remove error: ', err);
													return this.Promise.reject(new MoleculerClientError("Pages deleteR error", 422, "", []));
												}); // returns number of removed items
										} else {
											self.logger.error("pages.delete - entity.id " + entity.id + " not found");
										}
									})
									.catch(err => {
										self.logger.error('pages.delete find error: ', err);
										return this.Promise.reject(new MoleculerClientError("Pages delete find error", 422, "", []));
									})); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises).then(() => {
						return promises;
					})
						.catch(err => {
							console.error('pages.delete promises error: ', err);
							return this.Promise.reject(new MoleculerClientError("Pages delete all error", 422, "", []));
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
				if (ctx.params.data?.slug && ctx.params.data.publisher) {
					return this.adapter.find({
						"query": {
							"slug": ctx.params.data.slug,
							"publisher": ctx.params.data.publisher
						}
					})
						.then(pages => {
							if (pages && pages.length > 0 && pages[0].slug == ctx.params.data.slug) {
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

	}
};
