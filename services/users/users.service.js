"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("@stretchshop/moleculer-cron");

require("dotenv").config();
const bcrypt 		= require("bcryptjs");
const jwt 			= require("jsonwebtoken");
const nodemailer = require("nodemailer");
const fs = require("fs-extra");
const fetch 		= require("cross-fetch");

// global mixins
const DbService = require("../../mixins/db.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const emailTemplate = require("../../mixins/email.mixin");
const validateAddress = require("../../mixins/validate.address.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");
const priceLevels = require("../../mixins/price.levels.mixin");

// methods
const UsersMethodsCore = require("./methods/core.methods");


module.exports = {
	name: "users",
	mixins: [
		DbService("users"),
		CacheCleanerMixin([
			"cache.clean.users",
		]),
		HelpersMixin, 
		priceLevels,
		Cron,
		// methods
		UsersMethodsCore
	],

	crons: [{
		name: "UsersCleaner",
		cronTime: "20 1 * * *",
		onTick: function() {

			this.logger.info("users.crons - Starting to Remove Users that want to Delete their Profile");

			this.getLocalService("users")
				.actions.cleanUsers()
				.then((data) => {
					this.logger.info("users.crons - Users Cleaned up", data);
				})
				.catch(err => {
					console.error('crons.clearUsers error: ', err);
					return this.Promise.reject(new MoleculerClientError("Cron clean users failed", 422, "", []));
				});;
		}
	}],

	/**
	 * Default settings
	 */
	settings: {
		/** Secret for JWT */
		JWT_SECRET: process.env.JWT_SECRET || "jwt-stretchshop-secret",

		/** Public fields */
		fields: ["_id", "username", "email", "type", "subtype", "bio", "image", "company", "addresses", "settings", "data", "dates", "superadmined"],

		/** Validator schema for entity */
		entityValidator: {
			username: { type: "string", min: 2 },//, pattern: /^[a-zA-Z0-9]+$/ },
			password: { type: "string", min: 6 },
			email: { type: "email" },
			type: { type: "string", optional: true },
			subtype: { type: "string", optional: true },
			bio: { type: "string", optional: true },
			image: { type: "string", optional: true },
			dates: { type: "object", optional: true, props: {
				dateCreated: { type: "date", optional: true }, 
				dateLastLogin: { type: "date", optional: true },
				dateUpdated: { type: "date", optional: true }, 
				dateLastVerify: { type: "date", optional: true },
				dateActivated: { type: "date", optional: true },
				dateToBeErased: { type: "date", optional: true }
			} },
			company: { type: "object", optional: true, props: {
				name: { type: "string", optional: true },
				orgId: { type: "string", optional: true },
				taxId: { type: "string", optional: true },
				taxVatId: { type: "string", optional: true }
			} },
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
			ip: { type: "object", optional: true, props: {
				ipRegistration: { type: "string", optional: true },
				ipLastLogin: { type: "string", optional: true }
			} },
			settings: { type: "object", optional: true, props: {
				language: { type: "string", optional: true },
				currency: { type: "string", optional: true }
			} }
		},

		mailSettings: {
			defaultOptions: {
				from: process.env.EMAIL_DEFAULTS_FROM || process.env.SITE_NAME +"\" support\" <support@example.tld>",
				to: "",
				subject: process.env.EMAIL_DEFAULTS_SUBJECT || process.env.SITE_NAME +" - ",
				text: "Hello world!", // plain text body
				html: "<b>Hello world!</b>" // html body
			},
			smtp: {
				host: process.env.EMAIL_SMTP_HOST || "smtp.ethereal.email",
				port: process.env.EMAIL_SMTP_PORT || 587,
				secureConnection: process.env.EMAIL_SMTP_SECURE || false, // true for 465, false for other ports
				auth: {
					user: process.env.EMAIL_SMTP_AUTH_USER || "",
					pass: process.env.EMAIL_SMTP_AUTH_PASS || ""
				},
				tls: {
					ciphers: process.env.EMAIL_SMTP_CIPHERS || "SSLv3"
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
			auth: "optional", // we get user if possible
			params: {
				transLang: { type: "string", optional: true },
				transBlockName: { type: "string", optional: true }
			},
			handler(ctx) {
				let coreData = this.getCoreDataBase(ctx);
				
				delete coreData.settings.business.account;
				// have user, add translations
				if ( ctx.meta.user && ctx.meta.user._id ) {
					return ctx.call("users.me")
						.then(user => {
							if (user && user.user) {
								user.user = this.removePrivateData(user.user);
								coreData.user = user.user;
								// if no transLang use user.settings.lang
								if ( (ctx.params.transLang || ctx.params.transLang.trim()=="") && 
								coreData.user.settings && coreData.user.settings.lang && 
								this.isValidTranslationLanguage(coreData.user.settings.lang, coreData.langs) ) {
									coreData.lang = this.getValueByCode(coreData.langs, coreData.user.settings.lang);
								}
							}
							return ctx.call("users.readTranslation", {
								lang: coreData.lang.code,
								blockName: ctx.params.transBlockName
							})
								.then(translation => {
									coreData.translation = translation;
									if (ctx.params.transLang!=coreData.lang.code) {
										coreData.lang = this.getValueByCode(coreData.langs, ctx.params.transLang);
									}
									coreData = this.specialValuesFromContext(ctx, coreData);
									return coreData;
								});
						})
						.catch(error => {
							this.logger.error("users.getCoreData users.me error:", error);
						});
				} else { // no user
					// get translation if language not default
					if ( coreData.lang.code && coreData.langs &&
					this.isValidTranslationLanguage(coreData.lang.code, coreData.langs) ) {
						return ctx.call("users.readTranslation", {
							lang: coreData.lang.code,
							blockName: ctx.params.transBlockName
						})
							.then(translation => {
								coreData.translation = translation;
								coreData = this.specialValuesFromContext(ctx, coreData);
								return coreData;
							})
							.catch(err => {
								console.error('users.getCoreData error: ', err);
								return this.Promise.reject(new MoleculerClientError("Can't read coredata", 422, "", []));
							});
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
			auth: "required",
			authType: "csrfOnly",
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
					.catch(err => {
						console.error('users.create error: ', err);
						return this.Promise.reject(new MoleculerClientError("Can't create user", 422, "", []));
					})
					.then(() => {
						entity.password = bcrypt.hashSync(entity.password, 10);
						let hashedPwd = entity.password;
						entity.type = "user";
						entity.bio = entity.bio || "";
						entity.image = entity.image || null;
						entity.dates = {
							dateCreated: new Date(),
							dateUpdated: new Date(),
							dateLastVerify: new Date()
						};
						entity.ip = {
							ipRegistration: ctx.meta.remoteAddress+":"+ctx.meta.remotePort,
							ipLastLogin: null
						};
						if ( !entity.settings ) {
							entity.settings = {
								language: ctx.meta.localsDefault.lang,
								currency: ctx.meta.localsDefault.currency
							};
						}

						return this.adapter.insert(entity)
							.then(doc => this.transformDocuments(ctx, {}, doc))
							.then(user => this.transformEntity(user, false, ctx))
							.then(entity => {
								this.entityChanged("created", entity, ctx).then(() => entity);
								this.logger.info("users.create - User Created: ", entity);

								// send email separately asynchronously not waiting for response
								let emailData = {
									"entity": entity,
									"keepItForLater": this.buildHashSourceFromEntity(hashedPwd, entity.user.dates.dateCreated.toISOString()),
									"url": ctx.meta.siteSettings.url+"/"+entity.user.settings.language,
									"language": entity.user.settings.language,
									"templateName": "registration"
								};
								this.sendVerificationEmail(emailData, ctx);

								entity = this.removePrivateData(entity);

								// return user data
								return entity;
							})
							.catch(err => {
								console.error('users.getCoreData insert error: ', err);
								return this.Promise.reject(new MoleculerClientError("Can't insert user", 422, "", []));
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
			auth: "required",
			auth: "csrfOnly",
			params: {
				user: { type: "object", props: {
					email: { type: "email", min: 2 },
					password: { type: "string", min: 2 }
				}},
				remember: { type: "boolean", optional: true },
				admin: { type: "boolean", optional: true }
			},
			handler(ctx) {
				const { email, password } = ctx.params.user;

				return this.adapter.findOne({ email: email })
					.then(user => {
						if (ctx.meta.user && ctx.meta.user.type=="admin" && ctx.params.admin==true) {
							return this.superloginJWT(user, ctx);
						}

						if (!user) {
							return this.Promise.reject(new MoleculerClientError("Email or password is invalid!", 422, "", [{ field: "email", message: "wrong credentials"}]));
						}
						if ( !user.dates.dateActivated || user.dates.dateActivated.toString().trim()=="" || user.dates.dateActivated>new Date() ) {
							return this.Promise.reject(new MoleculerClientError("User not activated", 422, "", [{ field: "email", message: "not activated"}]));
						}
						return bcrypt.compare(password, user.password).then(res => {
							if (!res) {
								return Promise.reject(new MoleculerClientError("Wrong password!", 422, "", [{ field: "email", message: "wrong credentials"}]));
							}
							// save last date and ip of login
							user.dates["dateLastLogin"] = new Date();
							if (!user.ip) {
								user.ip = {
									ipRegistration: null,
									ipLastLogin: null
								};
							}
							user.ip["ipLastLogin"] = ctx.meta.remoteAddress+":"+ctx.meta.remotePort;
							return this.adapter.updateById(user._id, this.prepareForUpdate(user));
						});
					})
					// Transform user entity (remove password and all protected fields)
					.then(doc => {
						return this.transformDocuments(ctx, {}, doc);
					})
					.then(user => {
						if ( ctx.meta.cart ) {
							ctx.meta.cart.user = user._id;
						}

						user = this.removePrivateData(user)

						return this.transformEntity(user, true, ctx);
					})
					.catch(err => {
						console.error('users.login error: ', err);
						return this.Promise.reject(new MoleculerClientError("Login failed", 422, "", []));
					});
			}
		},


		/**
		 * Login as some user
		 *
		 * @actions
		 * @param {Object} email - User credentials
		 *
		 * @returns {Object} Logged in user with token
		 */
		loginAs: {
			auth: "required",
			params: {
				email: { type: "email", min: 2 }
			},
			handler(ctx) {
				if (ctx.meta.user.type=="admin") {
					const email = ctx.params.email;

					return this.Promise.resolve()
						.then(() => this.adapter.findOne({ email: email }))
						.then(user => {
							if (!user) {
								return this.Promise.reject(new MoleculerClientError("Email is invalid!", 422, "", [{ field: "email", message: "not exists"}]));
							}
							if ( !user.dates.dateActivated || user.dates.dateActivated.toString().trim()=="" || user.dates.dateActivated>new Date() ) {
								return this.Promise.reject(new MoleculerClientError("User not activated", 422, "", [{ field: "email", message: "not activated"}]));
							}
							// save last date and ip of login
							user.dates["dateLastLogin"] = new Date();
							if (!user.ip) {
								user.ip = {
									ipRegistration: null,
									ipLastLogin: null
								};
							}
							user.ip["ipLastLogin"] = ctx.meta.remoteAddress+":"+ctx.meta.remotePort;
							return this.adapter.updateById(user._id, this.prepareForUpdate(user));
						})
						// Transform user entity (remove password and all protected fields)
						.then(doc => this.transformDocuments(ctx, {}, doc))
						.then(user => {
							if ( ctx.meta.cart ) {
								ctx.meta.cart.user = user._id;
							}
							return this.transformEntity(user, true, ctx);
						})
						.catch(err => {
							console.error('users.login error: ', err);
							return this.Promise.reject(new MoleculerClientError("Login failed", 422, "", []));
						});
				}
				return this.Promise.reject(new MoleculerClientError("Not authorized!", 422, "", [{ field: "login", message: "unauthorized"}]));
			}
		},


		logout: {
			handler(ctx) {
				ctx.meta.user = null;
				ctx.meta.token = null;
				ctx.meta.userID = null;
				if (ctx.meta.cookies["token"]) {
					delete ctx.meta.cookies["token"];
				}
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
									if (found?.dates?.dateActivated && (new Date(found.dates.dateActivated).getTime() < new Date().getTime()) ) {
										return found;
									}
								});
						}
					})
					.catch(err => {
						console.error('users.resolveToken error: ', err);
						return this.Promise.reject(new MoleculerClientError("Invalid token", 422, "", []));
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
				keys: ["#userID", "dates.dateUpdated"]
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
							return this.transformEntity(user, true, ctx);
						})
						.catch((error) => {
							this.logger.error("users.me error", error);
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
						console.error('users.updateUser error: ', err);
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
					console.error('users.updateMyProfileImage error: ', err);
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
						console.error('users.profile error: ', err);
						return this.Promise.reject(new MoleculerClientError("Can't read profile", 422, "", []));
					});
			}
		},


		checkIfUserExists: {
			auth: "required",
			authType: "csrfOnly",
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
						console.error('users.checkIfUserExists user already exists: ', err);
						return this.Promise.reject(new MoleculerClientError("User already exists", 422, "", [{ field: "username", message: "exists" }]));
					});
			}
		},


		checkIfEmailExists: {
			auth: "required",
			authType: "csrfOnly",
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
						console.error('users.checkIfEmailExists email already exists: ', err);
						return this.Promise.reject(new MoleculerClientError("Email already exists", 422, "", [{ field: "email", message: "exists" }]));
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
				let self = this;
				ctx.params.settings = (typeof ctx.params.settings !== "undefined") ?  ctx.params.settings : null;
				ctx.params.functionSettings = (typeof ctx.params.functionSettings !== "undefined") ?  ctx.params.functionSettings : null;
				// set language of template
				let langCode = (ctx.meta.localsDefault && ctx.meta.localsDefault.lang) || "null";
				if ( ctx.params.functionSettings && typeof ctx.params.functionSettings.language !== "undefined" && ctx.params.functionSettings.language ) {
					langCode = ctx.params.functionSettings.language;
				}
				if ( (langCode == "null" || !langCode) && ctx.params.data && ctx.params.data.order && ctx.params.data.order.lang ) {
					langCode = ctx.params.data.order.lang;
				}
				if ( typeof langCode.code !== "undefined" ) {
					langCode = langCode.code;
				}
				// load templates
				return emailTemplate(ctx.params.template+"-"+langCode, ctx.params.data)
					.then((templates)=>{
						let transporter = nodemailer.createTransport(this.settings.mailSettings.smtp);

						// updates only setting that are set and other remain from default options
						let mailOptions = this.settings.mailSettings.defaultOptions;
						if ( ctx.params.settings ) {
							for (let newProperty in ctx.params.settings) {
								if ( Object.prototype.hasOwnProperty.call(ctx.params.settings,newProperty) && Object.prototype.hasOwnProperty.call(ctx.params.settings,newProperty) ) {
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
						this.logger.info("users.sendEmail - Trying to send email with these options:", mailOptions);

						let emailSentResponse = new Promise(function(resolve, reject) {
							transporter.sendMail(mailOptions, (error, info) => {
								if (error) {
									self.logger.error("users.sendEmail sendMail error: ", error);
									reject(false);
								}
								if ( info && info.messageId ) {
									self.logger.info("users.sendEmail sendMail MessageId: ", info.messageId);
								}
								// Preview only available when sending through an Ethereal account
								self.logger.info("user.sendEmail sendMail messageUrl: ", nodemailer.getTestMessageUrl(info));
								// Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
								// Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
								resolve(true);
							});
						});

						return emailSentResponse.then(result => {
							return result;
						})
							.catch(err => {
								this.logger.error("users.sendEmail - emailSentResponse error:", err);
							});
					})
					.catch(err => {
						this.logger.error("users.sendEmail - template error:", err);
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
				// transform email string to email address
				let re = new RegExp("--", "g");
				let email = ctx.params.email.toString().replace("---", "@").replace(re, ".");
				const TIME_TO_PAST = 60 * 60 * 1000 * 2; // 2 hours
				let oldDate = new Date();
				oldDate.setTime( (new Date().getTime()) - TIME_TO_PAST );
				let hash = "$2b$10$"+decodeURIComponent(ctx.params.hash).toString().replace(re, ".");
				
				this.logger.info("users.verifyHash: ", { 
					email: email, 
					"dates.dateActivated": {"$exists": false},
					"dates.dateLastVerify": {"$gt": oldDate} 
				});
				return this.adapter.find({
					query: { 
						email: email, 
						"dates.dateActivated": {"$exists": false},
						"dates.dateLastVerify": {"$gt": oldDate} 
					}
				})
					.then((found) => {
						if ( found && found.constructor === Array && found.length>0 ) {
							found = found[0];
						}
						if ( found && found.password && found.password.toString().trim()!="" ) {
							let wannabeHash = this.buildHashSourceFromEntity(found.password, found.dates.dateCreated.toISOString(), false);
							return bcrypt.compare(wannabeHash, hash)
								.then((result) => { 
									this.logger.info("users.verifyHash compared:", result);

									if (result) {
										found.dates.dateActivated = new Date();
										return this.adapter.updateById(found._id, this.prepareForUpdate(found))
											.then(doc => {
												return this.transformDocuments(ctx, {}, doc);
											})
											.then(user => {
												return this.transformEntity(user, true, ctx);
											})
											.then(json => {
												return this.entityChanged("updated", json, ctx)
													.then(() => json);
											});
									} else {
										return Promise.reject(new MoleculerClientError("Activation failed!", 422, "", [{ field: "activation", message: "failed"}]));
									}

								});
						}
						return Promise.reject(new MoleculerClientError("Activation failed - try again", 422, "", [{ field: "activation", message: "failed"}]));
					})
					.catch(err => {
						console.error('users.verifyHash activation failed: ', err);
						return Promise.reject(new MoleculerClientError("Activation failed - try again", 422, "", [{ field: "activation", message: "failed"}]));
					});
				/**
				 * - verify hash (by email) & date stored in dates.dateLastVerify (2 hours),
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
			auth: "required",
			authType: "csrfOnly",
			params: {
				email: { type: "string" }
			},
			handler(ctx) {
				this.logger.info("users.resetPassword params.email: ", ctx.params.email);
				return this.adapter.findOne({ email: ctx.params.email })
					.then((found) => {
						if ( found ) {
							delete found.dates.dateActivated;
							found.dates.dateUpdated = new Date();
							if ( !found.settings ) {
								found.settings = {
									language: ctx.meta.localsDefault.lang,
									currency: ctx.meta.localsDefault.currency
								};
							}

							let forUpdateUser = this.prepareForUpdate(found);
							// set date of last update (and settings if not set)
							return this.adapter.updateById(found._id, forUpdateUser)
								.then(updated => {
									// remove activation date
									return this.adapter.updateById(found._id, {
										"$unset": { "dates.dateActivated":1 }})
										.then(removedActivation => {
											let entity = { user : updated };
											// send email separately asynchronously not waiting for response
											let emailData = {
												"entity": entity,
												"keepItForLater": this.buildHashSourceFromEntity(entity.user.password, entity.user.dates.dateCreated),
												"url": ctx.meta.siteSettings.url+"/"+entity.user.settings.language,
												"language": entity.user.settings.language,
												"templateName": "pwdreset"
											};
											this.sendVerificationEmail(emailData, ctx);
											this.logger.info("users.resetPassword - Email sent");
		
											return entity.user;
										});
								});
						}
						return Promise.reject(new MoleculerClientError("Account reset failed - try again", 422, "", [{ field: "email", message: "not found"}]));
					})
					.catch(err => {
						console.error('users.resetPassword account reset failed: ', err);
						return Promise.reject(new MoleculerClientError("Account reset failed - try again", 422, "", [{ field: "email", message: "not found"}]));
					});
				/**
				 * - verify hash (by email) & date stored in dates.dateLastVerify (2 hours),
				 * - set activated date if activate action,
				 * - set token,
				 * - redirect to profile page
				 */
			}
		},


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
						console.error('users.readTranslation failed: ', err);
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
				return fs.writeJson(
					ctx.meta.siteSettings.translation.dictionaryPath, 
					ctx.params.dictionary, 
					{ spaces: 2 }
				).then(() => {
					return { success: true };
				})
				.catch(err => {
					console.error('settings.mixin updateSettingsFile write error: ', err);
					return { success: false, error: err };
				});
			}
		},


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
										let path = ctx.meta.siteSettings.assets.folder +"/"+ process.env.ASSETS_PATH + ctx.params.type +"/"+ productCodePath +"/"+ ctx.params.image;
										return new Promise((resolve, reject) => {
											fs.unlink(path, (err) => {
												if (err) {
													this.logger.error("users.deleteUserImage error:", err);
													reject( {success: false, message: "delete failed"} );
												}
												this.logger.info("users.deleteUserImage - DELETED file: ", path);
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
						//--
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
										let productCodePath = categories[0].slug;
										let path = ctx.meta.siteSettings.assets.folder +"/"+ process.env.ASSETS_PATH + ctx.params.type +"/"+ productCodePath +"/"+ ctx.params.image;
										return new Promise((resolve, reject) => {
											fs.unlink(path, (err) => {
												if (err) {
													this.logger.error("users.deleteUserImage error:", err);
													reject( {success: false, message: "delete failed"} );
												}
												this.logger.info("users.deleteUserImage - DELETED file: ", path);
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
					} else if ( ctx.params.type=="pages" ) {
						//--
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
										let pageCodePath = pages[0].slug;
										let path = ctx.meta.siteSettings.assets.folder +"/"+ process.env.ASSETS_PATH + ctx.params.type +"/cover/"+ pageCodePath +"/"+ ctx.params.image;
										return new Promise((resolve, reject) => {
											fs.unlink(path, (err) => {
												if (err) {
													this.logger.error("users.deleteUserImage error:", err);
													reject( {success: false, message: "delete failed"} );
												}
												this.logger.info("users.deleteUserImage - DELETED file: ", path);
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
		}, 


		/**
		 * set profile to be removed in 14 days
		 */
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
									console.error('users.clearUsers user error: ', user, err);
									return this.Promise.reject(new MoleculerClientError("Can't erase user", 422, "", []));
								});
						} else {
							return Promise.resolve([]);
						}
					})
					.catch(err => {
						console.error('users.clearUsers error: ', err);
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
						console.error('users.recaptcha error: ', err);
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
			params: {
				userId: { type: "string" },
				productCodes: { type: "array", items: { type: "string" } }
			},
			handler(ctx) {
				let self = this;

				return this.adapter.findOne({ id: self.fixStringToId(ctx.params.userId) })
					.then((foundUser) => {
						if ( !foundUser.data ) { foundUser.data = { contentDependencies: { list: [] } } };
						if ( !foundUser.data.contentDependencies ) { foundUser.data.contentDependencies = { list: [] } };
						if ( !foundUser.data.contentDependencies.list ) { foundUser.data.contentDependencies.list = [] };
						if ( foundUser && productCodes.length > 0 ) {
							foundUser.data.contentDependencies.list = productCodes.filter((item, index, array) => array.indexOf(item) == index)
						}
						return foundUser;
					})
					.catch(err => {
						this.logger.error("users.updateContentDependencies error:", err);
					})
					.then((updatedUser) => {
						return this.adapter.updateById(updatedUser._id, this.prepareForUpdate(updatedUser));
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
			params: {
				userId: { type: "string" },
				productCodes: { type: "array", items: { type: "string" } }
			},
			handler(ctx) {
				let self = this;

				return this.adapter.findOne({ id: self.fixStringToId(ctx.params.userId) })
					.then((foundUser) => {
						if ( foundUser && productCodes.length > 0 ) {
							productCodes.forEach(code => {
								const foundIndex = foundUser.data.contentDependencies.list.indexOf(code);
								if ( foundIndex > -1 ) {
									foundUser.data.contentDependencies.list.splice(foundIndex, 1);
								}
							});
						}
						return foundUser;
					})
					.catch(err => {
						this.logger.error("users.removeContentDependencies error:", err);
					})
					.then((updatedUser) => {
						return this.adapter.updateById(updatedUser._id, this.prepareForUpdate(updatedUser));
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



	},



	/**
	 * Core methods required by this service are located in
	 * /methods/code.methods.js
	 */
	methods: {
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
