"use strict";

const Cookies = require("cookies");
const crypto = require("node:crypto");
const ApiGateway = require("moleculer-web");
const fs = require("fs-extra");
const formidable = require("formidable");
const jwt = require("jsonwebtoken");
const _ = require("lodash");

const SettingsMixin = require("../../../mixins/settings.mixin");
const { getRequiredSecret } = require("../../../mixins/env.helpers");

const E = require("moleculer-web").Errors;



module.exports = {

	/**
	 * Methods
	 */

	methods: {
		setCookie(ctx, name, value, options) {
			if (!ctx.meta.makeCookies) {
				ctx.meta.makeCookies = {};
			}
			if (!options.path) {
				options["path"] = "/";
			}
			ctx.meta.makeCookies[name] = {
				value: value,
				options: options
			};
			if (process.env.COOKIES_SAME_SITE) {
				ctx.meta.makeCookies[name].options["sameSite"] = options?.secure === true ? "None" : process.env.COOKIES_SAME_SITE;
			}
			ctx.meta.cookies[name] = value;
		},

		/**
		 * Manage user independent application cookies - eg. cart, csrf
		 * 
		 * @param {Object} ctx 
		 * @param {String} route 
		 * @param {Object} req 
		 * @param {Object} res 
		 */
		cookiesManagement(ctx, route, req, res) {
			const cookieKey = getRequiredSecret("COOKIES_KEY", "Lvj1MalbaTe6k");
			const bsKeys = SettingsMixin.getSiteSettings("business", true);

			res.cookies = new Cookies(req, res, { keys: [cookieKey] });

			const cookies = this.parseCookies(req.headers.cookie);
			ctx.meta.cookies = cookies;
			let cookieSecure = require("../../../mixins/env.helpers").isCookiesSecure();
			// CART cookie
			if (!cookies.cart) {
				const name = "cart";
				const hash = crypto.createHash("sha256");
				const userCookieString = ctx.meta.remoteAddress + "--" + new Date().toISOString();
				hash.update(userCookieString);
				const value = hash.digest("hex");
				//--
				if (cookieSecure) {
					this.setCookie(ctx, name, value, {
						signed: true,
						secure: true,
						httpOnly: true
					});
				} else {
					res.cookies.set(name, value, {
						path: "/",
						signed: true,
						secure: false,
						httpOnly: true,
						sameSite: process?.env?.COOKIES_SAME_SITE ? process.env.COOKIES_SAME_SITE : true,
					});
					ctx.meta.cookies[name] = value;
				}
			}

			// CSRF cookie (intentionally readable by JS for double-submit Authorization header).
			// Auth JWT remains HttpOnly; keep XSS surface minimal (sanitize HTML) and SameSite set.
			if (!cookies.session) {
				const csrfDate = new Date();
				const name = "session";
				const hash = crypto.createHash("sha256");
				const sessionCookieString = ctx.meta.remoteAddress + "--" + csrfDate.getTime() + "--" + bsKeys.invoiceData?.company?.name + "--" + crypto.randomBytes(20).toString("hex");
				hash.update(sessionCookieString);
				const hashValue = hash.digest("hex");
				const value = jwt.sign({
					ip: ctx.meta.remoteAddress,
					issued: csrfDate.getTime(),
					token: hashValue
				}, this.settings.JWT_SECRET);
				//--
				let sameSite = process?.env?.COOKIES_SAME_SITE ? process.env.COOKIES_SAME_SITE : true;
				if (cookieSecure) {
					sameSite = "None";
				}
				if (cookieSecure) {
					this.setCookie(ctx, name, value, {
						signed: true,
						secure: true,
						httpOnly: false
					});
				} else {
					res.cookies.set(name, value, {
						path: "/",
						signed: true,
						secure: false,
						sameSite: sameSite,
						httpOnly: false,
					});
				}
				ctx.meta.cookies[name] = value;
			}
		},


		/**
		 * Check if CSRF token is valid
		 *
		 * @param {Context} ctx
		 * @param {IncomingRequest} req
		 * @returns {Boolean}
		 */
		checkCsrfToken(ctx, req) {
			if (ctx.meta.headers?.authorization) {
				const cookies = this.parseCookies(req.headers.cookie);
				const token = ctx.meta.headers.authorization.split("Token ");
				if (token[1] && cookies.session) {
					let cookieData;
					try {
						cookieData = jwt.verify(cookies.session, this.settings.JWT_SECRET, { algorithms: ["HS256"] });
					} catch {
						this.logger.warn("CSRF session cookie verification failed");
						return false;
					}
					const verifyKey = ctx.meta.remoteAddress + "--" + cookieData?.issued;
					try {
						const decoded = jwt.verify(token[1].trim(), verifyKey, { algorithms: ["HS256"] });
						if (decoded) {
							if (decoded.token === cookieData?.token) {
								return true;
							}
							this.logger.warn("CSRF token mismatch");
							return false;
						}
					} catch (e) {
						this.logger.warn("CSRF token verification failed");
						return false;
					}
				}
			}
			return false;
		},



		/**
		 * Authenticate the request. It check the `Authorization` token 
		 * value in the request header.
		 * Check the token value & resolve the user by the token.
		 * The resolved user will be available in `ctx.meta.user`
		 *
		 * @param {Context} ctx
		 * @param {Object} route
		 * @param {IncomingRequest} req
		 * @returns {Promise}
		 */
		authenticate(ctx, route, req, res) {
			ctx.meta.headers = req.headers;
			let csrfResult = false;

			// check csrf token
			try {
				if (req?.$action?.authType === "csrfCheck") {
					if (this.checkCsrfToken(ctx, req)) {
						// stops further processing, returning null user
						return this.Promise.resolve(null); // needed for login
					} else {
						return this.Promise.reject(new E.UnAuthorizedError(E.ERR_INVALID_TOKEN));
					}
				}
				// if auth is required, get also csrf token result
				csrfResult = this.checkCsrfToken(ctx, req);
			} catch (e) {
				this.logger.error("Csrf Token error: ", e);
			}
			this.cookiesManagement(ctx, route, req, res);

			// get user token from cookie
			let token = "";
			ctx.meta.token = null;
			if (ctx.meta?.cookies?.token) {
				ctx.meta.token = ctx.meta.cookies.token;
				token = ctx.meta.token;
			}

			// Require CSRF for cookie-authenticated / auth-required mutating requests
			const method = (req.method || "").toUpperCase();
			const isSafe = ["GET", "HEAD", "OPTIONS"].includes(method);
			const aliasPath = req.$alias?.path || req.url || "";
			const skipCsrf =
				req.$action?.authType === "csrfOnly" ||
				String(aliasPath).includes("payment/webhook") ||
				String(aliasPath).includes("/webhook");
			if (!isSafe && !skipCsrf) {
				const needsCsrf =
					req.$action?.auth === "required" ||
					!!(ctx.meta?.cookies?.token) ||
					String(aliasPath).includes("order/payment");
				if (needsCsrf && !csrfResult) {
					return this.Promise.reject(new E.UnAuthorizedError(E.ERR_INVALID_TOKEN));
				}
			}

			// authorization core
			return this.Promise.resolve(token)
				.then(token => {
					if (token && token.toString().trim() !== "") {
						return ctx.call("users.resolveToken", { token: token })
							.then(user => {
								if (user !== undefined && user && user.length > 0) {
									user = user[0];
								}
								if (user) {
									user = _.pick(user, ["_id", "externalId", "username", "email", "image", "type", "subtype", "addresses", "settings", "data", "dates", "restrictions", "actAs", "adminId", "superadmined"]);
									ctx.meta.token = token;
									ctx.meta.userID = user._id;
									if (user.actAs) {
										ctx.meta.actAs = true;
										ctx.meta.adminId = user.adminId;
									}
									return user;
								}
							})
							.catch(() => {
								throw new ApiGateway.Errors.UnAuthorizedError("NO_RIGHTS");
							});
					}
				})
				.then(user => {
					// compare the current request api endpoint path with the user restrictions
					if (user?.restrictions && user.restrictions.length > 0) {
						const reqMethod = (req.method || "").toUpperCase();
						this.logger.info("api.authenticate() reqMethod: ", reqMethod);

						// compare all user restrictions with the current request api endpoint path
						// if current api endpoint path includes any of the user restrictions, throw an error
						const restricted = user.restrictions.some(restriction => {
							let restrictionPath = "";
							let restrictionMethod = "*";
							if (restriction.includes(" ")) {
								restrictionPath = restriction.split(" ")[1];
								restrictionMethod = restriction.split(" ")[0];
							} else {
								restrictionPath = restriction;
							}
							this.logger.info("api.authenticate() restrictionMethod & path: ", restrictionMethod, restrictionPath);
							return !!((restrictionMethod === "*" && req.parsedUrl.includes(restrictionPath)) ||
								(restrictionMethod === reqMethod && req.parsedUrl.includes(restrictionPath)));
						});
						if (restricted) {
							this.logger.warn("api.authenticate() RESTRICTION_VIOLATION: ", user.restrictions, req.parsedUrl);
							// return an error to the client
							throw new ApiGateway.Errors.UnAuthorizedError("RESTRICTION_VIOLATION");
						}
					}
					return user;
				})
				.then(user => {
					if (req.$action?.auth == "required" && !user) {
						throw new ApiGateway.Errors.UnAuthorizedError("NO_RIGHTS");
					}
					return user;
				})
				.catch(err => {
					if (!(err instanceof ApiGateway.Errors.UnAuthorizedError)) {
						this.logger.warn("Authentication failed", err);
						throw new ApiGateway.Errors.UnAuthorizedError("AUTHENTICATION_FAILED");
					}
					throw err;
				});
		},


		respondUploadError(res, status, error) {
			if (res.headersSent || res.writableEnded) {
				return;
			}
			try {
				res.writeHead(status, { "content-type": "application/json" });
			} catch {
				// Headers may already be partially sent.
			}
			try {
				res.end(JSON.stringify({ success: false, error }));
			} catch (err) {
				this.logger.error("api.respondUploadError() failed to write response", err);
			}
		},

		/**
		 * parse form with uploaded files, copy files according to paths
		 * allowed: jpeg, png, webp, gif, pdf, zip
		 */
		parseUploadedFile(req, res, activePath) {
			const self = this;
			this.logger.info("api.parseUploadedFile() #1", typeof formidable);
			const ALLOWED_MIME = new Set([
				"image/jpeg",
				"image/png",
				"image/webp",
				"image/gif",
				"application/pdf",
				"application/zip",
			]);

			const finishParseError = (err, status = 400, message = "Upload failed") => {
				self.logger.error("api.parseUploadedFile() ERROR:", err);
				self.respondUploadError(res, status, message);
			};

			try {
				const form = formidable.formidable({
					multiples: true,
					maxFileSize: 5 * 1024 * 1024,
					filter({ mimetype }) {
						self.logger.info("api.parseUploadedFile() MIMETYPE: ", mimetype);
						return ALLOWED_MIME.has(mimetype);
					},
				});
				this.logger.info("api.parseUploadedFile() #2", form);
				return form.parse(req, (err, fields, files) => {
					try {
						self.logger.info("api.parseUploadedFile() #2.5", err, fields, files);
						if (err) {
							finishParseError(err, 400, "Upload failed");
							return;
						}
						if (!files || typeof files !== "object") {
							finishParseError(new Error("missing files"), 400, "No file uploaded");
							return;
						}

						let promises = [];
						self.logger.info("api.parseUploadedFile() #3", files, fields);

						for (let property in files) {
							if (!Object.hasOwn(files, property)) {
								continue;
							}

							const uploaded = Array.isArray(files[property]) ? files[property][0] : files[property];
							if (!uploaded?.filepath) {
								promises.push(Promise.resolve({
									id: property,
									from: uploaded?.originalFilename || uploaded?.name || null,
									success: false,
									error: "No file uploaded"
								}));
								continue;
							}

							let r;
							try {
								r = self.prepareFilePathNameData(req, activePath, fields, files, property);
							} catch (prepErr) {
								self.logger.error("api.parseUploadedFile() prepare path ERROR", prepErr);
								promises.push(Promise.resolve({
									id: property,
									from: uploaded.originalFilename || uploaded.name,
									success: false,
									error: "Invalid upload"
								}));
								continue;
							}

							promises.push(
								fs.ensureDir(r.copyBaseDir + "/" + r.targetDir)
									.then(() => {
										return self.moveFile(r.fileFrom, r.fileToSave).then(() => { // (result)
											return {
												id: property,
												from: uploaded.originalFilename || uploaded.name,
												to: r.fileToUrl,
												path: r.resultFullPath,
												name: r.resultFileName,
												success: true,
												action: (activePath.postAction) ? activePath.postAction : null
											};
										});
									})
									.catch(moveErr => {
										self.logger.error("api.parseuploadeFile() files ensudeDir ERROR", moveErr);
										return { "id": property, "from": uploaded.originalFilename || uploaded.name, "success": false, "error": moveErr };
									}));
						}

						if (promises.length === 0) {
							finishParseError(new Error("empty upload"), 400, "No file uploaded");
							return;
						}

						return Promise.all(promises)
							.then((values) => {
								let fileErrors = false;
								values.forEach((v) => {
									if (v.success !== true) {
										fileErrors = true;
									}
									if (v.action) {
										req.$ctx.call(v.action, {
											data: {
												image: v.path,
												success: v.success,
												from: v.from
											},
											params: req.$params
										});
									}
								});
								if (res.headersSent || res.writableEnded) {
									return values;
								}
								let headers = typeof res.getHeaders === "function" ? res.getHeaders() : {};
								self.logger.info("api.parseUploadedFile Promise.all RES:", headers);
								if (headers["content-type"] === undefined) {
									res.writeHead(fileErrors ? 400 : 200, { "content-type": "application/json" });
								}
								res.end(JSON.stringify({
									success: !fileErrors,
									errors: fileErrors,
									files: values
								}));
								return values;
							})
							.catch(allErr => {
								finishParseError(allErr, 400, "Upload failed");
								return null;
							});
					} catch (parseCbErr) {
						finishParseError(parseCbErr, 400, "Upload failed");
					}
				});
			} catch (setupErr) {
				finishParseError(setupErr, 400, "Upload failed");
				return null;
			}
		},


		/**
		 * 
		 * @param {*} req 
		 * @param {*} res 
		 */
		processUpload(req, res) {
			try {
				req["$action"] = {
					auth: "required"
				};
				this.authenticate(req.$ctx, req.$route, req, res)
					.then(() => {
						let activePath;
						try {
							activePath = this.getActiveUploadPath(req);
						} catch (pathErr) {
							this.logger.error("api.processUpload() getActiveUploadPath ERROR", pathErr);
							this.respondUploadError(res, 400, "Upload failed");
							return;
						}

						this.logger.info("api.processUpload() activePath-vars", activePath, activePath?.validUserTypes, activePath?.validUserTypes?.indexOf("author") > -1, activePath?.checkAuthorAction, activePath?.checkAuthorActionParams);
						if (!activePath?.validUserTypes) {
							this.respondUploadError(res, 400, "Invalid upload path");
							return;
						}

						const userType = req.$ctx.meta.user?.type;
						if (activePath.validUserTypes.includes("author")
							&& activePath.checkAuthorAction && activePath.checkAuthorActionParams) {
							return req.$ctx.call(activePath.checkAuthorAction, {
								data: activePath.checkAuthorActionParams
							})
								.then(result => {
									this.logger.info("api.processUpload author:", result);
									if (result === true && userType &&
										activePath.validUserTypes.includes(userType)) {
										return this.parseUploadedFile(req, res, activePath);
									}
									this.respondUploadError(res, 403, "Upload not allowed");
								});
						}
						if (userType && activePath.validUserTypes.includes(userType)) {
							return this.parseUploadedFile(req, res, activePath);
						}
						this.respondUploadError(res, 403, "Upload not allowed");
					})
					.catch((err) => {
						this.logger.error("api.processUpload() ERROR", err);
						const status = err?.code === 401 ? 401 : 400;
						this.respondUploadError(res, status, "Upload failed");
					});
			} catch (err) {
				this.logger.error("api.processUpload() ERROR", err);
				this.respondUploadError(res, 400, "Upload failed");
			}
		},


		/**
		 * Anything you want to be called after route was called
		 * @param {*} actionData 
		 */
		afterCallAction(actionData) {
			if (actionData) {
				this.logger.info("api afterCallAction() actionData: ", actionData);
			}
		}

	}
};
