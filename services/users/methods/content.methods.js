"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const fs = require("fs-extra");
const SettingsMixin = require("../../../mixins/settings.mixin");

module.exports = {
	actions: {
		readTranslation: {
			params: {
				lang: { type: "string", optional: true },
				blockName: { type: "string", optional: true },
				full: { type: "string", optional: true }
			},
			handler(ctx) {
				this.logger.info("users.readTranslation ctx.params:",  ctx.params);
				let translation = null;
				return new Promise(function(resolve, reject) {
					fs.readFile(ctx.meta.siteSettings.translation.dictionaryPath, "utf8", (err, data) => {
						if (err) {
							reject(err);
						}
						resolve(data);
					});
				})
					.then( (result) => {
						let transFileResult = JSON.parse(result);
						if (transFileResult) {
							this.logger.info("users.readTranslation ctx.params.full:",  ctx.params.full);
							if (ctx.params.full &&  ctx.params.full === "true") {
								translation = transFileResult;
							} else {
								translation = this.extractTranslation(transFileResult, ctx.params.lang, ctx.params.blockName);
							}
						}
						return translation;
					})
					.catch(err => {
						console.error("users.readTranslation failed: ", err);
						return Promise.reject(new MoleculerClientError("Reading translation failed - try again", 422, "", [{ field: "translation", message: "failed"}]));
					});
			}
		},


		updateDictionary: {
			auth: "required",
			params: {
				dictionary: { type: "object" }
			},
			handler(ctx) {
				const business = SettingsMixin.getSiteSettings("business", true);
				if (ctx.meta.user?.type !== "admin" || business.editableSettings?.translates !== true) {
					return Promise.reject(new MoleculerClientError("Not authorized", 403, "", []));
				}

				return fs.writeJson(
					ctx.meta.siteSettings.translation.dictionaryPath,
					ctx.params.dictionary,
					{ spaces: 2 }
				).then(() => {
					return { success: true };
				})
					.catch(err => {
						this.logger.error("users.updateDictionary write error: ", err);
						return Promise.reject(new MoleculerClientError("Can't update dictionary", 422, "", []));
					});
			}
		},

		/**
		 * update specific product codes in user contentDependencies settings
		 * 
		 * @actions
		 * 
		 * @param {String} userId - user ID
		 * @param {Array} productCodes - strings array of product codes to remove
		 * 
		 */
		updateContentDependencies: {
			visibility: "protected",
			params: {
				userId: { type: "string" },
				productCodes: { type: "array", items: { type: "string" } }
			},
			handler(ctx) {
				const { userId, productCodes } = ctx.params;

				return this.adapter.findById(this.fixStringToId(userId))
					.then((foundUser) => {
						if (!foundUser) {
							return Promise.reject(new MoleculerClientError("User not found", 404));
						}
						if (!foundUser.data) {
							foundUser.data = { contentDependencies: { list: [] } };
						}
						if (!foundUser.data.contentDependencies) {
							foundUser.data.contentDependencies = { list: [] };
						}
						if (!foundUser.data.contentDependencies.list) {
							foundUser.data.contentDependencies.list = [];
						}
						if (productCodes.length > 0) {
							foundUser.data.contentDependencies.list = [...new Set(productCodes)];
						}
						return foundUser;
					})
					.then((updatedUser) => {
						return this.adapter.updateById(updatedUser._id, this.prepareForUpdate(updatedUser));
					})
					.catch(err => {
						this.logger.error("users.updateContentDependencies error:", err);
						if (err instanceof MoleculerClientError) {
							return Promise.reject(err);
						}
						return Promise.reject(new MoleculerClientError("Can't update content dependencies", 422, "", []));
					});
			}
		},

		/**
		 * remove specific product codes from user contentDependencies settings
		 * 
		 * @actions
		 * 
		 * @param {String} userId - user ID
		 * @param {Array} productCodes - strings array of product codes to remove
		 * 
		 */
		removeContentDependencies: {
			visibility: "protected",
			params: {
				userId: { type: "string" },
				productCodes: { type: "array", items: { type: "string" } }
			},
			handler(ctx) {
				const { userId, productCodes } = ctx.params;

				return this.adapter.findById(this.fixStringToId(userId))
					.then((foundUser) => {
						if (!foundUser) {
							return Promise.reject(new MoleculerClientError("User not found", 404));
						}
						if (!foundUser.data?.contentDependencies?.list) {
							return foundUser;
						}
						if (productCodes.length > 0) {
							productCodes.forEach(code => {
								const foundIndex = foundUser.data.contentDependencies.list.indexOf(code);
								if (foundIndex > -1) {
									foundUser.data.contentDependencies.list.splice(foundIndex, 1);
								}
							});
						}
						return foundUser;
					})
					.then((updatedUser) => {
						return this.adapter.updateById(updatedUser._id, this.prepareForUpdate(updatedUser));
					})
					.catch(err => {
						this.logger.error("users.removeContentDependencies error:", err);
						if (err instanceof MoleculerClientError) {
							return Promise.reject(err);
						}
						return Promise.reject(new MoleculerClientError("Can't remove content dependencies", 422, "", []));
					});
			}
		},
	}
};
