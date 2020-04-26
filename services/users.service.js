"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("moleculer-cron");

require("dotenv").config();
const bcrypt 		= require("bcryptjs");
const jwt 			= require("jsonwebtoken");
const nodemailer = require("nodemailer");
const fs = require("fs");
const fetch 		= require("node-fetch");

const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");
const emailTemplate = require("../mixins/email.mixin");
const validateAddress = require("../mixins/validate.address.mixin");
const HelpersMixin = require("../mixins/helpers.mixin");

const sppf = require("../mixins/subprojpathfix");
let resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojpathfix(__dirname, "/../resources");
const NavigationMain = require(resourcesDirectory+"/navigation/navigation-main");
const NavigationFooter = require(resourcesDirectory+"/navigation/navigation-footer");
const businessSettings = require( resourcesDirectory+"/settings/business");

module.exports = {
	name: "users",
	mixins: [
		DbService("users"),
		CacheCleanerMixin([
			"cache.clean.users",
		]),
		HelpersMixin, 
		Cron
	],

	crons: [{
		name: "UsersCleaner",
		cronTime: "20 1 * * *",
		onTick: function() {

			console.log("Starting to Remove Users that want to Delete their Profile");

			this.getLocalService("users")
				.actions.cleanUsers()
				.then((data) => {
					console.log("Users Cleaned up", data);
				});
		}
	}],

	/**
	 * Default settings
	 */
	settings: {
		/** Secret for JWT */
		JWT_SECRET: process.env.JWT_SECRET || "jwt-stretchshop-secret",

		/** Public fields */
		fields: ["_id", "username", "email", "type", "subtype", "bio", "image", "company", "addresses", "settings", "dates"],

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
				registration: { type: "string", optional: true },
				lastUsed: { type: "string", optional: true }
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
							coreData.langs[i]["default"] = true;
							coreData.lang = coreData.langs[i];
							break;
						}
					}
				}
				// set full currency
				if ( coreData.currency && coreData.currencies ) {
					for (let i = 0; i<coreData.currencies.length; i++) {
						if (coreData.currencies[i].code==coreData.currency) {
							coreData.currencies[i]["default"] = true;
							coreData.currency = coreData.currencies[i];
							break;
						}
					}
				}
				// set full country
				if ( coreData.country && coreData.countries ) {
					for (let i = 0; i<coreData.countries.length; i++) {
						if (coreData.countries[i].code==coreData.country) {
							coreData.countries[i]["default"] = true;
							coreData.country = coreData.countries[i];
							break;
						}
					}
				}

				coreData.navigation = { 
					main: NavigationMain,
					footer: NavigationFooter
				};

				// get other details - user and translation
				coreData.user = null;
				coreData.translation = null;
				coreData.settings = {
					assets: {
						url: process.env.ASSETS_URL
					},
					business: businessSettings.invoiceData.company,
					taxData: businessSettings.taxData.global
				};
				delete coreData.settings.business.account;
				if ( ctx.meta.user && ctx.meta.user._id ) {
					return ctx.call("users.me")
						.then(user => {
							if (user && user.user) {
								coreData.user = user.user;
							}
							// get translation if language not default
							if ( ctx.params.transLang && ctx.params.transLang!="" && coreData.langs ) {
								// if valid language
								if ( this.isValidTranslationLanguage(ctx.params.transLang, coreData.langs) ) {
									return ctx.call("users.readTranslation", {
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
						})
						.catch(error => {
							console.log("\nusers.getCoreData users.me error:", error);
						});
				} else { // no user
					// get translation if language not default
					if ( ctx.params.transLang && ctx.params.transLang!="" && coreData.langs ) {
						// if valid language && not default
						if ( this.isValidTranslationLanguage(ctx.params.transLang, coreData.langs) &&
						ctx.params.transLang!=coreData.lang.code ) {
							return ctx.call("users.readTranslation", {
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
						console.log("password before hashed", entity.password);
						entity.password = bcrypt.hashSync(entity.password, 10);
						console.log("password hashed", entity.password);
						let hashedPwd = entity.password;
						entity.type = "user";
						entity.bio = entity.bio || "";
						entity.image = entity.image || null;
						entity.dates = {
							dateCreated: new Date(),
							dateUpdated: new Date(),
							dateLastVerify: new Date()
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
								console.log("\n\n User Created: ", entity, "\n\n\n");

								// send email separately asynchronously not waiting for response
								console.log("\n\n buildHashSourceFromEntity(1)", hashedPwd, entity.user.dates.dateCreated.toISOString());
								let emailData = {
									"entity": entity,
									"keepItForLater": this.buildHashSourceFromEntity(hashedPwd, entity.user.dates.dateCreated.toISOString()),
									"url": ctx.meta.siteSettings.url+"/"+entity.user.settings.language,
									"language": entity.user.settings.language,
									"templateName": "registration"
								};
								console.log("hash compare(1.0)", this.buildHashSourceFromEntity(hashedPwd, entity.user.dates.dateCreated.toISOString(), false));
								console.log("hash compare(1)", emailData.keepItForLater);
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
					email: { type: "email", min: 2 },
					password: { type: "string", min: 2 }
				}},
				remember: { type: "boolean", optional: true }
			},
			handler(ctx) {
				const { email, password } = ctx.params.user;

				return this.Promise.resolve()
					.then(() => this.adapter.findOne({ email: email }))
					.then(user => {
						if (!user) {
							return this.Promise.reject(new MoleculerClientError("Email or password is invalid!", 422, "", [{ field: "email", message: "wrong credentials"}]));
						}
						if ( !user.dates.dateActivated || user.dates.dateActivated.toString().trim()=="" || user.dates.dateActivated>new Date() ) {
							return this.Promise.reject(new MoleculerClientError("User not activated", 422, "", [{ field: "email", message: "not activated"}]));
						}

						console.log("compare pwds:", password, user.password);
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
						return this.transformEntity(user, true, ctx);
					});
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
									if (found.dates.dateActivated && (new Date(found.dates.dateActivated).getTime() < new Date().getTime()) ) {
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
								});
						}
						return Promise.reject(new MoleculerClientError("User not valid", 422, "", [{ field: "user", message: "invalid"}]));
					})
					.then(doc => this.transformDocuments(ctx, {}, doc))
					.then(user => this.transformEntity(user, false, ctx))
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
				let user = ctx.meta.user;
				user.image = ctx.params.data.image;
				user.dates.dateUpdated = new Date();
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
								this.transformDocuments(ctx, {}, user);
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
				ctx.params.settings = (typeof ctx.params.settings !== "undefined") ?  ctx.params.settings : null;
				ctx.params.functionSettings = (typeof ctx.params.functionSettings !== "undefined") ?  ctx.params.functionSettings : null;
				// set language of template
				let langCode = ctx.meta.localsDefault.lang || "null";
				if ( ctx.params.functionSettings && typeof ctx.params.functionSettings.language !== "undefined" && ctx.params.functionSettings.language ) {
					langCode = ctx.params.functionSettings.language;
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
				// transform email string to email address
				let re = new RegExp("--", "g");
				let email = ctx.params.email.toString().replace("---", "@").replace(re, ".");
				const TIME_TO_PAST = 60 * 60 * 1000 * 2; // 2 hours
				let oldDate = new Date();
				oldDate.setTime( (new Date().getTime()) - TIME_TO_PAST );
				let hash = "$2b$10$"+decodeURIComponent(ctx.params.hash).toString().replace(re, ".");
				console.log("xxxxxx", email, { 
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
							console.log("\n\n buildHashSourceFromEntity(2):", found.password, found.dates.dateCreated.toISOString());
							let wannabeHash = this.buildHashSourceFromEntity(found.password, found.dates.dateCreated.toISOString(), false);
							console.log("\nhash compare(2) - string 2B hashed: ", wannabeHash);
							console.log("\nhash compare(2.1) - hash from url to compare, with prefix: ", hash);
							return bcrypt.compare(wannabeHash, hash)
								.then((result) => { 
									console.log("\nresult:", result);

									if (result) {
										found.dates.dateActivated = new Date();
										return this.adapter.updateById(found._id, this.prepareForUpdate(found))
											.then(doc => {
												return this.transformDocuments(ctx, {}, doc);
											})
											.then(user => {
												console.log("\n\nACTIVATION:", user);
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
						console.log("found:", found);
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
			params: {
				email: { type: "string" }
			},
			handler(ctx) {
				return this.adapter.findOne({ email: ctx.params.email })
					.then((found) => {
						if ( found ) {
							console.log("\n\n Reset password: ", found, "\n\n\n");
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
												"keepItForLater": this.buildHashSourceFromEntity(entity.user.password, entity.dates.dateCreated),
												"url": ctx.meta.siteSettings.url+"/"+entity.user.settings.language,
												"language": entity.user.settings.language,
												"templateName": "pwdreset" // TODO - create email templates
											};
											this.sendVerificationEmail(emailData, ctx);
		
											return entity.user;
										});
								});
						}
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
				blockName: { type: "string", optional: true }
			},
			handler(ctx) {
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
							translation = this.extractTranslation(transFileResult, ctx.params.lang, ctx.params.blockName);
						}
						return translation;
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
						//--
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
		}, 


		/**
		 * set profile to be removed in 14 days
		 */
		deleteProfile: {
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
							console.log("Delete profile error", error);
							return this.Promise.reject(new MoleculerClientError("User not found!", 400));
						})
						.then(user => {
							user.dates.dateToBeErased = new Date();
							user.dates.dateToBeErased.setDate( user.dates.dateToBeErased.getDate() + 14);
							user.dates.dateUpdated = new Date();

							// configuring email message
							let emailSetup = {
								settings: {
									to: user.email
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
							// sending email
							ctx.call("users.sendEmail", emailSetup).then(json => {
								console.log("\nemail sent _____---... "+json+"\n\n");
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
							console.log("Delete profile error", error);
							return this.Promise.reject(new MoleculerClientError("User not found!", 400));
						})
						.then(user => {
							user.dates.dateToBeErased = null;
							user.dates.dateUpdated = new Date();

							// configuring email message
							let emailSetup = {
								settings: {
									to: user.email
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
								console.log("\nemail sent _____---... "+json+"\n\n");
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
						found.forEach(user => {
							promises.push( 
								ctx.call("users.remove", {id: user._id} )
									.then(removed => {
										return "Removed users: " +JSON.stringify(removed);
									})
							);
						});
						// return all delete results
						return Promise.all(promises).then((result) => {
							return result;
						});
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
				console.log("recaptcha requestBody:", requestBody);
				return fetch(process.env.RECAPTCHA_URL, {
					method: "post",
					body:    requestBody,
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
				})
					.then(res => res.json()) // expecting a json response, checking it
					.then(recaptchaResponse => {
						console.log("recaptchaResponse:", recaptchaResponse);
						return recaptchaResponse.success;
					});
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
		generateJWT(user, ctx) { //
			const today = new Date();
			const exp = new Date(today);
			exp.setDate(today.getDate() + 60);

			const generatedJwt = jwt.sign({
				id: user._id,
				username: user.username,
				exp: Math.floor(exp.getTime() / 1000)
			}, this.settings.JWT_SECRET);

			console.log("\n\nu sers.Generating JWT - cookies:", ctx.meta.cookies);
			if ( ctx.meta.cookies ) {
				if (!ctx.meta.makeCookies) {
					ctx.meta.makeCookies = {};
				}
				ctx.meta.makeCookies["token"] = {
					value: generatedJwt,
					options: {
						path: "/",
						signed: true,
						expires: exp,
						secure: ((process.env.COOKIES_SECURE && process.env.COOKIES_SECURE==true) ? true : false),
						httpOnly: true
					}
				};
				if ( process.env.COOKIES_SAME_SITE ) {
					ctx.meta.makeCookies["token"].options["sameSite"] = process.env.COOKIES_SAME_SITE;
				}
				console.log("\n\nu sers.Generating JWT - ctx.meta.makeCookies:", ctx.meta.makeCookies);
			}

			return generatedJwt;
		},


		/**
		 * Transform returned user entity. Generate JWT token if neccessary.
		 *
		 * @param {Object} user
		 * @param {Boolean} withToken
		 */
		transformEntity(user, withToken, ctx) {
			if (user) {
				user.image = user.image || "";
				if (withToken) {
					ctx.meta.token = this.generateJWT(user, ctx);
				}
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
			if ( loggedUser && loggedUser._id && loggedUser._id.toString().trim()!="" ) {
				// if loggedUser is admin and userUpdate data contain _id of user to update - can update any user
				if ( loggedUser.type=="admin" && userUpdate._id && userUpdate._id.toString().trim()!="" ) {
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
				for (let property in addressNew) {
					if ( Object.prototype.hasOwnProperty.call(resultAddress,property) && Object.prototype.hasOwnProperty.call(addressNew,property)) {
						resultAddress[property] = addressNew[property];
					}
				}
			}

			return resultAddress;
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
							if ((typeof blockName !== "undefined" && blockName!="" &&
							transData.dictionary.records[i].occurrences[j].blockName &&
							transData.dictionary.records[i].occurrences[j].blockName==blockName) ||
							typeof blockName === "undefined") {
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
			let re = new RegExp("\\.", "g");
			// get url from hashed string without first 7 chars ("$2b$10$")
			let hash = emailData.keepItForLater.toString().substring(7);
			hash = encodeURIComponent(hash).replace(re, "--");
			// get email string
			let email = emailData.entity.user.email.toString().replace(re, "--").replace("@", "---");
			// create activation link
			let confirmLink = emailData.url+"/user/verify/"+encodeURIComponent(email)+"/"+hash; // using email to identify and hash to verify
			// setup object for sending email
			let emailSetup = {
				settings: {
					to: emailData.entity.user.email,
					subject: process.env.SITE_NAME +" - Welcome - please activate"
				},
				functionSettings: {
					language: emailData.lang
				},
				template: emailData.templateName,
				data: {
					webname: process.env.SITE_NAME, 
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


		buildHashSourceFromEntity(string1, string2, hashedParam) {
			// don't hash only if hashedParam is false
			let hashed = (typeof hashedParam!=="undefined" && hashedParam===false) ? false : true;
			let comboString = string1.substr(12,10)+string2+string1.substr(30);
			if (!hashed) {
				return comboString;
			}
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
