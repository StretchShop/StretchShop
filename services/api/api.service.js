"use strict";

require("dotenv").config();
const _ = require("lodash");
const ApiGateway = require("moleculer-web");
const fs = require("fs-extra");
// const fs = require("fs");
const path = require("path");

// global mixins
const HelpersMixin = require("../../mixins/helpers.mixin");
const SettingsMixin = require("../../mixins/settings.mixin");
const { getRequiredSecret } = require("../../mixins/env.helpers");

// methods
const ApiMethodsCore = require("./methods/core.methods");
const ApiMethodsHelpers = require("./methods/helpers.methods");
const ApiMethodsSettings = require("./methods/settings.methods");
const openApiActionMetadata = require("../../mixins/openapi.action-metadata.mixin");
const { isOpenApiEnabled } = require("../../mixins/openapi.enabled");

// settings
const sppf = require("../../mixins/subproject.helper");
const resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../resources");
// API routes
const apiV1 = require("../../resources/routes/apiV1");
const baseOpenApiComponents = require("../../docs/openapi/swaggerhub-components.json");

const openapiEnabled = isOpenApiEnabled();

let pathModif = null;
// optional imports
try {
	pathModif = require(resourcesDirectory + "/routes/path.modificator");
} catch (err) {
	console.warn("api pathModif import error: ", err);
}


module.exports = {
	name: "api",
	mixins: [
		ApiGateway, 
		HelpersMixin,
		SettingsMixin,
		// methods
		ApiMethodsCore,
		ApiMethodsHelpers,
		ApiMethodsSettings,
		openApiActionMetadata("api"),
	],

	settings: {
		openapi: openapiEnabled ? {
			info: {
				title: baseOpenApiComponents.info?.title || "StretchShop main API",
				description: baseOpenApiComponents.info?.description,
				version: require("../../package.json").version,
				contact: baseOpenApiComponents.info?.contact,
				license: baseOpenApiComponents.info?.license,
			},
			tags: baseOpenApiComponents.tags,
			components: baseOpenApiComponents.components,
			server: { url: "/api/v1", description: "Main REST API" },
		} : false,

		// HTTPS server with certificate
		https: (process.env.HTTPS_KEY && process.env.HTTPS_CERT) ? {
			key: fs.readFileSync(path.resolve(__dirname, process.env.HTTPS_KEY)),
			cert: fs.readFileSync(path.resolve(__dirname, process.env.HTTPS_CERT))
		} : null,
		
		JWT_SECRET: getRequiredSecret("JWT_SECRET", "jwt-stretchshop-secret"),

		// Global CORS settings for all routes
		cors: (process.env.NODE_ENV=="development" || process.env.NODE_ENV=="dockerdev" || process.env.CORS_ORIGIN?.trim() !== "") ? {
			// Configures the Access-Control-Allow-Origin CORS header.
			origin: () => {
				if (process.env.CORS_ORIGIN?.trim() !== "") {
					return process.env.CORS_ORIGIN;
				} else if (process.env.NODE_ENV == "dockerdev") {
					return "http://localhost:3000";
				}
				return "http://localhost:8080";
			},
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
				"Access-Control-Allow-Origin",
				"Resource-Type",
			],
			// Configures the Access-Control-Expose-Headers CORS header.
			exposedHeaders: ["Content-Type", "Content-Disposition"],
			// Configures the Access-Control-Allow-Credentials CORS header.
			credentials: true,
			// Configures the Access-Control-Max-Age CORS header.
			maxAge: 3600
		} : null,

		ip: process.env.IP || "localhost",

		port: process.env.PORT || 3000,

		routes: [
			...(openapiEnabled ? [{
				path: "/openapi",
				authentication: false,
				authorization: false,
				mappingPolicy: "restrict",
				aliases: {
					"GET /openapi.json": "openapi.generateDocs",
					"GET /ui": "openapi.ui",
					"GET /assets/:file": "openapi.assets",
					"GET /oauth2-redirect": "openapi.oauth2Redirect",
				},
			}] : []),
			{
				path: "/health",
				aliases: {
					"GET /": "metrics.health",
				},
				authentication: false,
				authorization: false,
				mappingPolicy: "restrict",
			},
			/**
			 * Webhook endpoint for payment providers, that NEED raw body (eg. stripe)
			 * It disables body parsing and reads raw body from request
			 * Has to be called with supplier name as parameter
			 * Webhook URL example https://mydemo.tld/apis/v1/order/payment/webhook-raw/stripe
			 * NOTICE: "APIS" part of URL is of API SPECIAL, not a typo. All common API routes are under /api/v1
			 */
			{
				path: "/apis/v1/order/payment/webhook-raw",
				openapi: openapiEnabled ? {
					tags: ["developer"],
				} : false,
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
					"POST /:supplier": "orders.paymentWebhookRaw",
				},
				onBeforeCall(ctx, route, req) {
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
					require("connect-history-api-fallback")({ 
						index: "index.html",
						rewrites: [
							{ 
								from: /^[^.]*$/, // only requests without dot (.) in url
								to: function(context) {
									const pathname = context.parsedUrl.pathname || "";
									if (pathname.startsWith("/openapi")) {
										return pathname;
									}
									let path = "";
									// if available, update path as required by business
									if (pathModif && typeof pathModif.updatePath === "function") {
										path = pathModif.updatePath(path, context.request);
									}
									return path + "/index.html";
								}
							}
						]
					}),
				],
				// Action aliases
				aliases: {
					"/": function (req, res) {
						let publicPath = process.env.PATH_PUBLIC || sppf.subprojectPathFix(__dirname, "/../../public");

						// if available, update path as required by business
						let publicPathReady = publicPath;
						if (pathModif && typeof pathModif.updatePath === "function") {
							publicPathReady = pathModif.updatePath(publicPath, req);
						}

						let indexPath = publicPathReady + "/index.html";
						if ( !fs.existsSync(indexPath) ) {
							indexPath = publicPath + "/index.html";
						}
						// read index file
						fs.readFile(indexPath)
							.then( index => {
								res.end(index);
							})
							.catch( (error) => {
								console.error("Router / error: ", error);
								res.set("Content-Type", "text/plain")
									.status(404)
									.send({ message: "Page index.html not found" });
							});
					},
				},
				mappingPolicy: "restrict",
			}
		],

		assets: {
			folder: process.env.PATH_PUBLIC || sppf.subprojectPathFix(__dirname, "/../../public")
		},

		localsDefault: SettingsMixin.getSiteSettings("locals"),

		translation: {
			type: "jamlin",
			dictionaryPath: process.env.PATH_DICTIONARY || sppf.subprojectPathFix(__dirname, "/../../public/project_dictionary.json")
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
			const statusCode = (typeof err.code === "number" && err.code >= 400 && err.code < 600)
				? err.code
				: 500;
			res.writeHead(statusCode);

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


	actions: {

		globalSearch: {
			cache: false,
			params: {
				query: { type: "string", min: 3 },
				langs: { type: "array", items: "string", optional: true }
			},
			handler(ctx) {
				let promises = [];
				let langs = [];
				ctx.meta.localsDefault?.langs?.forEach(l => {
					if (l.code) {
						langs.push(l.code);
					}
				});
				if (ctx.params.langs) {
					langs = ctx.params.langs;
				}

				const filter = this.buildGlobalSearchQuery(ctx.params.query, langs);
				this.logger.info("api.service - global search - filter:", filter);
				
				promises.push(
					ctx.call("products.find", filter)
						.then((products) => {
							return { products };
						})
				);
				promises.push(
					ctx.call("pages.find", filter)
						.then((pages) => {
							return { pages };
						})
				);
				promises.push(
					ctx.call("categories.find", filter)
						.then((categories) => {
							return { categories };
						})
				);

				return Promise.all(promises)
					.then((values) => {
						let results = {};
						if (values) {
							values.forEach(v => {
								if (v && v !== null && typeof v === "object") {
									Object.keys(v).forEach(k => {
										results[k] = v[k];
									});
								}
							});
						}
						return results;
					})
					.catch(err => {
						console.error("api.globalSearch error: ", err);
						return this.Promise.reject(new MoleculerClientError("Global search error", 422, "", []));
					});
			}
		},


		settings: {
			cache: false,
			auth: "required",
			params: {
				type: { type: "string", min: 3 }
			},
			handler(ctx) {
				// if user is admin and settings are editable
				const business = SettingsMixin.getSiteSettings("business", true);
				this.logger.info("settings: ", business,  ctx.meta.user.type=="admin", 
					business.editableSettings !== "undefined", 
					business.editableSettings.core === true, ctx);
				if ( ctx.meta.user.type=="admin" && 
				business.editableSettings !== "undefined" && 
				business.editableSettings.core === true ) {
					return SettingsMixin.getSiteSettings(ctx.params.type);
				}
			}
		},


		settingsUpdate: {
			cache: false,
			auth: "required",
			params: {
				type: { type: "string", min: 3 },
				data: { type: "object", optional: true }
			},
			handler(ctx) {
				// if user is admin and settings are editable
				const business = SettingsMixin.getSiteSettings("business", true);
				this.logger.info("settings: ", business,  ctx.meta.user.type=="admin", 
					business.editableSettings !== "undefined", 
					business.editableSettings === true, ctx);
				if ( ctx.meta.user.type=="admin" && 
				business.editableSettings !== "undefined" && 
				business.editableSettings === true ) {
					// if data is set, update and return
					if (typeof ctx.params.data !== "undefined" && ctx.params.data.constructor === Object) {
						return SettingsMixin.setSiteSettings(ctx.params.type, ctx.params.data);
					} else { // if data not set, just return setting
						return SettingsMixin.getSiteSettings(ctx.params.type);
					}
				}
			}
		}

	},


	created() {
	}


};
