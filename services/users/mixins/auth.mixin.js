"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

module.exports = {
	actions: {
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
			authType: "csrfCheck",
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
				this.logger.info("users.create INCOMING", ctx.params.user);
				let entity = ctx.params.user;
				this.logger.info("users.create entity", entity);

				return this.enforceRateLimit(ctx, "register", { limit: 3, windowMs: 60 * 60 * 1000 })
					.then(() => this.validateEntity(entity))
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
						if (err?.code === 429) {
							return Promise.reject(err);
						}
						console.error("users.create error: ", err);
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
									"templateName": "auth/registration"
								};
								this.sendVerificationEmail(emailData, ctx);

								entity = this.removePrivateData(entity);

								// return user data
								return entity;
							})
							.catch(err => {
								console.error("users.getCoreData insert error: ", err);
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
			authType: "csrfCheck",
			params: {
				user: { type: "object", props: {
					email: { type: "email", min: 2 },
					password: { type: "string", min: 2 }
				}},
				remember: { type: "boolean", optional: true }
			},
			handler(ctx) {
				const { email, password } = ctx.params.user;

				return this.enforceRateLimit(ctx, "login", { limit: 5, windowMs: 15 * 60 * 1000 })
					.then(() => this.adapter.findOne({ email: email }))
					.then(user => {
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

						user = this.removePrivateData(user);

						return this.transformEntity(user, true, ctx);
					})
					.catch(err => {
						console.error("users.login error: ", err);
						return this.Promise.reject(new MoleculerClientError("Login failed", 422, "", []));
					});
			}
		},


		/**
		 * Impersonate a non-admin user (admin only).
		 *
		 * @actions
		 * @param {String} email - Target user email
		 *
		 * @returns {Object} Impersonated user with token + superadmined flag
		 */
		loginAs: {
			auth: "required",
			params: {
				email: { type: "email", min: 2 }
			},
			handler(ctx) {
				if (ctx.meta.user?.type !== "admin") {
					return this.Promise.reject(new MoleculerClientError("Not authorized!", 403, "", [{ field: "login", message: "unauthorized"}]));
				}

				return this.enforceRateLimit(ctx, "impersonate", { limit: 10, windowMs: 15 * 60 * 1000 })
					.then(() => this.adapter.findOne({ email: ctx.params.email }))
					.then(user => this.superloginJWT(user, ctx))
					.catch(err => {
						if (err instanceof MoleculerClientError) {
							return this.Promise.reject(err);
						}
						console.error("users.loginAs error: ", err);
						return this.Promise.reject(new MoleculerClientError("Login failed", 422, "", []));
					});
			}
		},


		/**
		 * Restore admin session after impersonation.
		 *
		 * @actions
		 * @returns {Object} Admin user with token
		 */
		restoreAdmin: {
			auth: "required",
			params: {},
			handler(ctx) {
				return this.enforceRateLimit(ctx, "restoreAdmin", { limit: 20, windowMs: 15 * 60 * 1000 })
					.then(() => this.restoreAdminSession(ctx))
					.catch(err => {
						if (err instanceof MoleculerClientError) {
							return this.Promise.reject(err);
						}
						console.error("users.restoreAdmin error: ", err);
						return this.Promise.reject(new MoleculerClientError("Restore failed", 422, "", []));
					});
			}
		},


		logout: {
			handler(ctx) {
				ctx.meta.user = null;
				ctx.meta.token = null;
				ctx.meta.userID = null;
				if (ctx.meta.cookies?.["token"]) {
					delete ctx.meta.cookies["token"];
				}
				if (!ctx.meta.makeCookies) {
					ctx.meta.makeCookies = {};
				}
				const clearOpts = {
					path: "/",
					signed: true,
					expires: new Date(0),
					secure: require("../../../mixins/env.helpers").isCookiesSecure(),
					httpOnly: true
				};
				if (process.env.COOKIES_SAME_SITE) {
					clearOpts.sameSite = process.env.COOKIES_SAME_SITE;
				}
				ctx.meta.makeCookies["token"] = { value: "", options: clearOpts };
				ctx.meta.makeCookies["admin_token"] = { value: "", options: { ...clearOpts } };
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
					jwt.verify(ctx.params.token, this.settings.JWT_SECRET, { algorithms: ["HS256"] }, (err, decoded) => {
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
									if (found?.dates?.dateActivated && (new Date(found.dates.dateActivated).getTime() < Date.now()) ) {
										if (decoded.actAs) {
											found.actAs = true;
											found.adminId = decoded.adminId ? String(decoded.adminId) : undefined;
											found.superadmined = true;
										}
										return found;
									}
								});
						}
					})
					.catch(err => {
						console.error("users.resolveToken error: ", err);
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
				if ( ctx.meta.user?._id ) {
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
						.then(entity => {
							if (ctx.meta.user?.actAs || ctx.meta.actAs) {
								entity.user.superadmined = true;
								entity.user.adminId = ctx.meta.user?.adminId || ctx.meta.adminId;
							}
							return entity;
						})
						.catch((error) => {
							this.logger.error("users.me error", error);
							return null;
						});
				}
			}
		},
	}
};
