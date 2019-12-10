"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

//const crypto 		= require("crypto");
require("dotenv").config();
const bcrypt 		= require("bcryptjs");
const jwt 			= require("jsonwebtoken");
const nodemailer = require('nodemailer');
const fs = require('fs');

const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");
const emailTemplate = require("../mixins/email.mixin");
const validateAddress = require("../mixins/validate.address.mixin");
const HelpersMixin = require("../mixins/helpers.mixin");

const NavigationMain = require("../resources/navigation/navigation-main");

module.exports = {
	name: "users",
	mixins: [
		DbService("users"),
		CacheCleanerMixin([
			"cache.clean.users",
			"cache.clean.follows",
		]),
		HelpersMixin
	],

	/**
	 * Default settings
	 */
	settings: {
		/** Secret for JWT */
		JWT_SECRET: process.env.JWT_SECRET || "jwt-stretchshop-secret",

		/** Public fields */
		fields: ["_id", "username", "email", "type", "subtype", "bio", "image", "activated", "addresses", "settings"],

		/** Validator schema for entity */
		entityValidator: {
			username: { type: "string", min: 2, pattern: /^[a-zA-Z0-9]+$/ },
			password: { type: "string", min: 6 },
			email: { type: "email" },
			type: { type: "string", optional: true },
			subtype: { type: "string", optional: true },
			bio: { type: "string", optional: true },
			image: { type: "string", optional: true },
			lastVerifyDate: { type: "date", optional: true },
			activated: { type: "date", optional: true }, // TODO - not in DB demo
			addresses: { type: "array", optional: true, items:
				{ type: "object", props: {
					type: { type: "string" }, // invoice, delivery, ...
					nameFirst: { type: "string", min: 3 },
					nameLast: { type: "string", min: 3 },
					street: { type: "string", min: 5 },
					street2: { type: "string", optional: true },
					zip: { type: "string", min: 5 },
					city: { type: "string", min: 5 },
					state: { type: "string", optional: true },
					country: { type: "string", min: 2 },
					phone: { type: "string", min: 2 }
				} }
			},
			settings: { type: "object", optional: true, props: {
						language: { type: "string", optional: true },
						currency: { type: "string", optional: true }
			} }
		},

		mailSettings: {
			defaultOptions: {
				from: '"Marcel Zúbrik" <marcel.zubrik@cw.sk>',
				to: "",
				subject: "StretchShop - ",
				text: 'Hello world?', // plain text body
        html: '<b>Hello world?</b>' // html body
			},
			smtp: {
				host: "smtp.ethereal.email",
				port: 587,
				secure: false, // true for 465, false for other ports
				auth: {
					user: "rnjf3guchntadc2k@ethereal.email",
					pass: "mraDMqTUtn7TVzdaR3"
				}
			}
		},
	},

	/**
	 * Actions
	 */
	actions: {
		/**
		 * Get core data - langs, countries, currencies
		 *
		 * @actions
		 *
		 * @returns {Object} core data from api service
		 */
		getCoreData: {
			params: {
				transLang: { type: "string", optional: true },
				transBlockName: { type: "string", optional: true }
			},
			handler(ctx) {
				let coreData = ctx.meta.localsDefault;
				// set full lang
				if ( coreData.lang && coreData.langs ) {
					for (let i = 0; i<coreData.langs.length; i++) {
						if (coreData.langs[i].code==coreData.lang) {
							coreData.lang = coreData.langs[i];
							break;
						}
					}
				}
				// set full currency
				if ( coreData.currency && coreData.currencies ) {
					for (let i = 0; i<coreData.currencies.length; i++) {
						if (coreData.currencies[i].code==coreData.currency) {
							coreData.currency = coreData.currencies[i];
							break;
						}
					}
				}
				// set full country
				if ( coreData.country && coreData.countries ) {
					for (let i = 0; i<coreData.countries.length; i++) {
						if (coreData.countries[i].code==coreData.country) {
							coreData.country = coreData.countries[i];
							break;
						}
					}
				}

				coreData.navigation = NavigationMain;

				// get other details - user and translation
				coreData.user = null;
				coreData.translation = null
				coreData.settings = {
						assets: {
							url: process.env.ASSETS_URL
						}
				};
				if ( ctx.meta.user && ctx.meta.user._id ) {
					return ctx.call('users.me')
					.then(user => {
						if (user && user.user) {
							coreData.user = user.user;
						}
						// get translation if language not default
						if ( ctx.params.transLang && ctx.params.transLang!='' && coreData.langs ) {
							let userLanguage = ctx.params.transLang
							// get user language if possible
							if ( coreData.user && coreData.user.settings && coreData.user.settings.language && coreData.user.settings.language.toString().trim()!='' ) {
								userLanguage = coreData.user.settings.language;
							}
							// if valid language
							if ( this.isValidTranslationLanguage(userLanguage, coreData.langs) ) {
								return ctx.call('users.readTranslation', {
									lang: userLanguage,
									blockName: ctx.params.transBlockName
								})
								.then(translation => {
									coreData.translation = translation;
									return coreData;
								});
							}
						}
						return coreData;
					})
					.catch(error => {
						console.log("\nusers.getCoreData users.me error:", error);
					});
				} else { // no user
					// get translation if language not default
					if ( ctx.params.transLang && ctx.params.transLang!='' && coreData.langs ) {
						// if valid language && not default
						if ( this.isValidTranslationLanguage(ctx.params.transLang, coreData.langs) &&
						ctx.params.transLang!=coreData.lang.code ) {
							return ctx.call('users.readTranslation', {
								lang: ctx.params.transLang,
								blockName: ctx.params.transBlockName
							})
							.then(translation => {
								coreData.translation = translation;
								return coreData;
							});
						}
					}
					return coreData;
				}
			}
		},


		/**
		 * Register a new user
		 *
		 * @actions
		 * @param {Object} user - User entity
		 *
		 * @returns {Object} Created entity & token
		 */
		create: {
			params: {
				user: { type: "object", props: {
					username: { type: "string" },
					email: { type: "string" },
					password: { type: "string" },
					settings: { type: "object", props: {
						language: { type: "string" },
						currency: { type: "string" }
					} }
				} }
			},
			handler(ctx) {
				let entity = ctx.params.user;

				return this.validateEntity(entity)
					.then(() => {
						if (entity.username)
							return this.adapter.findOne({ username: entity.username })
								.then(found => {
									if (found)
										return Promise.reject(new MoleculerClientError("Username is exist!", 422, "", [{ field: "username", message: "exists"}]));

								});
					})
					.then(() => {
						if (entity.email)
							return this.adapter.findOne({ email: entity.email })
								.then(found => {
									if (found)
										return Promise.reject(new MoleculerClientError("Email is exist!", 422, "", [{ field: "email", message: "exists"}]));
								});

					})
					.then(() => {
						entity.password = bcrypt.hashSync(entity.password, 10);
						let keepItForLater = entity.password;
						let hashedPwd = entity.password;
						entity.type = "user";
						entity.bio = entity.bio || "";
						entity.image = entity.image || null;
						entity.createdAt = new Date();
						entity.lastVerifyDate = new Date();
						if ( !entity.settings ) {
							entity.settings = {
								language: ctx.meta.localsDefault.lang,
								currency: ctx.meta.localsDefault.currency
							};
						}

						return this.adapter.insert(entity)
							.then(doc => this.transformDocuments(ctx, {}, doc))
							.then(user => this.transformEntity(user, true, ctx.meta.token))
							.then(entity => {
								this.entityChanged("created", entity, ctx).then(() => entity);
								console.log("\n\n User Created: ", entity, "\n\n\n");

								// send email separately asynchronously not waiting for response
								let emailData = {
									"entity": entity,
									"keepItForLater": this.buildHashSourceFromEntity(hashedPwd, entity.createdAt),
									"url": ctx.meta.siteSettings.url+"/"+entity.user.settings.language,
									"language": entity.user.settings.language,
									"templateName": "registration"
								};
								this.sendVerificationEmail(emailData, ctx);

								// return user data
								return entity;
							});
					});
			}
		},


		/**
		 * Login with username & password
		 *
		 * @actions
		 * @param {Object} user - User credentials
		 *
		 * @returns {Object} Logged in user with token
		 */
		login: {
			params: {
				user: { type: "object", props: {
					email: { type: "email" },
					password: { type: "string", min: 1 }
				}}
			},
			handler(ctx) {
				const { email, password } = ctx.params.user;

				return this.Promise.resolve()
					.then(() => this.adapter.findOne({ email: email }))
					.then(user => {
						if (!user) {
							return this.Promise.reject(new MoleculerClientError("Email or password is invalid!", 422, "", [{ field: "email", message: "wrong credentials"}]));
						}
						if ( !user.activated || user.activated.toString().trim()=='' || user.activated>new Date() ) {
							return this.Promise.reject(new MoleculerClientError("User not activated", 422, "", [{ field: "email", message: "not activated"}]));
						}

						return bcrypt.compare(password, user.password).then(res => {
							if (!res)
								return Promise.reject(new MoleculerClientError("Wrong password!", 422, "", [{ field: "email", message: "wrong credentials"}]));

							// Transform user entity (remove password and all protected fields)
							return this.transformDocuments(ctx, {}, user);
						});
					})
					.then(user => {
						if ( ctx.meta.cart ) {
							ctx.meta.cart.user = user._id;
						}
						return this.transformEntity(user, true, ctx.meta.token);
					});
			}
		},


		logout: {
			handler(ctx) {
				ctx.meta.user = null;
				ctx.meta.token = null;
				ctx.meta.userID = null;
				return true;
			}
		},


		/**
		 * Get user by JWT token (for API GW authentication)
		 *
		 * @actions
		 * @param {String} token - JWT token
		 *
		 * @returns {Object} Resolved user
		 */
		resolveToken: {
			cache: {
				keys: ["token"],
				ttl: 60 * 60 // 1 hour
			},
			params: {
				token: "string"
			},
			handler(ctx) {
				return new this.Promise((resolve, reject) => {
					jwt.verify(ctx.params.token, this.settings.JWT_SECRET, (err, decoded) => {
						if (err) {
							return reject(err);
						}

						resolve(decoded);
					});

				})
				.then(decoded => {
					if (decoded.id) {
						return this.adapter.findById(decoded.id)
						.then(found => {
							if (found.activated && (new Date(found.activated).getTime() < new Date().getTime()) ) {
								return found;
							}
						});
					}
				});
			}
		},


		/**
		 * Get current user entity.
		 * Auth is required!
		 *
		 * @actions
		 *
		 * @returns {Object} User entity
		 */
		me: {
			auth: "required",
			cache: {
				keys: ["#userID"]
			},
			handler(ctx) {
				if ( ctx.meta.user && ctx.meta.user._id ) {
					return this.getById(ctx.meta.user._id)
					.then(user => {
						if (!user) {
							return this.Promise.reject(new MoleculerClientError("User not found!", 400));
						}

						return this.transformDocuments(ctx, {}, user);
					})
					.then(user => {
						console.log("____idf-_:", user);
						return this.transformEntity(user, true, (ctx.meta.token ? ctx.meta.token : null));
					})
					.catch((error) => {
						console.log("\nusers.me error", error);
						return null;
					});
				}
			}
		},


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
						if (newData.username)
							return this.adapter.findOne({ username: newData.username })
								.then(found => {
									if (found && found._id.toString() !== ctx.meta.user._id.toString())
										return Promise.reject(new MoleculerClientError("Username is exist!", 422, "", [{ field: "username", message: "is exist"}]));

								});
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
								let type = (address && address.type) ? address.type : "invoice";
								let validatioResult = validateAddress(address);
								if ( validatioResult.result && validatioResult.errors.length>0 ) {
									keys++;
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
						// get user only if it's logged and new data id&username&email is same as logged or logged user is admin
						if ( this.userCanUpdate(loggedUser, newData) ) {
							let findId = loggedUser._id;
							if ( loggedUser.user && loggedUser.user._id && loggedUser.user._id>0 && loggedUser.user.type=="admin" && newData.user._id && newData.user._id>0 ) {
								findId = userUpdate.user._id;
							}
							return this.adapter.findById(findId)
							.then(found => {
							if ( typeof newData["password"] !== "undefined" ) {
								newData["password"] = bcrypt.hashSync(newData["password"], 10);
							}
								// loop found object, update it with new data
								for (var property in newData) {
								    if (newData.hasOwnProperty(property) && found.hasOwnProperty(property)) {
							        found[property] = newData[property];
								    } else if ( newData.hasOwnProperty(property) ) { // if property does not exist, set it
											found[property] = newData[property];
										}
								}
								newData.updatedAt = new Date();
								return this.adapter.updateById(ctx.meta.user._id, this.prepareForUpdate(found));
							});
						}
						return Promise.reject(new MoleculerClientError("User not valid", 422, "", [{ field: "user", message: "invalid"}]));
					})
					.then(doc => this.transformDocuments(ctx, {}, doc))
					.then(user => this.transformEntity(user, true, ctx.meta.token))
					.then(json => this.entityChanged("updated", json, ctx).then(() => json));

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
				const newData = ctx.params.data;
				let user = ctx.meta.user;
				user.image = newData.image

				newData.updatedAt = new Date();
				return this.adapter.updateById(ctx.meta.user._id, this.prepareForUpdate(user));
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
				keys: ["#userID", "username"]
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
					.then(user => this.transformProfile(ctx, user, ctx.meta.user));
			}
		},

		/**
		 * Follow a user
		 * Auth is required!
		 *
		 * @actions
		 *
		 * @param {String} username - Followed username
		 * @returns {Object} Current user entity
		 */
		follow: {
			auth: "required",
			params: {
				username: { type: "string" }
			},
			handler(ctx) {
				return this.adapter.findOne({ username: ctx.params.username })
					.then(user => {
						if (!user)
							return this.Promise.reject(new MoleculerClientError("User not found!", 404));

						return ctx.call("follows.add", { user: ctx.meta.user._id.toString(), follow: user._id.toString() })
							.then(() => this.transformDocuments(ctx, {}, user));
					})
					.then(user => this.transformProfile(ctx, user, ctx.meta.user));
			}
		},

		/**
		 * Unfollow a user
		 * Auth is required!
		 *
		 * @actions
		 *
		 * @param {String} username - Unfollowed username
		 * @returns {Object} Current user entity
		 */
		unfollow: {
			auth: "required",
			params: {
				username: { type: "string" }
			},
			handler(ctx) {
				return this.adapter.findOne({ username: ctx.params.username })
					.then(user => {
						if (!user)
							return this.Promise.reject(new MoleculerClientError("User not found!", 404));

						return ctx.call("follows.delete", {
							user: ctx.meta.user._id.toString(),
							follow: user._id.toString()
						})
						.then(() => {
							this.transformDocuments(ctx, {}, user)
						});
					})
					.then(user => this.transformProfile(ctx, user, ctx.meta.user));
			}
		},


		checkIfUserExists: {
			auth: "required",
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
				});
			}
		},


		checkIfEmailExists: {
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
				});
			}
		},


		/**
		 * Send email based on template and data for it
		 * Auth is required!
		 *
		 * @actions
		 *
		 * @param {String} template - name of template
		 * @param {Object} data - Email data to place in email
		 * @param {Object} settings - Email settings
		 *
		 * @return {Boolean}
		 */
		sendEmail: {
			auth: "required",
			params: {
				template: { type: "string", min: 3 },
				data: { type: "object" },
				settings: { type: "object", optional: true },
				functionSettings: { type: "object", optional: true }
			},
			handler(ctx) {
				ctx.params.settings = (typeof ctx.params.settings !== 'undefined') ?  ctx.params.settings : null;
				ctx.params.functionSettings = (typeof ctx.params.functionSettings !== 'undefined') ?  ctx.params.functionSettings : null;
				// set language of template
				let langCode = ctx.meta.localsDefault.lang
				if ( ctx.params.functionSettings && typeof ctx.params.functionSettings.language !== "undefined" && ctx.params.functionSettings.language ) {
					langCode = ctx.params.functionSettings.language;
				}
				if ( typeof langCode.code !== 'undefined' ) {
					langCode = langCode.code;
				}
				// load templates
				return emailTemplate(ctx.params.template+"-"+langCode, ctx.params.data)
				.then((templates)=>{
					let transporter = nodemailer.createTransport(this.settings.mailSettings.smtp);

					// updates only setting that are set and other remain from default options
					let mailOptions = this.settings.mailSettings.defaultOptions;
					if ( ctx.params.settings ) {
						for (var newProperty in ctx.params.settings) {
							if (ctx.params.settings.hasOwnProperty(newProperty) && ctx.params.settings.hasOwnProperty(newProperty)) {
								mailOptions[newProperty] = ctx.params.settings[newProperty];
							}
						}
					}

					if (templates.html) {
						mailOptions.html = templates.html;
					}
					if (templates.txt) {
						mailOptions.text = templates.txt;
					}
					console.log("\nTrying to send email with these options:", mailOptions);

					let emailSentResponse = new Promise(function(resolve, reject) {
						transporter.sendMail(mailOptions, (error, info) => {
							console.log("\n -------------------- EMAIL SEND RESPONSE -------------------");
							console.log(error, info);
			        if (error) {
									reject(false);
			        }
							if ( info && info.messageId ) {
				        console.log("\nMessage sent: %s", info.messageId);
							}
			        // Preview only available when sending through an Ethereal account
			        console.log("\nPreview URL: %s", nodemailer.getTestMessageUrl(info));
			        // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
			        // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
							resolve(true);
				    });
					});

					return emailSentResponse.then(result => {
						return result;
					});
				});
			}

		},


		/**
		 * Verify if email has this hash - returns user
		 *
		 * @actions
		 *
		 * @param {String} email - email address to verify
		 * @param {Object} hash - hash to verify
		 * @param {Object} string - action if other than activation =
		 *
		 */
		verifyHash: {
			params: {
				email: { type: "string" },
				hash: { type: "string" },
				action: { type: "string", optional: true }
			},
			handler(ctx) {
				// TODO
				let action = (typeof ctx.params.action !== 'undefined') ?  ctx.params.action : 'reg';
				let re = new RegExp("\-\-", 'g');
				let email = ctx.params.email.toString().replace('---', '@').replace(re, '.');
				const TIME_TO_PAST = 60 * 60 * 1000 * 2;
				let oldDate = new Date();
				oldDate.setTime( (new Date().getTime()) - TIME_TO_PAST );
				let hash = "$2b$10$"+ctx.params.hash;
				return this.adapter.findOne({ email: email, activated: {"$exists": false} }) //, lastVerifyDate: {"$gt": oldDate}
				.then((found) => {
					let date1 = new Date(found.lastVerifyDate);
					let date2 = new Date(oldDate);
					if ( found && found.password && found.password.toString().trim()!='' ) {
						let wannabeHash = this.buildHashSourceFromEntity(found.password, found.createdAt);
						return bcrypt.compare(hash, wannabeHash).then(res => {
							found.activated = new Date();
							return this.adapter.updateById(found._id, this.prepareForUpdate(found))
							.then(doc => this.transformDocuments(ctx, {}, doc))
							.then(user => this.transformEntity(user, true, ctx.meta.token))
							.then(json => this.entityChanged("updated", json, ctx).then(() => json));
						});
					}
					return Promise.reject(new MoleculerClientError("Activation failed - try again", 422, "", [{ field: "activation", message: "failed"}]));
				});
				/**
				 * - verify hash (by email) & date stored in lastVerifyDate (2 hours),
				 * - set activated date if activate action,
				 * - set token,
				 * - redirect to profile page
				 */
			}
		},


		/**
		 * Reset password - returns user
		 *
		 * @actions
		 *
		 * @param {String} email - email address to reset
		 *
		 */
		resetPassword: {
			params: {
				email: { type: "string" }
			},
			handler(ctx) {
				let TIME_TO_PAST = 60 * 60 * 1000 * 2; // 2 hours
				let oldDate = new Date((new Date().getTime()) - TIME_TO_PAST);
				return this.adapter.findOne({ email: ctx.params.email })
				.then((found) => {
					if ( found ) {
						// TODO - if found, update activation date, so activation link will work
						console.log("\n\n Reset password: ", found, "\n\n\n");
						delete found.activated;

						let forUpdateWithRemove = this.prepareForUpdate(found);
						forUpdateWithRemove["$unset"] = { activated: "" };

						return this.adapter.updateById(found._id, forUpdateWithRemove).then(updated => {
							if ( !updated.settings ) {
								updated.settings = {
									language: ctx.meta.localsDefault.lang,
									currency: ctx.meta.localsDefault.currency
								};
							}
							let entity = { user : updated };

							// send email separately asynchronously not waiting for response
							let emailData = {
								"entity": entity,
								"keepItForLater": this.buildHashSourceFromEntity(entity.user.password, entity.createdAt),
								"url": ctx.meta.siteSettings.url+"/"+entity.user.settings.language,
								"language": entity.user.settings.language,
								"templateName": "pwdreset" // TODO - create email templates
							};
							this.sendVerificationEmail(emailData, ctx);

							return entity.user;
						});
					}
					return Promise.reject(new MoleculerClientError("Account reset failed - try again", 422, "", [{ field: "email", message: "not found"}]));
				});
				/**
				 * - verify hash (by email) & date stored in lastVerifyDate (2 hours),
				 * - set activated date if activate action,
				 * - set token,
				 * - redirect to profile page
				 */
			}
		},

		readTranslation: {
			params: {
				lang: { type: "string", optional: true },
				blockName: { type: "string", optional: true }
			},
			handler(ctx) {
				let translation = null;
		    return new Promise(function(resolve, reject) {
					fs.readFile(ctx.meta.siteSettings.translation.dictionaryPath, 'utf8', (err, data) => {
	            if (err) {
	              reject(err)
	            }
	            resolve(data);
	        });
				})
				.then( (result) => {
					let transFileResult = JSON.parse(result);
					if (transFileResult) {
						translation = this.extractTranslation(transFileResult, ctx.params.lang, ctx.params.blockName);
					}
					return translation;
				});
			}
		},


		deleteUserImage: {
			auth: "required",
			params: {
				type: { type: "string" },
				code: { type: "string", min: 3 },
				image: { type: "string" }
			},
			handler(ctx) {
				let self = this;
				console.log("\n\nctx.meta.siteSettings:", ctx.meta.siteSettings);
				console.log("\n\nctx.params:", ctx.params);
				console.log("\n\nctx.meta.user:", ctx.meta.user);
				// for type = "products"
				if ( ctx.meta.user && ctx.meta.user.email ) {
					if ( ctx.params.type=="products" ) {
						return ctx.call("products.find", {
							"query": { "orderCode": ctx.params.code }
						})
						.then(products => {
							let deleteProductImage = false;
							if ( products && products[0] ) {
								if ( ctx.meta.user.type=="admin" ) {
									console.log("\n\n You can delete "+ctx.params.type+" image, because you are admin ("+ctx.meta.user.type+"=='admin')", ctx.meta.user.type=="admin");
									deleteProductImage = true;
								} else if ( products && products[0] && products[0].publisher==ctx.meta.user.email ) {
									console.log("\n\n You can "+ctx.params.type+" image, because you are publisher ("+products[0].publisher+"=="+ctx.meta.user.email+")", products[0].publisher==ctx.meta.user.email);
									deleteProductImage = true;
								}
								if (deleteProductImage===true) {
									let productCodePath = self.stringChunk(products[0].orderCode, 3);
									let path = ctx.meta.siteSettings.assets.folder +"/"+ process.env.ASSETS_PATH + ctx.params.type +"/"+ productCodePath +"/"+ ctx.params.image;
									return new Promise((resolve, reject) => {
										fs.unlink(path, (err) => {
									  	if (err) {
									    	console.error("\n\n deleteUserImage error:", err);
									    	reject( {success: false, message: "delete failed"} );
									  	}
											console.log("\n\n DELETED file: ", path);
											resolve( {success: true, message: "file deleted"} );
										});
									})
									.then(result => {
										return result;
									})
									.catch(error => {
				            return error;
				          });
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
									console.log("\n\n You can delete "+ctx.params.type+" image, because you are admin ("+ctx.meta.user.type+"=='admin')", ctx.meta.user.type=="admin");
									deleteCategoryImage = true;
								} else if ( categories && categories[0] && categories[0].publisher==ctx.meta.user.email ) {
									console.log("\n\n You can "+ctx.params.type+" image, because you are publisher ("+categories[0].publisher+"=="+ctx.meta.user.email+")", categories[0].publisher==ctx.meta.user.email);
									deleteCategoryImage = true;
								}
								if (deleteCategoryImage===true) {
									let productCodePath = categories[0].slug;
									let path = ctx.meta.siteSettings.assets.folder +"/"+ process.env.ASSETS_PATH + ctx.params.type +"/"+ productCodePath +"/"+ ctx.params.image;
									return new Promise((resolve, reject) => {
										fs.unlink(path, (err) => {
									  	if (err) {
									    	console.error("\n\n deleteUserImage error:", err);
									    	reject( {success: false, message: "delete failed"} );
									  	}
											console.log("\n\n DELETED file: ", path);
											resolve( {success: true, message: "file deleted"} );
										});
									})
									.then(result => {
										return result;
									})
									.catch(error => {
				            return error;
				          });
								}
							}
						});
					}
				}
				return "Hi there!";
			}
		}

	},



	/**
	 * Methods
	 */
	methods: {
		/**
		 * Generate a JWT token from user entity
		 *
		 * @param {Object} user
		 */
		generateJWT(user) {
			const today = new Date();
			const exp = new Date(today);
			exp.setDate(today.getDate() + 60);

			return jwt.sign({
				id: user._id,
				username: user.username,
				exp: Math.floor(exp.getTime() / 1000)
			}, this.settings.JWT_SECRET);
		},

		/**
		 * Transform returned user entity. Generate JWT token if neccessary.
		 *
		 * @param {Object} user
		 * @param {Boolean} withToken
		 */
		transformEntity(user, withToken, token) {
			if (user) {
				//user.image = user.image || "https://www.gravatar.com/avatar/" + crypto.createHash("md5").update(user.email).digest("hex") + "?d=robohash";
				user.image = user.image || "";
				if (withToken)
					user.token = token || this.generateJWT(user);
			}

			return { user };
		},

		/**
		 * Transform returned user entity as profile.
		 *
		 * @param {Context} ctx
		 * @param {Object} user
		 * @param {Object?} loggedInUser
		 */
		transformProfile(ctx, user, loggedInUser) {
			//user.image = user.image || "https://www.gravatar.com/avatar/" + crypto.createHash("md5").update(user.email).digest("hex") + "?d=robohash";
			user.image = user.image || "";

			if (loggedInUser) {
				return ctx.call("follows.has", { user: loggedInUser._id.toString(), follow: user._id.toString() })
					.then(res => {
						user.following = res;
						return { profile: user };
					});
			}

			user.following = false;

			return { profile: user };
		},


		/**
		 * Check if user can edit user data
		 *
		 * @param {Object} loggedUser
		 * @param {Object} userUpdate
		 *
		 * @return {Boolean}
		 */
		userCanUpdate(loggedUser, userUpdate) {
		console.log("\n\n users.userCanUpdate.loggedUser: ", loggedUser);
		console.log("\n\n users.userCanUpdate.userUpdate: ", userUpdate);
			// check if loggedUser data has _id
			if ( loggedUser && loggedUser._id && loggedUser._id.toString().trim()!='' ) {
				// if loggedUser is admin and userUpdate data contain _id of user to update - can update any user
				if ( loggedUser.type=="admin" && userUpdate._id && userUpdate._id.toString().trim()!='' ) {
					return true;
				}
				// if loggedUser is admin but userUpdate has no _id - update himself
				if ( loggedUser.type==="admin" && !userUpdate._id ) {
					return true;
				}
				// if loggedUser is not admin - update himself
				if ( loggedUser.type!=="admin" && !userUpdate._id ) {
					return true;
				}
			}

			return false;
		},


		/**
		 * Merge two post addresses
		 *
		 * @param {Object} addressOrig
		 * @param {Object} addressNew
		 *
		 * @return {Object}
		 */
		mergeTwoAddresses(addressOrig, addressNew) {
			let resultAddress = addressOrig;

			if ( addressNew ) {
				for (var property in addressNew) {
					if (resultAddress.hasOwnProperty(property) && addressNew.hasOwnProperty(property)) {
						resultAddress[property] = addressNew[property];
					}
				}
			}

			return resultAddreses;
		},



		/**
		 * Extract translation by language from translation object
		 *
		 * @param {Object} transData
		 * @param {String} langCode
		 * @param {String} blockName
		 *
		 * @return {Object}
		 */
		 extractTranslation(transData, langCode, blockName) {
			 let extractedTranslation = []; // { type: "text", selector: "...", string:   }
			 if ( transData && transData.dictionary && transData.dictionary.records &&
				 transData.dictionary.records.length>0 && langCode ) {
				 for (let i=0; i<transData.dictionary.records.length; i++) {
					 let translationRecordString = "";
					 // #1 - get translate with same langCode
					 for (let j=0; j<transData.dictionary.records[i].translates.length; j++) {
						 if (transData.dictionary.records[i].translates[j].langCode===langCode) {
							 // GET translation string
							 translationRecordString = transData.dictionary.records[i].translates[j].translation;
						 } // END if translates langCode
					 } // END for traslates
					 // #2 - get types and selectors from occurences
					 for (let j=0; j<transData.dictionary.records[i].occurrences.length; j++) {
						 // TODO - if blockName set, select only specific block
						 if (transData.dictionary.records[i].occurrences[j].type) {
							 if ((typeof blockName !== 'undefined' && blockName!='' &&
							 transData.dictionary.records[i].occurrences[j].blockName &&
							 transData.dictionary.records[i].occurrences[j].blockName==blockName) ||
							 typeof blockName === 'undefined') {
								 // GET translation TYPE
								 let translationRecordType = transData.dictionary.records[i].occurrences[j].type;
								 if ( transData.dictionary.records[i].occurrences[j].translationStrings &&
									 transData.dictionary.records[i].occurrences[j].translationStrings.length ) {
									 for (let k=0; k<transData.dictionary.records[i].occurrences[j].translationStrings.length; k++) {
										 let translationRecordSelector = transData.dictionary.records[i].occurrences[j].translationStrings[k].selector;
										 let translationRecordOrig = transData.dictionary.records[i].occurrences[j].translationStrings[k].stringOrig;
										 extractedTranslation.push({
											 type: translationRecordType,
											 selector: translationRecordSelector,
											 string: translationRecordString,
											 original: translationRecordOrig
										 });
									 } // END for translationStrings
								 } // END if translationStrings
							 } // END if blockName
						 } // END if type
					 } // END for occurrences
				 }
			 }
			 let result = {};
			 result[langCode] = extractedTranslation;
			 return result;
		 },

		 isValidTranslationLanguage(lang, langsArray) {
			 let isValidTransLang = false;
			 for (let i = 0; i<langsArray.length; i++) {
				 if (langsArray[i].code==lang) {
					 isValidTransLang = true;
					 break;
				 }
			 }
			 return isValidTransLang;
		 },


		 sendVerificationEmail(emailData, ctx) {
			 // get hash
			 let hash = bcrypt.hashSync(emailData.keepItForLater.toString().substring(7), 10)
			 hash = encodeURIComponent(hash.substring(7));
			 // get email string
			 let re = new RegExp("\\.", 'g');
			 let email = emailData.entity.user.email.toString().replace(re, '--').replace('@', '---');
			 // create activation link
			 let confirmLink = emailData.url+'/user/verify/'+encodeURIComponent(email)+'/'+hash; // using email to identify and hash to verify
			 // setup object for sending email
			 let emailSetup = {
			 	settings: {
			 		to: emailData.entity.user.email
			 	},
				functionSettings: {
					language: emailData.lang
				},
			 	template: emailData.templateName,
			 	data: {
			 		webname: "StretchShop", // TODO - get name from config
			 		username: emailData.entity.user.username,
			 		email: emailData.entity.user.email,
			 		confirm_link: confirmLink
			 	}
			 };

			 // sending email
			 ctx.call("users.sendEmail", emailSetup).then(json => {
				 console.log("\nemail sent _____---... "+json+"\n\n");
			 });
		},


		prepareForUpdate(object) { // TODO - unify into mixin
			let objectToSave = JSON.parse(JSON.stringify(object));
			if ( typeof objectToSave._id !== "undefined" && objectToSave._id ) {
				delete objectToSave._id;
			}
			return { "$set": objectToSave };
		},


		buildHashSourceFromEntity(string1, string2) {
			let comboString = string1.substr(12,10)+string2+string1.substr(30);
			let hashSource = bcrypt.hashSync(comboString, 10);
			return hashSource;
		},


	},

	events: {
		"cache.clean.users"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.follows"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
