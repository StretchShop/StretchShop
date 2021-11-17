"use strict";

require("dotenv").config();
const _ = require("lodash");
const ApiGateway = require("moleculer-web");
const HelpersMixin = require("../mixins/helpers.mixin");
const Cookies = require("cookies");
const crypto = require("crypto");
const { UnAuthorizedError } = ApiGateway.Errors;
// const fs = require("fs");
const fs = require("fs-extra");
const path = require("path");
const formidable = require("formidable");
const util = require("util");

const sppf = require("../mixins/subproject.helper");
const resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../resources");
const localsDefault = require(resourcesDirectory+"/settings/locals-default");

const apiV1 = require("../resources/routes/apiV1");

module.exports = {
	name: "api",
	mixins: [ApiGateway, HelpersMixin],

	settings: {
		// HTTPS server with certificate
		https: (process.env.HTTPS_KEY && process.env.HTTPS_CERT) ? {
			key: fs.readFileSync(path.resolve(__dirname, process.env.HTTPS_KEY)),
			cert: fs.readFileSync(path.resolve(__dirname, process.env.HTTPS_CERT))
		} : null,

		// Global CORS settings for all routes
		cors: (process.env.NODE_ENV=="development" || process.env.NODE_ENV=="dockerdev") ? {
			// Configures the Access-Control-Allow-Origin CORS header.
			origin: (process.env.NODE_ENV=="dockerdev") ? "http://localhost:3000" : "http://localhost:8080",
			// origin: (process.env.NODE_ENV=="dockerdev") ? "http://localhost:3000" : "http://localhost:4200",
			// Configures the Access-Control-Allow-Methods CORS header.
			methods: ["GET", "OPTIONS", "POST", "PUT", "DELETE"],
			// Configures the Access-Control-Allow-Headers CORS header.
			allowedHeaders: [
				"Content-Type", 
				"Origin", 
				"X-Requested-With", 
				"Accept", 
				"Authorization", 
				"Timeout", 
				"Cookie", 
				"Set-Cookie", 
				"cookie", 
				"x-xsrf-token", 
				"Access-Control-Allow-Origin"
			],
			// Configures the Access-Control-Expose-Headers CORS header.
			exposedHeaders: ["Content-Type", "Content-Disposition"],
			// Configures the Access-Control-Allow-Credentials CORS header.
			credentials: true,
			// Configures the Access-Control-Max-Age CORS header.
			maxAge: 3600
		} : null,

		port: process.env.PORT || 3000,

		routes: [
			{
				path: "/api/v1/order/payment-raw",// If you need to disable body parsers
				bodyParsers: {
					json: false,
					urlencoded: false,
					raw: {
						type: "*/*"
					}
				},
				mappingPolicy: "restrict",
				mergeParams: false,
				aliases: {
					"POST /webhook/:supplier": "orders.paymentWebhookRaw",
				},
				onBeforeCall(ctx, route, req, res) {
					// Set request headers to context meta
					ctx.meta.rawbody = req.body.toString();
					ctx.meta.headers = req.headers;
				},
			},
			// get routes from external file - merged with subproject if applicable
			sppf.subprojectMergeRoutes(apiV1, path.resolve(resourcesDirectory+"/routes/apiV1") ),
			{
				path: "/backdirect",

				// Action aliases
				aliases: {
					"GET /order/paypal/:result": "orders.paypalResult"
				},

				onAfterCall(ctx, route, req, res, data) {
					// Async function which return with Promise
					if (data && data.redirect && data.redirect.trim()!="") {
						res.statusCode = 302;
						res.setHeader("Location", data.redirect);
						return null;
					}
					return data;
				},

				mappingPolicy: "restrict",

			},
			{
				path: "/",
				use: [
					// handle fallback for HTML5 history API
					require("connect-history-api-fallback")(),
				],
				// Action aliases
				aliases: {
				},
				mappingPolicy: "restrict",
			}
		],

		assets: {
			folder: process.env.PATH_PUBLIC || sppf.subprojectPathFix(__dirname, "/../public")
		},

		localsDefault: localsDefault,

		translation: {
			type: "jamlin",
			dictionaryPath: process.env.PATH_DICTIONARY || sppf.subprojectPathFix(__dirname, "/../public/project_dictionary.json")
		},

		siteSettings: {
			url: process.env.SITE_URL || "https://stretchshop.app",
			name: process.env.SITE_NAME || "StretchShop",
			supportEmail: process.env.SITE_SUPPORT_EMAIL || "support@stretchshop.app",
			imgLogo: process.env.SITE_IMG_LOGO || "/assets/_site/logo.svg",
			imgSiteEmailHeader: process.env.SITE_IMG_EMAIL_HEADER || "/assets/_site/site-email-header-image.png"
		},

		// logRequestParams: "info",
		// logResponseData: "info",

		onError(req, res, err) {
			// Return with the error as JSON object
			res.setHeader("Content-type", "application/json; charset=utf-8");
			res.writeHead(err.code || 500);

			this.logger.error("api onError:", err);

			if (err.code == 422) {
				let o = {};
				err.data.forEach(e => {
					let field = e.field.split(".").pop();
					o[field] = e.message;
				});

				res.end(JSON.stringify({ errors: o }, null, 2));
			} else {
				const errObj = _.pick(err, ["name", "message", "code", "type", "data"]);
				res.end(JSON.stringify(errObj, null, 2));
			}
			this.logResponse(req, res, err? err.ctx : null);
		}

	},


	methods: {
		parseCookies(cookiesString) {
			let list = {};

			cookiesString && cookiesString.split(";").forEach(function( cookie ) {
				let parts = cookie.split("=");
				list[parts.shift().trim()] = decodeURI(parts.join("="));
			});

			return list;
		},

		/**
		 * Manage user independent application cookies - eg. cart
		 */
		cookiesManagement(ctx, route, req, res) {
			if ( process.env.HTTPS_KEY && process.env.HTTPS_CERT ) {
				// req.connection.encrypted = true;
			}

			res.cookies = new Cookies(req, res, { keys: ["Lvj1MalbaTe6k"] });

			const cookies = this.parseCookies(req.headers.cookie);
			ctx.meta.cookies = cookies;
			if ( !cookies.cart ) {
				const name = "cart";
				const hash = crypto.createHash("sha256");
				const userCookieString = ctx.meta.remoteAddress + "--" + new Date().toISOString();
				hash.update(userCookieString);
				const value = hash.digest("hex");
				res.cookies.set(name, value, { 
					signed: true,
					secure: ((process.env.HTTPS_KEY && process.env.HTTPS_CERT) ? true : false),
					httpOnly: true
				});
				ctx.meta.cookies[name] = value;
			}
		},


		/**
		 * Authorize the request
		 *
		 * @param {Context} ctx
		 * @param {Object} route
		 * @param {IncomingRequest} req
		 * @returns {Promise}
		 */
		authorize(ctx, route, req, res) {
			process.env["test"] = "mrkva";
			this.logger.error("process.env.test: ", process.env.test);

			this.logger.info("api.authorize() visitor IP: ", req.connection.remoteAddress);
			ctx.meta.remoteAddress = req.connection.remoteAddress;
			ctx.meta.remotePort = req.connection.remotePort;
			// update localsDefault according to cookie value if possible
			ctx.meta.localsDefault = this.settings.localsDefault;
			ctx.meta.mailSettings = this.settings.mailSettings;
			ctx.meta.siteSettings = this.settings.siteSettings;
			ctx.meta.siteSettings.translation = this.settings.translation;
			ctx.meta.siteSettings.assets = this.settings.assets;
			ctx.meta.headers = req.headers;
			this.logger.info("api req.headers -------> ctx.meta.headers:", ctx.meta.headers);
			this.cookiesManagement(ctx, route, req, res);

			let token = "";
			ctx.meta.token = null;
			if (ctx.meta.cookies && ctx.meta.cookies.token) {
				ctx.meta.token = ctx.meta.cookies.token;
				token = ctx.meta.token;
			}

			// if (req.headers.authorization) {
			// 	let type = req.headers.authorization.split(" ")[0];
			// 	if (type === "Token" || type === "Bearer")
			// 		token = req.headers.authorization.split(" ")[1];
			// }

			// authorization core
			return this.Promise.resolve(token)
				.then(token => {
					if (token && token.toString().trim()!=="") {
						// Verify JWT token
						return ctx.call("users.resolveToken", { token: token })
							.then(user => {
								this.logger.info("api.authorize() user: ", user);
								if ( typeof user !== "undefined" && user && user.length>0 ) {
									user = user[0];
								}
								if (user) {
									this.logger.info("api.authorize() username: ", user.username);
									// Reduce user fields (it will be transferred to other nodes)
									ctx.meta.user = _.pick(user, ["_id", "externalId", "username", "email", "image", "type", "subtype", "addresses", "settings", "dates"]);
									ctx.meta.token = token;
									ctx.meta.userID = user._id;
								}
								return user;
							})
							.catch(() => {
								// Ignored because we continue processing if user is not exist
								return null;
							});
					}
				})
				.then(user => {
					if (req.$action && req.$action.auth == "required" && !user)
						return this.Promise.reject(new UnAuthorizedError());
				});
		},


		/**
		 * set of commands for move & copy of file actions, with copy callback for move action
		 * original patch from https://stackoverflow.com/questions/8579055/how-do-i-move-files-in-node-js/29105404#29105404
		 */
		renameFile(path, newPath) {
			return new Promise((res, rej) => {
				fs.rename(path, newPath, (err, data) =>
					err
						? rej(err)
						: res(data));
			});
		},
		// --
		copyFile(path, newPath, flags) {
			return new Promise((res, rej) => {
				const readStream = fs.createReadStream(path),
					writeStream = fs.createWriteStream(newPath, {flags});

				readStream.on("error", rej);
				writeStream.on("error", rej);
				writeStream.on("finish", res);
				readStream.pipe(writeStream);
			});
		},
		// --
		unlinkFile(path) {
			return new Promise((res, rej) => {
				fs.unlink(path, (err, data) =>
					err
						? rej(err)
						: res(data));
			});
		},
		// -- the main function to call
		moveFile(path, newPath, flags) {
			return this.renameFile(path, newPath)
				.catch(e => {
					if (e.code !== "EXDEV") {
						this.logger.error("api.moveFile() error: ", e);
						throw new e;
					} else {
						return this.copyFile(path, newPath, flags)
							.then(() => {
								return this.unlinkFile(path);
							});
					}
				});
		},

		getProductFileNameByType(params) {
			if ( params.type && params.type=="gallery" ) {
				return ["p:number"];
			} else {
				return [":orderCode", "default"];
			}
		},

		getActiveUploadPath(req) {
			let paths = [
				{
					url: "/user/image",
					destination: "users/profile",
					fileName: ["profile"],
					validUserTypes: ["user", "admin"],
					stringToChunk: (req.$ctx.meta.user && req.$ctx.meta.user._id) ? req.$ctx.meta.user._id.toString() : "",
					chunkSize: 6,
					postAction: "users.updateMyProfileImage"
				},
				{
					url: "/products/upload/:orderCode/:type",
					destination: "products",
					fileName: this.getProductFileNameByType(req.$params),
					validUserTypes: ["author", "admin"],
					checkAuthorAction: "products.checkAuthor",
					checkAuthorActionParams: {
						"orderCode": req.$params.orderCode,
						"publisher": req.$ctx.meta.user.email
					},
					stringToChunk: req.$params.orderCode ? req.$params.orderCode : "",
					chunkSize: 3,
					postAction: "products.updateProductImage",
				},
				{
					url: "/pages/upload/:slug",
					destination: "pages/editor",
					fileName: ["----ORIGINAL----"], // keep original name - only for WYSIWYG editor
					validUserTypes: ["author", "admin"],
					checkAuthorAction: "pages.checkAuthor",
					checkAuthorActionParams: {
						"slug": req.$params.slug,
						"publisher": req.$ctx.meta.user.email
					},
					stringToChunk: req.$params.slug ? req.$params.slug : "",
					chunkSize: 0, // do not chunk, use the whole string
					postAction: "pages.updatePageImage",
				},
				{
					url: "/pages/upload/:slug/:type",
					destination: "pages/cover",
					fileName: ["cover"],
					validUserTypes: ["author", "admin"],
					checkAuthorAction: "pages.checkAuthor",
					checkAuthorActionParams: {
						"slug": req.$params.slug,
						"publisher": req.$ctx.meta.user.email
					},
					stringToChunk: req.$params.slug ? req.$params.slug : "",
					chunkSize: 0,
					postAction: "pages.updatePageImage",
				},
				{
					url: "/categories/upload/:slug",
					destination: "categories",
					fileName: [":slug"],
					validUserTypes: ["user","admin"],
					checkAuthorAction: "categories.checkAuthor",
					checkAuthorActionParams: {
						"slug": req.$params.slug,
						"publisher": req.$ctx.meta.user.email
					},
					stringToChunk: req.$params.slug ? req.$params.slug : "",
					chunkSize: 0,
					postAction: "categories.updateCategoryImage",
				}
			];

			for ( let i=0; i<paths.length; i++ ) {
				let requestPathPattern = "/"+req.$alias.path;
				if ( paths[i].url == requestPathPattern ) {
					return paths[i];
				}
			}

			return null;
		},


		/**
		 * parse form with uploaded files, copy files according to paths
		 * supports ONLY JPG files for now
		 */
		parseUploadedFile(req, res, activePath) {
			let self = this;
			this.logger.info("api.parseUploadedFile() #1");
			let form = new formidable.IncomingForm();
			this.logger.info("api.parseUploadedFile() #2");
			return form.parse(req, function(err, fields, files) {
				let promises = [];
				self.logger.info("api.parseUploadedFile() #3", files, fields);
				if ( err ) {
					self.logger.error("api.parseUploadedFile() ERROR:", err);
				}

				// multiple files to upload - multiple promises as in import
				// after all done, create message and send
				for (let property in files) {
					if (Object.prototype.hasOwnProperty.call(files,property)) {
						self.logger.info("api.parseUploadedFile() files-"+property+": ", files[property]);
						let fileFrom = files[property].path;
						let copyBaseDir = req.$ctx.service.settings.assets.folder+"/"+process.env.ASSETS_PATH + self.stringReplaceParams(activePath.destination, req.$params);
						let urlBaseDir = process.env.ASSETS_PATH + self.stringReplaceParams(activePath.destination, req.$params);
						let targetDir = activePath.stringToChunk;
						if (activePath.chunkSize>0) {
							targetDir = self.stringChunk(activePath.stringToChunk, activePath.chunkSize);
						}
						// set new filename
						let re = /(?:\.([^.]+))?$/;
						let fileExt = re.exec(files[property].name);
						let fileNameReplaced = self.arrayReplaceParams( activePath.fileName, req.$params );
						fileNameReplaced = self.arrayReplaceParams( fileNameReplaced, fields );
						let resultFileName = files[property].name;
						if ( fileNameReplaced.join("-") !== "----ORIGINAL----" ) { // if not set to keep original name - only for WYSIWYG editor
							resultFileName = fileNameReplaced.join("-")+"."+fileExt[1];
						}
						let resultFullPath = targetDir+"/"+resultFileName;
						// set result paths
						let fileToSave = copyBaseDir+"/"+resultFullPath;
						let fileToUrl = urlBaseDir+"/"+resultFullPath;
						self.logger.info("api.parseuploadeFile() files-vars: ", fileFrom, fileToSave, fileToUrl, targetDir);
						promises.push(
							fs.ensureDir(copyBaseDir+"/"+targetDir)
								.then(() => {
									return self.moveFile(fileFrom, fileToSave).then(() => { // (result)
										return {
											id: property,
											from: files[property].name,
											to: fileToUrl,
											path: resultFullPath,
											name: resultFileName,
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

	},

	created() {
	}


};
