"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const fs = require("fs-extra");
const path = require("path");
const { resolveSafePath } = require("../../../mixins/path.security");

module.exports = {
	actions: {
		/**
		 * Delete image by user - checking if user has permision to do that
		 * 
		 * @param {String} type - type of image (eg. product image)
		 * @param {String} code - code of image (eg. order code of product)
		 * @param {String} image - image name if applicable
		 */
		deleteUserImage: {
			auth: "required",
			params: {
				type: { type: "string" },
				code: { type: "string", min: 3 },
				image: { type: "string" }
			},
			handler(ctx) {
				let self = this;
				this.logger.info("users.deleteUserImage ctx.params:", {
					params: ctx.params, 
					id: ctx.meta.user._id
				});

				const unlinkSafe = (dirPath, imageName) => {
					let filePath;
					try {
						filePath = resolveSafePath(dirPath, imageName);
					} catch (e) {
						return Promise.reject(e instanceof MoleculerClientError ? e : new MoleculerClientError("Invalid image", 400));
					}
					return new Promise((resolve, reject) => {
						fs.unlink(filePath, (err) => {
							if (err) {
								this.logger.error("users.deleteUserImage error:", err);
								reject({ success: false, message: "delete failed" });
								return;
							}
							this.logger.info("users.deleteUserImage - DELETED file: ", filePath);
							resolve({ success: true, message: "file deleted" });
						});
					});
				};

				// if user is logged in and has email
				if ( ctx.meta.user && ctx.meta.user.email ) {
					if ( ctx.params.type=="products" ) {
						return ctx.call("products.find", {
							"query": { "orderCode": ctx.params.code }
						})
							.then(products => {
								let deleteProductImage = false;
								if ( products && products[0] ) {
									if ( ctx.meta.user.type=="admin" ) {
										this.logger.info("users.deleteUserImage products - You can delete "+ctx.params.type+" image, because you are admin ("+ctx.meta.user.type+"=='admin')", ctx.meta.user.type=="admin");
										deleteProductImage = true;
									} else if ( products && products[0] && products[0].publisher==ctx.meta.user.email ) {
										this.logger.info("users.deleteUserImage products - You can "+ctx.params.type+" image, because you are publisher ("+products[0].publisher+"=="+ctx.meta.user.email+")", products[0].publisher==ctx.meta.user.email);
										deleteProductImage = true;
									}
									if (deleteProductImage===true) {
										let productCodePath = self.stringChunk(products[0].orderCode, process.env.CHUNKSIZE_USER || 6);
										let dirPath = path.join(
											ctx.meta.siteSettings.assets.folder,
											process.env.ASSETS_PATH || "",
											ctx.params.type,
											productCodePath
										);
										return unlinkSafe(dirPath, ctx.params.image)
											.then(result => result)
											.catch(error => error);
									}
								}
							});
					} else if ( ctx.params.type=="categories" ) {
						return ctx.call("categories.find", {
							"query": { "slug": ctx.params.code }
						})
							.then(categories => {
								let deleteCategoryImage = false;
								if ( categories && categories[0] ) {
									if ( ctx.meta.user.type=="admin" ) {
										this.logger.info("users.deleteUserImage categories - You can delete "+ctx.params.type+" image, because you are admin ("+ctx.meta.user.type+"=='admin')", ctx.meta.user.type=="admin");
										deleteCategoryImage = true;
									} else if ( categories && categories[0] && categories[0].publisher==ctx.meta.user.email ) {
										this.logger.info("users.deleteUserImage categories -You can "+ctx.params.type+" image, because you are publisher ("+categories[0].publisher+"=="+ctx.meta.user.email+")", categories[0].publisher==ctx.meta.user.email);
										deleteCategoryImage = true;
									}
									if (deleteCategoryImage===true) {
										let dirPath = path.join(
											ctx.meta.siteSettings.assets.folder,
											process.env.ASSETS_PATH || "",
											ctx.params.type,
											categories[0].slug
										);
										return unlinkSafe(dirPath, ctx.params.image)
											.then(result => result)
											.catch(error => error);
									}
								}
							});
					} else if ( ctx.params.type=="pages" ) {
						return ctx.call("pages.find", {
							"query": { "slug": ctx.params.code }
						})
							.then(pages => {
								let deletePageImage = false;
								if ( pages && pages[0] ) {
									if ( ctx.meta.user.type=="admin" ) {
										this.logger.info("users.deleteUserImage pages - You can delete "+ctx.params.type+" image, because you are admin ("+ctx.meta.user.type+"=='admin')", ctx.meta.user.type=="admin");
										deletePageImage = true;
									} else if ( pages && pages[0] && pages[0].publisher==ctx.meta.user.email ) {
										this.logger.info("users.deleteUserImage pages -You can "+ctx.params.type+" image, because you are publisher ("+pages[0].publisher+"=="+ctx.meta.user.email+")", pages[0].publisher==ctx.meta.user.email);
										deletePageImage = true;
									}
									if (deletePageImage===true) {
										let dirPath = path.join(
											ctx.meta.siteSettings.assets.folder,
											process.env.ASSETS_PATH || "",
											ctx.params.type,
											"cover",
											pages[0].slug
										);
										return unlinkSafe(dirPath, ctx.params.image)
											.then(result => result)
											.catch(error => error);
									}
								}
							});
					}
				}
				return "Hi there!";
			}
		}, 
	}
};
