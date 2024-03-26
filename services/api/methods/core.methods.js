"use strict";

const Cookies = require("cookies");
const crypto = require("crypto");
const ApiGateway = require("moleculer-web");
const fs = require("fs-extra");
// const fs = require("fs");
const formidable = require("formidable");
const jwt = require("jsonwebtoken");
const util = require("util");
const _ = require("lodash");

const SettingsMixin = require("../../../mixins/settings.mixin");

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
			if ( process.env.COOKIES_SAME_SITE ) {
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
			let cookieKey = "Lvj1MalbaTe6k";
			if ( process.env.COOKIES_KEY ) {
				cookieKey = process.env.COOKIES_KEY;
			}
			const bsKeys = SettingsMixin.getSiteSettings("business", true);

			res.cookies = new Cookies(req, res, { keys: [cookieKey] });

			const cookies = this.parseCookies(req.headers.cookie);
			ctx.meta.cookies = cookies;
			let cookieSecure = ((process.env.COOKIES_SECURE==="true" || process.env.COOKIES_SECURE==true) ? true : false);
			// CART cookie
			if ( !cookies.cart ) {
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

			// CSRF cookie
			if ( !cookies.session ) {
				const csrfDate = new Date();
				const name = "session";
				const hash = crypto.createHash("sha256");
				const sessionCookieString = ctx.meta.remoteAddress + "--" + csrfDate.getTime() + "--" + bsKeys.invoiceData?.company?.name + "--" + crypto.randomBytes(20).toString('hex');
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
		 * @param {Object} route
		 * @param {IncomingRequest} req
		 * @returns {Boolean}
		 */
		checkCsrfToken(ctx, req) {
			if (ctx.meta.headers?.authorization) {
				const cookies = this.parseCookies(req.headers.cookie);
				const token = ctx.meta.headers.authorization.split("Token ");
				// check if token was set in header and verify its integrity
				if (token[1] && cookies.session) {
					const cookieData = jwt.decode(cookies.session);
					const verifyKey = ctx.meta.remoteAddress + "--" + cookieData?.issued;
					try {
						const decoded = jwt.verify(token[1].trim(), verifyKey);
						if (decoded) {
							// compare if token from cookie is same as token from header
							if (decoded.token === cookieData?.token) {
								this.logger.info("Token valid");
								return true;
							} else {
								this.logger.error("Token INVALID");
								return false;
							}
						}
					} catch (e) {
						this.logger.error("Token INVALID: ", e);
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
				if ( req?.$action?.authType === "csrfCheck" ) {
					if ( !this.checkCsrfToken(ctx, req) ) {
						return this.Promise.reject(new E.UnAuthorizedError(E.ERR_INVALID_TOKEN));
					} else {
						// stops further processing, returning null user
						return this.Promise.resolve(null); // needed for login
					}
				}
				// if auth is required, get also csrf token result
				csrfResult = this.checkCsrfToken(ctx, req);
				this.logger.info("before csfrResult csrfResult #2: ", csrfResult);
			} catch (e) {
				this.logger.error("Csrf Token error: ", e);
			}
			this.logger.info("before csfrResult csrfResult #3 route: ");
			this.cookiesManagement(ctx, route, req, res);

			// get user token from cookie
			let token = "";
			ctx.meta.token = null;
			if (ctx.meta?.cookies?.token) {
				ctx.meta.token = ctx.meta.cookies.token;
				token = ctx.meta.token;
			}
			this.logger.info("before csfrResult check: ", token);
			// no user action without csrf token
			// if (!csrfResult && req.$action?.authType !== "csrfOnly") {
			// 	return this.Promise.reject(new E.UnAuthorizedError(E.ERR_INVALID_TOKEN));
			// }
			this.logger.info("before csfrResult after: ");

			// authorization core
			return this.Promise.resolve(token)
				.then(token => {
					this.logger.info("token #1: ", token);
					if (token && token.toString().trim()!=="") {
						// Verify JWT token
						this.logger.info("token #2: ", token);
						return ctx.call("users.resolveToken", { token: token })
							.then(user => {
								this.logger.info("token #3: ", user);
								if ( typeof user !== "undefined" && user && user.length>0 ) {
									user = user[0];
								}
								this.logger.info("token #4: ", user);
								if (user) {
									this.logger.info("api.authenticate() username: ", user.username);
									// Reduce user fields (it will be transferred to other nodes)
									user = _.pick(user, ["_id", "externalId", "username", "email", "image", "type", "subtype", "addresses", "settings", "data", "dates"]);
									ctx.meta.token = token;
									ctx.meta.userID = user._id;
									this.logger.info("api.authenticate() ctx.meta.user: ", ctx.meta.user);
									return user;
								}
							})
							.catch(() => {
								throw new ApiGateway.Errors.UnAuthorizedError("NO_RIGHTS");
							});
					}
				})
				.then(user => {
					if (req.$action && req.$action.auth == "required" && !user) {
						throw new ApiGateway.Errors.UnAuthorizedError("NO_RIGHTS");
					}
					return user;
				})
				.catch(err => {
					console.error("api.authenticate() ERROR: ", err);
					throw new ApiGateway.Errors.UnAuthorizedError("NO_RIGHTS");
				});
		},


		/**
		 * parse form with uploaded files, copy files according to paths
		 * supports ONLY JPG files for now
		 */
		parseUploadedFile(req, res, activePath) {
			const self = this;
			this.logger.info("api.parseUploadedFile() #1", typeof formidable);
			const form = formidable.formidable({ multiples: true });;
			this.logger.info("api.parseUploadedFile() #2", form);
			return form.parse(req, (err, fields, files) => {
				self.logger.info("api.parseUploadedFile() #2.5", err, fields, files);
				let promises = [];
				self.logger.info("api.parseUploadedFile() #3", files, fields);
				if ( err ) {
					self.logger.error("api.parseUploadedFile() ERROR:", err);
				}

				// multiple files to upload - multiple promises as in import
				// after all done, create message and send
				for (let property in files) {
					if (Object.prototype.hasOwnProperty.call(files,property)) {

						const r = self.prepareFilePathNameData(req, activePath, fields, files, property);
						
						promises.push(
							fs.ensureDir(r.copyBaseDir+"/"+r.targetDir)
								.then(() => {
									return self.moveFile(r.fileFrom, r.fileToSave).then(() => { // (result)
										return {
											id: property,
											from: files[property].name,
											to: r.fileToUrl,
											path: r.resultFullPath,
											name: r.resultFileName,
											success: true,
											action: (activePath.postAction) ? activePath.postAction : null
										};
									});
								})
								.catch(err => {
									self.logger.error("api.parseuploadeFile() files ensudeDir ERROR", err);
									return { "id": property, "from": files[property].name, "success": false, "error": err };
								})); // push with ensureDir end
					}
				}

				// after form processed and wait for all promises to finish
				// return multiple promises results
				return Promise.all(promises)
					.then((values) => {
						let fileErrors = false;
						values.forEach((v) => {
							if ( v.success !== true ) {
								fileErrors = true;
							}
							// if available, run post action
							if ( v.action ) {
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
						let headers = res.getHeaders();
						self.logger.info("api.parseUploadedFile Promise.all RES:", headers);
						if ( typeof headers["content-type"] !== "undefined" ) {
							res.writeHead(200, {"content-type": "application/json"});
						}
						res.end(util.inspect(JSON.stringify({
							success: true,
							errors: fileErrors,
							files: values
						})));
						return values;
					})
					.catch(err => {
						self.logger.error("api.parseUploadedFile Promise.all ERROR: ", err);
						return null;
					});
			});
		},


		/**
		 * 
		 * @param {*} req 
		 * @param {*} res 
		 */
		processUpload(req, res) {
			req["$action"] = {
				auth: "required"	
			};
			this.authenticate(req.$ctx, req.$route, req, res)
				.then((x) => {
					// get active path with variables
					let self = this;
					let activePath = this.getActiveUploadPath(req);

					this.logger.info("api.processUpload() activePath-vars", activePath, activePath.validUserTypes, activePath.validUserTypes.indexOf("author")>-1, activePath.checkAuthorAction, activePath.checkAuthorActionParams);
					// check if upload path is valid and has set validUserTypes
					if ( activePath && activePath.validUserTypes ) {
						// check if author is in array of activePath.validUserTypes and file was uploaded by author
						if ( activePath.validUserTypes.indexOf("author")>-1
						&& activePath.checkAuthorAction && activePath.checkAuthorActionParams ) {
							// check if uploaded by author
							req.$ctx.call(activePath.checkAuthorAction, {
								data: activePath.checkAuthorActionParams
							})
								.then(result => {
									this.logger.info("api.processUpload author:", result);
									if (result==true) {
										// user is author
										self.parseUploadedFile(req, res, activePath);
									} else {
										/**
										 * for other users
										 * can process form, move file and launch related action, because:
										 * 1. path is valid
										 * 2. user is authentificated
										 * 3. user can upload to that path
										 */
										if ( req.$ctx.meta.user.type &&
										activePath.validUserTypes.indexOf(req.$ctx.meta.user.type)>-1 ) {
											self.parseUploadedFile(req, res, activePath);
										}
									}
								});
						} else if ( activePath && activePath.validUserTypes && // check if user or admin
							activePath.validUserTypes.indexOf(req.$ctx.meta.user.type)>-1 ) {
							self.parseUploadedFile(req, res, activePath);
						}
					}
				});
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
