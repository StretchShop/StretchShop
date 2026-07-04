"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const fetch = require("cross-fetch");

module.exports = {
	actions: {
		/**
		 * Remove users, that want to be erased
		 */
		cleanUsers: {
			cache: false,
			handler(ctx) {
				let promises = [];
				const d = new Date(); // Less than today
				return this.adapter.find({
					query: {
						"dates.dateToBeErased": { "$lt": d }
					}
				})
					.then(found => {
						console.log("cleanUsers found results: ", found);
						if (found && found.length > 0) {
							found.forEach(user => {
								promises.push( 
									ctx.call("users.remove", {id: user._id} )
										.then(removed => {
											return "Removed users: " +JSON.stringify(removed);
										})
								);
							});
							// return all delete results
							return Promise.all(promises)
								.then((result) => {
									return result;
								})
								.catch(err => {
									console.error("users.clearUsers user error: ", user, err);
									return this.Promise.reject(new MoleculerClientError("Can't erase user", 422, "", []));
								});
						} else {
							return Promise.resolve([]);
						}
					})
					.catch(err => {
						console.error("users.clearUsers error: ", err);
						return this.Promise.reject(new MoleculerClientError("Can't clean users", 422, "", []));
					});
			}
		},


		/**
		 * recaptcha verification - currently using Google Recaptcha v3
		 * 
		 * @actions
		 * 
		 * @param {String} token - recaptcha verification token
		 */
		recaptcha: {
			params: {
				token: { type: "string" }
			},
			handler(ctx) {
				let requestBody = "secret="+process.env.RECAPTCHA_SECRET+"&response="+ctx.params.token;
				return fetch(process.env.RECAPTCHA_URL, {
					method: "post",
					body:    requestBody,
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
				})
					.then(res => res.json()) // expecting a json response, checking it
					.then(recaptchaResponse => {
						return recaptchaResponse.success;
					})
					.catch(err => {
						console.error("users.recaptcha error: ", err);
						return this.Promise.reject(new MoleculerClientError("Recaptcha failed", 422, "", []));
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



		list: {
			auth: "required",
			handler(ctx) {
				let self = this;
				this.logger.info("user.list INCOMING");
			}
		},

		manage: {
			auth: "required",
			handler(ctx) {
				let self = this;
				this.logger.info("user.manage INCOMING");
			}
		}
	}
};
