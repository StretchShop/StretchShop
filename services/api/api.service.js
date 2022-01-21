"use strict";

require("dotenv").config();
const _ = require("lodash");
const ApiGateway = require("moleculer-web");
const fs = require("fs-extra");
// const fs = require("fs");
const path = require("path");

// global mixins
const HelpersMixin = require("../../mixins/helpers.mixin");

// methods
const ApiMethodsCore = require("./methods/core.methods");
const ApiMethodsHelpers = require("./methods/helpers.methods");

// settings
const sppf = require("../../mixins/subproject.helper");
const resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../resources");
const localsDefault = require(resourcesDirectory+"/settings/locals-default");
// API routes
const apiV1 = require("../../resources/routes/apiV1");


module.exports = {
	name: "api",
	mixins: [
		ApiGateway, 
		HelpersMixin,
		// methods
		ApiMethodsCore,
		ApiMethodsHelpers
	],

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
				onBeforeCall(ctx, route, req) {
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
			folder: process.env.PATH_PUBLIC || sppf.subprojectPathFix(__dirname, "/../../public")
		},

		localsDefault: localsDefault,

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


	actions: {

		globalSearch: {
			cache: false,
			params: {
				query: { type: "string", min: 3 },
				langs: { type: "array", items: "string", optional: true }
			},
			handler(ctx) {
				console.log( "globalSearch: ", ctx.params, ctx.meta.localsDefault );
				let promises = [];

				let langs = [];
				ctx.meta.localsDefault.langs.forEach(l => {
					if (l.code) {
						langs.push(l.code);
					}
				});
				if (ctx.params.langs) {
					langs = ctx.params.langs;
				}

				const query = this.buildGlobalSearchQuery(ctx.params.query, langs);

				// return query;
				
				promises.push(
					ctx.call("products.find", {
						"query": query
					})
						.then((products) => {
							return { products };
						})
				);
				promises.push(
					ctx.call("pages.find", {
						"query": query
					})
						.then((pages) => {
							return { pages };
						})
				);
				promises.push(
					ctx.call("categories.find", {
						"query": query
					})
						.then((categories) => {
							return { categories };
						})
				);

				return Promise.all(promises)
					.then((values) => {
						console.log("api.service - global search - values:", values);
						return values;
					});
			}
		}

	},


	created() {
	}


};
