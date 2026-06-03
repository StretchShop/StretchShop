"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { rmSync } = require("fs");

module.exports = {
	actions: {
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
		}

	}
};
