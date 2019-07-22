"use strict";

require('dotenv').config();
const _ = require("lodash");
const ApiGateway = require("moleculer-web");
const Cookies = require('cookies');
const crypto = require('crypto');
const { UnAuthorizedError } = ApiGateway.Errors;
// const fs = require('fs');
const fs = require('fs-extra');
var formidable = require('formidable'),
		util = require('util');

module.exports = {
	name: "api",
	mixins: [ApiGateway],

	settings: {
		// Global CORS settings for all routes
    cors: (process.env.NODE_ENV=="development" || process.env.NODE_ENV=="dockerdev") ? {
        // Configures the Access-Control-Allow-Origin CORS header.
        origin: (process.env.NODE_ENV=="dockerdev") ? "http://localhost:3000" : "http://localhost:8080",
				// origin: (process.env.NODE_ENV=="dockerdev") ? "http://localhost:3000" : "http://localhost:4200",
        // Configures the Access-Control-Allow-Methods CORS header.
        methods: ["GET", "OPTIONS", "POST", "PUT", "DELETE"],
        // Configures the Access-Control-Allow-Headers CORS header.
        allowedHeaders: ['Content-Type', 'Origin', 'X-Requested-With', 'Accept', 'Authorization', 'Timeout', 'Cookie', 'Set-Cookie', 'cookie'],
        // Configures the Access-Control-Expose-Headers CORS header.
        exposedHeaders: [],
        // Configures the Access-Control-Allow-Credentials CORS header.
        credentials: true,
        // Configures the Access-Control-Max-Age CORS header.
        maxAge: 3600
    } : null,

		port: process.env.PORT || 3000,

		routes: [{
			path: "/api",

			authorization: true,

			aliases: {
				// core data
				"GET /coredata": "users.getCoreData",
				"GET /coredata/translation": "users.readTranslation",

				// Users
				"POST /users/login": "users.login", // Login
				"GET /users/logout": "users.logout", // Logout
				//"REST /users": "users", // list Users
				"POST /users/checkemail": "users.checkIfEmailExists",
				"POST /users/checkusername": "users.checkIfUserExists",
				"POST /users/register": "users.create",

				// Current user
				"GET /user": "users.me",
				"GET /user/verify/:email/:hash": "users.verifyHash",
				"GET /user/reset/:email": "users.resetPassword",
				"PUT /user": "users.updateUser",
				"POST /user/image": function (req, res) {
            this.parseUploadedFile(req, res);
        },

				// Articles
				"GET /articles/feed": "articles.feed",
				"REST /articles": "articles",
				"GET /tags": "articles.tags",

				// Comments
				"GET /articles/:slug/comments": "articles.comments",
				"POST /articles/:slug/comments": "articles.addComment",
				"PUT /articles/:slug/comments/:commentID": "articles.updateComment",
				"DELETE /articles/:slug/comments/:commentID": "articles.removeComment",

				// Favorites
				"POST /articles/:slug/favorite": "articles.favorite",
				"DELETE /articles/:slug/favorite": "articles.unfavorite",

				// Profile
				"GET /profiles/:username": "users.profile",
				"POST /profiles/:username/follow": "users.follow",
				"DELETE /profiles/:username/follow": "users.unfollow",

				// Cart
				"GET /cart": "cart.me",
				"POST /cart": "cart.updateCartItemAmount",
				"POST /cart/find": "cart.find",
				"PUT /cart": "cart.add",
				"DELETE /cart": "cart.delete",
				"DELETE /cart/:itemId": "cart.delete",
				"DELETE /cart/:itemId/:amount": "cart.delete",

				// Products
				"GET /products/:category": "products.productsList",
				"POST /products/find": "products.findWithCount",
				"POST /products/:category": "products.productsList", // needed for category with filter url
				"GET /products/:category/detail/:product": "products.detail",
				"PUT /products": "products.import",
				"POST /products/count": "products.count",
				"DELETE /products": "products.delete",

				// Categories
				"PUT /categories": "categories.import",
				"POST /categories/find": "categories.find",
				"DELETE /categories": "categories.delete",

				// Order
				"GET /order/progress": "orders.progress",
				"POST /order/progress": "orders.progress",
				"POST /order/list": "orders.listOrders",
				"GET /order/detail/:id": "orders.detail",
				"REST /webhook/:service": "orders.paymentWebhook",
				// Payment Braintree
				"GET /users/btut": "orders.braintreeClientToken",
				"POST /order/btcheckout": "orders.braintreeOrderPaymentCheckout",

				// Pages
				"POST /pages/:slug": "pages.show",
			},

			// Disable to call not-mapped actions
			mappingPolicy: "restrict",

			// Set CORS headers
			//cors: true,

			// Parse body content
			bodyParsers: {
				json: {
					strict: false,
					limit: 1024*1024*10
				},
				urlencoded: {
					extended: false
				}
			}
		},{
			path: "/",

			use: [
        // handle fallback for HTML5 history API
        require("connect-history-api-fallback")(),
	    ],

		  // Action aliases
		  aliases: {
		  },

		  mappingPolicy: "restrict",

		}],

		assets: {
			folder: "./public"
		},

		localsDefault: {
			lang: "en",
			langs: [
				{ code: "sk", longCode: "sk-SK", name: "Slovenčina" },
				{ code: "en", longCode: "en-US", name: "English" }
			],
			country: "sk",
			countries: [
				{ code: "sk", name: "Slovakia" },
				{ code: "us", name: "USA" }
			],
			currency: "EUR",
			currencies: [
				{ code: "EUR", symbol: "€", ratio: 1 },
				{ code: "USD", symbol: "$", ratio: 1.1 }
			]
		},

		translation: {
			type: "jamlin",
			dictionaryPath: "./public/project_dictionary.json"
		},

		siteSettings: {
			url: "https://stretchshop.cw.sk"
		},

		// logRequestParams: "info",
		// logResponseData: "info",

		onError(req, res, err) {
			// Return with the error as JSON object
			res.setHeader("Content-type", "application/json; charset=utf-8");
			res.writeHead(err.code || 500);

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
			var list = {};

	    cookiesString && cookiesString.split(';').forEach(function( cookie ) {
	        var parts = cookie.split('=');
	        list[parts.shift().trim()] = decodeURI(parts.join('='));
	    });

	    return list;
		},

		/**
		 * Manage user independent application cookies - eg. cart
		 */
		cookiesManagement(ctx, route, req, res) {
			var cookiesTool = new Cookies(req, res, { keys: ['Lvj1MalbaTe6k'] })

			const cookies = this.parseCookies(req.headers.cookie);
			ctx.meta.cookies = cookies;
			if ( !cookies.cart ) {
				const name = "cart";
				const hash = crypto.createHash('sha256');
				const userCookieString = ctx.meta.remoteAddress + "--" + new Date().toISOString();
				hash.update(userCookieString);
				const value = hash.digest('hex');
				cookiesTool.set(name, value, { signed: true })
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
			console.log("\nuip: " + req.connection.remoteAddress);
			ctx.meta.remoteAddress = req.connection.remoteAddress;
			ctx.meta.remotePort = req.connection.remotePort;
			// update localsDefault according to cookie value if possible
			ctx.meta.localsDefault = this.settings.localsDefault;
			ctx.meta.mailSettings = this.settings.mailSettings;
			ctx.meta.siteSettings = this.settings.siteSettings;
			ctx.meta.siteSettings.translation = this.settings.translation;
			this.cookiesManagement(ctx, route, req, res);

			let token = '';
			if (req.headers.authorization) {
				let type = req.headers.authorization.split(" ")[0];
				if (type === "Token" || type === "Bearer")
					token = req.headers.authorization.split(" ")[1];
			}

			return this.Promise.resolve(token)
				.then(token => {
					if (token && token.toString().trim()!=='') {
						// Verify JWT token
						return ctx.call("users.resolveToken", { token: token })
							.then(user => {
								console.log("\napi.tokenresolved.user: ", user);
								if ( typeof user !== 'undefined' && user && user.length>0 ) {
									user = user[0];
								}
								if (user) {
									this.logger.info("\nAuthenticated via JWT: ", user.username);
									// Reduce user fields (it will be transferred to other nodes)
									ctx.meta.user = _.pick(user, ["_id", "externalId", "username", "email", "image", "type"]);
									ctx.meta.token = token;
									ctx.meta.userID = user._id;
								}
								return user;
							})
							.catch(err => {
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
						console.log(e);
		        throw new e;
					} else {
		        return this.copyFile(path, newPath, flags)
		          .then(() => {
								return this.unlinkFile(path)
							});
					}
		    });
		},

		/**
		 * simple function to split string into
		 */
		stringChunk(str, chunkSize) {
 			chunkSize = (typeof chunkSize === 'undefined') ? 2 : chunkSize;
 			let resultString = '';

 			if ( str.length>0 ) {
 				let resultArray = [];
 				let chunk = '';
 		 		for ( let i = 0; i<str.length; i=(i+chunkSize) ) {
 		 			chunk = str.substring(i,i+chunkSize);
 		 			if ( chunk.trim()!='' ) {
 		 				resultArray.push(chunk);
 		 			}
 		 		}
 		 		if (resultArray.length) {
 		 			resultString = resultArray.join('/');
 		 		}
 		  } else {
 		  	resultString = str;
 		  }

 			return resultString;
 		},


		/**
		 * parse form with uploaded files, copy files according to paths
		 */
		parseUploadedFile(req, res) {
			// parse a file upload
			let self = this;
	    let form = new formidable.IncomingForm();
			let paths = [
				{
					url: "/user/image",
					destination: "users/profile",
					fileName: "profile",
					validUserTypes: ['user', 'admin'],
					stringToChunk: req.$ctx.meta.user._id,
					chunkSize: 6
				},
				{ url: "/products/:id/image", destination: "products/:id" },
				{ url: "/categories/:id/image", destination: "categories/:id" }
			];

			console.log("\nctx.meta.user: -- ", req.$ctx.meta.user);
			let activePath = null;

			for ( let i=0; i<paths.length; i++ ) {
				if ( paths[i].url===req.url ) {
					activePath = paths[i];
					break;
				}
			}

			/*
			 * can process form, move file and launch related action, because:
			 * 1. path is valid
			 * 2. user is authentificated
			 * 3. user can upload to that path
			 */
			if ( activePath && activePath.validUserTypes && req.$ctx.meta.user.type &&
				activePath.validUserTypes.indexOf(req.$ctx.meta.user.type)>-1 ) {
				form.parse(req, function(err, fields, files) {
					let promises = [];

					// TODO - add multiple promises as in import - after all done, create message and send
					for (var property in files) {
				    if (files.hasOwnProperty(property)) {
			        console.log("\n"+property+" ---- :", files[property].path, files[property].name);
							let fileFrom = files[property].path;
							let copyBaseDir = req.$ctx.service.settings.assets.folder+"/"+process.env.ASSETS_PATH+activePath.destination;
							let urlBaseDir = process.env.ASSETS_PATH+activePath.destination;
							let targetDir = self.stringChunk(activePath.stringToChunk, activePath.chunkSize);
							// set new filename
							let re = /(?:\.([^.]+))?$/;
							let fileExt = re.exec(files[property].name);
							let resultFileName = activePath.fileName+"."+fileExt[1];
							// set result paths
							let fileToSave = copyBaseDir+"/"+targetDir+"/"+resultFileName;
							let fileToUrl = urlBaseDir+"/"+targetDir+"/"+resultFileName;
							console.log(fileFrom, fileToSave, fileToUrl, targetDir);
							promises.push(
								fs.ensureDir(copyBaseDir+"/"+targetDir)
								.then(() => {
									return self.moveFile(fileFrom, fileToSave).then(result => {
										return { id: property, from: files[property].name, to: fileToUrl, success: true };
									});
								})
								.catch(err => {
									console.log("\nensureDir err: ", err);
								  console.error(err);
									return { id: property, from: files[property].name, success: false, error: err };
								})); // push with ensureDir end
				    }
					}

					// after form processed and wait for all promises to finish
					// return multiple promises results
					return Promise.all(promises).then((values) => {
							let fileErrors = false;
							values.forEach((v) => {
								if ( v.success!==true ) {
									fileErrors = true;
								}
							});
							res.writeHead(200, {'content-type': 'application/json'});
							res.end(util.inspect({success: true, errors: fileErrors, files: values}));
					    return promises;
					});
				});
			}
			console.log("\napi.parseUploadedFile.problem", req.url);

	    return;
		},

		/**
		 * Convert ValidationError to RealWorld.io result
		 * @param {*} req
		 * @param {*} res
		 * @param {*} err
		 */
		/*sendError(req, res, err) {
			if (err.code == 422) {
				res.setHeader("Content-type", "application/json; charset=utf-8");
				res.writeHead(422);
				let o = {};
				err.data.forEach(e => {
					let field = e.field.split(".").pop();
					o[field] = e.message;
				});
				return res.end(JSON.stringify({
					errors: o
				}, null, 2));

			}

			return this._sendError(req, res, err);
		}*/
	},

	created() {
	}


};
