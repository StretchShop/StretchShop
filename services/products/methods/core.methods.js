"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

const priceLevels = require("../../../mixins/price.levels.mixin");
const SettingsMixin = require("../../../mixins/settings.mixin");


module.exports = {

	mixins: [
		priceLevels
	],

	/**
	 * Methods
	 */
	methods: {

		/**
		 * Basic logic for importing a product
		 * 
		 * @param {Object} ctx - context data
		 * @param {Object} entity - entity sent
		 * @param {Object} found - found record of object
		 * @returns 
		 */
		importProductAction(ctx, entity, found) {
			let self = this;

			if (found) { // product found, update it
				if ( entity ) {
					if ( entity.dates ) {
						// transform strings into dates
						Object.keys(entity.dates).forEach(function(key) {
							let date = entity.dates[key];
							if ( date && date!=null && typeof date == "string" && 
							typeof date.trim !== "undefined" && date.trim()!="" ) {
								entity.dates[key] = new Date(entity.dates[key]);
							}
						});
					}
					if ( entity.activity ) {
						Object.keys(entity.activity).forEach(function(key) {
							let date = entity.activity[key];
							if ( date && date!=null && typeof date == "string" && 
							typeof date.trim !== "undefined" && date.trim()!="" ) {
								entity.activity[key] = new Date(entity.activity[key]);
							}
						});
					}
				}
				// update existing product from entity
				return self.importProductActionUpdateFound(ctx, entity);

			} else { // no product found, create one
				return self.validateEntity(entity)
					.then(() => {
						// crete new product from entity
						return self.importProductActionCreateNew(ctx, entity);
					})
					.catch(err => {
						self.logger.error("products import update validateEntity err:", err);
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
		importProductActionUpdateFound(ctx, entity) {
			let self = this;

			return self.validateEntity(entity)
				.then(() => {
					if (!entity.dates) {
						entity.dates = {};
					}
					entity.dates.dateUpdated = new Date();
					entity.dates.dateSynced = new Date();
					if (!entity.priceLevels) { // add price levels if needed
						entity = self.makeProductPriceLevels(entity);
					}
					self.logger.info("products.import found - update entity:", entity);
					let entityId = entity.id;
					delete entity.id;
					delete entity._id;
					const update = {
						"$set": entity
					};

					// after call action
					ctx.meta.afterCallAction = {
						name: "product update",
						type: "render",
						data: {
							url: self.getRequestData(ctx)
						}
					};

					return self.adapter.updateById(entityId, update);
				})
				.catch(err => {
					self.logger.error("products import update validateEntity err:", err);
				});
		},


		/**
		 * Create new product using entity object from param.
		 * Part of import action
		 * 
		 * @param {Object} ctx 
		 * @param {Object} entity 
		 * @returns Object
		 */
		importProductActionCreateNew(ctx, entity) {
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
			return ctx.call("products.find", {
				"query": {
					slug: entity.slug
				}
			})
				.then(slugFound => {
					if (slugFound && slugFound.constructor !== Array) {
						self.logger.error("products.import notFound - insert - slugFound entity:", entity);
						return { "error" : "Slug "+entity.slug+" already used." };
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
					if (priceLevels) { // add price levels if needed
						entity = self.makeProductPriceLevels(entity);
					}
					self.logger.info("products.import - insert entity:", entity);

					// after call action
					ctx.meta.afterCallAction = {
						name: "product insert",
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
		 * Add basic data to found product object
		 * 
		 * @param {Object} ctx - context data
		 * @param {Object} found - found product
		 * @param {Boolean} edit - is edit action
		 * @returns Promise
		 */
		detailActionAddBasicData(ctx, found, edit) {
			return this.Promise.resolve()
				.then(() => {
					// check dates
					if ( ctx.meta.user && ctx.meta.user.type!="admin" && 
						ctx.meta.user.email!=found.publisher && found.activity && 
						((found.activity.start && found.activity.start!=null) || 
						(found.activity.end && found.activity.end))
					) {
						let now = new Date();
						if (found.activity.start) {
							let startDate = new Date(found.activity.start);
							if (startDate > now) { // not started
								this.logger.info("products.detail - product not active (start)");
								return Promise.reject(new MoleculerClientError("Product not found!", 400, "", [{ field: "product", message: "not found"}]));
							}
						}
						if (found.activity.end) {
							let endDate = new Date(found.activity.end);
							if (endDate < now) { // ended
								this.logger.info("products.detail - product not active (end)");
								return Promise.reject(new MoleculerClientError("Product not found!", 400, "", [{ field: "product", message: "not found"}]));
							}
						}
					}

					// user price
					found = this.priceByUser(found, ctx.meta.user, edit);
					// get taxData for product
					if (!found["taxData"]) {
						found["taxData"] = SettingsMixin.getSiteSettings('business')?.taxData?.global;
					}
					// categories
					if (found.categories.length>0) {
						return ctx.call("categories.detail", {
							categoryPath: found.categories[0],
							type: "products"
						})
							.then(parentCategoryDetail => {
								found["parentCategoryDetail"] = parentCategoryDetail;
								return found;
							});
					} else {
						found["parentCategoryDetail"] = null;
						return found;
					}
				});
		},


		/**
		 * Add product variations data to found product object
		 * 
		 * @param {Object} ctx - context data
		 * @param {Object} found - found product
		 * @returns Promise
		 */
		detailActionAddVariatonData(ctx, found) {
			return this.Promise.resolve()
				.then(() => {
					let query = {"$and": []};

					query["$and"].push({
						"variationGroupId": found.variationGroupId
					});
					query["$and"].push({
						"_id": { "$ne": found._id }
					});
					query = this.filterOnlyActiveProducts(query, ctx.meta.user);

					return this.adapter.find({
						"query": query
					})
						.then(variations => {
							if (!found.data) {
								found.data = {};
							}
							variations.forEach((variation, i) => {
								if (variation && variation.data) {
									if (variation.data.variations) {
										variation.data.variations = null;
									}
									if (variation.data.related) {
										variation.data.related = null;
									}
								}
								variations[i] = this.priceByUser(variation, ctx.meta.user);
							});
							found.data.variations = variations;
							return found;
						});
				});
		},


		/**
		 * Add data of products related to found product object
		 * 
		 * @param {Object} ctx - context data
		 * @param {Object} found - found product
		 * @returns Promise
		 */
		detailActionAddRelatedData(ctx, found) {
			return this.Promise.resolve()
				.then(() => {
					let query = {"$and": []};

					query["$and"].push({
						"orderCode": {"$in": found.data.related.products}
					});
					query = this.filterOnlyActiveProducts(query, ctx.meta.user);
					return this.adapter.find({
						"query": query
					})
						.then(related => {
							related.forEach((rel, i) => {
								if (rel && rel.data) {
									if (rel.data.variations) {
										rel.data.variations = null;
									}
									if (rel.data.related) {
										rel.data.related = null;
									}
								}
								related[i] = this.priceByUser(rel, ctx.meta.user);
							});
							found.data.related.productResults = related;
							return found;
						});
				});
		},

	}
};
