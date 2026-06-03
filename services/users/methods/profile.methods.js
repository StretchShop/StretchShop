"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const bcrypt = require("bcryptjs");
const validateAddress = require("../../../mixins/validate.address.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");

module.exports = {
	actions: {
		/**
		 * Update current user entity.
		 * Auth is required!
		 *
		 * @actions
		 *
		 * @param {Object} user - Modified fields
		 * @returns {Object} User entity
		 */
		updateUser: {
			auth: "required",
			params: {
				user: { type: "object" }
			},
			handler(ctx) {
				const newData = ctx.params.user;
				let loggedUser = ctx.meta.user;

				// admin can update other users, his actions are logged
				// common users can update only themself according to authentication

				return this.Promise.resolve()
					.then(() => {
						if (newData.username) {
							return this.adapter.findOne({ username: newData.username })
								.then(found => {
									if (found && found._id.toString() !== ctx.meta.user._id.toString()) {
										return Promise.reject(
											new MoleculerClientError("Username is exist!", 422, "", [{ field: "username", message: "is exist"}])
										);
									}
								});
						}
					})
					.then(() => {
						if (newData.email)
							return this.adapter.findOne({ email: newData.email })
								.then(found => {
									if (found && found._id.toString() !== ctx.meta.user._id.toString())
										return Promise.reject(new MoleculerClientError("Email is exist!", 422, "", [{ field: "email", message: "is exist"}]));
								});

					})
					.then(() => {
						// validate address(es) and return error if they are not valid (missing some field)
						let errors = [];
						let keys = 0;
						if (newData.addresses && newData.addresses.length>0) {
							Object.keys(newData.addresses).forEach(function(key){
								let address = newData.addresses[key];
								let validatioResult = validateAddress(address);
								if ( validatioResult.result && validatioResult.errors.length>0 ) {
									keys = keys + 1;
									validatioResult.errors.forEach(function(error){
										errors.push({ key: key, name: error.name, action: error.action });
									});
								}
							});
						}
						if ( errors.length>0 ) {
							return Promise.reject(new MoleculerClientError("Invalid address", 422, "", errors));
						}
					})
					.then(() => {
						// if user type is not set in /resources/settings/business.js
						if (newData.type && 
							( 
								!priceLevels || 
								(typeof priceLevels.isValidUsertype !== "undefined" && priceLevels.isValidUsertype(newData.type) )
							)
						) {
							return Promise.reject(new MoleculerClientError("Invalid user type!", 422, "", [{ field: "type", message: "invalid"}]));
						}
					})
					.then(() => {
						// get user only if it's logged and new data id&username&email is same as logged or logged user is admin
						if ( this.userCanUpdate(loggedUser, newData) ) {
							let findId = loggedUser._id;
							if ( loggedUser.user && loggedUser.user._id && loggedUser.user._id>0 && loggedUser.user.type=="admin" && newData.user._id && newData.user._id>0 ) {
								findId = loggedUser.user._id;
							}
							return this.adapter.findById(findId)
								.then(found => {
									if ( typeof newData["password"] !== "undefined" ) {
										newData["password"] = bcrypt.hashSync(newData["password"], 10);
									}
									// loop found object, update it with new data
									for (let property in newData) {
										if ( Object.prototype.hasOwnProperty.call(newData,property) && Object.prototype.hasOwnProperty.call(found,property) ) {
											found[property] = newData[property];
										} else if ( Object.prototype.hasOwnProperty.call(newData,property) ) { // if property does not exist, set it
											found[property] = newData[property];
										}
									}
									if ( !newData.dates || !newData.dates.dateUpdated ) {
										newData["dates"] = {
											dateCreated: new Date(),
											dateUpdated: new Date()
										};
									} else {
										newData.dates.dateUpdated = new Date();
									}
									return this.adapter.updateById(ctx.meta.user._id, this.prepareForUpdate(found));
								})
								.then(user => {
									// get used usertypes and add new pricesLevel if needed
									return this.adapter.collection.distinct("type")
										.then(types => {
											if ( types && types.indexOf(user.type)<0 ) {
												priceLevels.addUsertypePriceLevel(user.type);
											}
											return user;
										});
								});
						}
						return Promise.reject(new MoleculerClientError("User not valid", 422, "", [{ field: "user", message: "invalid"}]));
					})
					.then(doc => this.transformDocuments(ctx, {}, doc))
					.then(user => this.transformEntity(user, false, ctx))
					.then(json => this.entityChanged("updated", json, ctx)
						.then(() => json))
					.catch(err => {
						console.error("users.updateUser error: ", err);
						return this.Promise.reject(new MoleculerClientError("User update error", 422, "", []));
					});

			}
		},




		/**
		 * Update current user image
		 * Auth is required!
		 *
		 * @actions
		 *
		 * @param {Object} user - Modified fields
		 * @returns {Object} User entity
		 */
		updateMyProfileImage: {
			auth: "required",
			params: {
				data: { type: "object" }
			},
			handler(ctx) {
				let user = ctx.meta.user;
				user.image = ctx.params.data.image;
				user.dates.dateUpdated = new Date();
				return this.adapter.updateById(ctx.meta.user._id, this.prepareForUpdate(user))
					.catch(err => {
						console.error("users.updateMyProfileImage error: ", err);
						return this.Promise.reject(new MoleculerClientError("Can't update profile image", 422, "", []));
					});
			}
		},


		/**
		 * Get a user profile.
		 *
		 * @actions
		 *
		 * @param {String} username - Username
		 * @returns {Object} User entity
		 */
		profile: {
			cache: {
				keys: ["#userID", "dates.dateUpdated"]
			},
			params: {
				username: { type: "string" }
			},
			handler(ctx) {
				return this.adapter.findOne({ username: ctx.params.username })
					.then(user => {
						if (!user)
							return this.Promise.reject(new MoleculerClientError("User not found!", 404));

						return this.transformDocuments(ctx, {}, user);
					})
					.then(user => this.transformProfile(ctx, user, ctx.meta.user))
					.catch(err => {
						console.error("users.profile error: ", err);
						return this.Promise.reject(new MoleculerClientError("Can't read profile", 422, "", []));
					});
			}
		},


		checkIfUserExists: {
			auth: "required",
			authType: "csrfCheck",
			params: {
				username: { type: "string" }
			},
			handler(ctx) {
				return this.adapter.count({ "query": { "username": ctx.params.username } })
					.then(count => {
						if (count>0) {
							return Promise.reject(new MoleculerClientError("User already exists", 422, "", [{ field: "username", message: "exists" }]));
						}
						return {result: {userExists: false}};
					})
					.catch(err => {
						console.error("users.checkIfUserExists user already exists: ", err);
						return this.Promise.reject(new MoleculerClientError("User already exists", 422, "", [{ field: "username", message: "exists" }]));
					});
			}
		},


		checkIfEmailExists: {
			auth: "required",
			authType: "csrfCheck",
			params: {
				email: { type: "email" }
			},
			handler(ctx) {
				return this.adapter.count({ "query": { "email": ctx.params.email } })
					.then(count => {
						if (count>0) {
							return this.Promise.reject(new MoleculerClientError("Email already exists", 422, "", [{ field: "email", message: "exists" }]));
						}
						return {result: {emailExists: false}};
					})
					.catch(err => {
						console.error("users.checkIfEmailExists email already exists: ", err);
						return this.Promise.reject(new MoleculerClientError("Email already exists", 422, "", [{ field: "email", message: "exists" }]));
					});
			}
		},

		deleteProfile: {
			auth: "required",
			handler(ctx) {
				this.logger.info("users.deleteProfile ctx.params:", {
					params: ctx.params, 
					meta: ctx.meta
				});
				if ( ctx.meta.user && ctx.meta.user._id ) {
					let self = this;
					return this.getById(ctx.meta.user._id)
						.then(user => {
							if (!user) {
								return this.Promise.reject(new MoleculerClientError("User not found!", 400));
							}

							return this.transformDocuments(ctx, {}, user);
						})
						.catch((error) => {
							this.logger.error("users.deleteProfile error", error);
							return this.Promise.reject(new MoleculerClientError("User not found!", 400));
						})
						.then(user => {
							user.dates.dateToBeErased = new Date();
							user.dates.dateToBeErased.setDate( user.dates.dateToBeErased.getDate() + 14);
							user.dates.dateUpdated = new Date();
							this.logger.info("users.deleteProfile user", user);

							// configuring email message
							let emailSetup = {
								settings: {
									to: user.email,
									subject: process.env.SITE_NAME +" - Delete profile"
								},
								functionSettings: {
									language: user.settings.language
								},
								template: "profiledelete",
								data: {
									webname: ctx.meta.siteSettings.name,
									username: user.username,
									email: user.email,
									date: user.dates.dateToBeErased, 
									support_email: ctx.meta.siteSettings.supportEmail
								}
							};
							// sending email independently
							ctx.call("users.sendEmail", emailSetup).then(json => {
								this.logger.info("users.deleteProfile email sent: ", json);
							});

							return this.adapter.updateById(ctx.meta.user._id, this.prepareForUpdate(user))
								.then(doc => self.transformDocuments(ctx, {}, doc))
								.then(json => self.entityChanged("updated", json, ctx).then(() => json));
						});
				}
			}
		}, 


		/**
		 * cancel profile delete
		 */
		cancelDelete: {
			auth: "required",
			handler(ctx) {
				if ( ctx.meta.user && ctx.meta.user._id ) {
					let self = this;
					return this.getById(ctx.meta.user._id)
						.then(user => {
							if (!user) {
								return this.Promise.reject(new MoleculerClientError("User not found!", 400));
							}

							return this.transformDocuments(ctx, {}, user);
						})
						.catch((error) => {
							this.logger.error("users.cancelDelete error", error);
							return this.Promise.reject(new MoleculerClientError("User not found!", 400));
						})
						.then(user => {
							user.dates.dateToBeErased = null;
							user.dates.dateUpdated = new Date();

							// configuring email message
							let emailSetup = {
								settings: {
									to: user.email,
									subject: process.env.SITE_NAME +" - Canceled deleting your Profile"
								},
								functionSettings: {
									language: user.settings.language
								},
								template: "profileundelete",
								data: {
									webname: ctx.meta.siteSettings.name,
									username: user.username,
									email: user.email, 
									support_email: ctx.meta.siteSettings.supportEmail
								}
							};
							// sending email
							ctx.call("users.sendEmail", emailSetup).then(json => {
								this.logger.info("users.cancelDelete - email sent:", json);
							});

							return this.adapter.updateById(ctx.meta.user._id, this.prepareForUpdate(user))
								.then(doc => self.transformDocuments(ctx, {}, doc))
								.then(json => self.entityChanged("updated", json, ctx).then(() => json));
						});
				}
			}
		}, 
	}
};
