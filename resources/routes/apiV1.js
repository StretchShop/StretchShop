"use strict";

let cookie = require("cookie");

module.exports = {
	path: "/api/v1",

	authorization: true,

	aliases: {
		// core data
		"GET /coredata": "users.getCoreData",
		"GET /coredata/translation": "users.readTranslation",
		"PUT /coredata/translation": "users.updateDictionary",

		// Users
		"POST /users/login": "users.login", // Login
		"GET /users/logout": "users.logout", // Logout
		//"REST /users": "users", // list Users
		"POST /users/checkemail": "users.checkIfEmailExists",
		"POST /users/checkusername": "users.checkIfUserExists",
		"POST /users/register": "users.create",

		// Current user
		"GET /user": "users.me",
		"PUT /user": "users.updateUser",
		"POST /user/verify": "users.verifyHash",
		"POST /user/reset": "users.resetPassword",
		"POST /user/image": function (req, res) {
			this.processUpload(req, res);
		},
		"DELETE /user/image/:type/:code/:image": "users.deleteUserImage",
		"DELETE /user/profile": "users.deleteProfile",
		"POST /user/cancelDelete": "users.cancelDelete",

		// Cart
		"GET /cart": "cart.me",
		"POST /cart": "cart.updateCartItemAmount",
		"PUT /cart": "cart.add",
		"DELETE /cart": "cart.delete",
		"POST /cart/find": "cart.find",
		"DELETE /cart/:itemId": "cart.delete",
		"DELETE /cart/:itemId/:amount": "cart.delete",

		// Products
		"GET /products/:category": "products.productsListGet",
		"POST /products/:category": "products.productsList", // needed for category with filter url
		"POST /products/filter": "products.findWithCount",
		"POST /products/find": "products.find",
		"GET /products/:category/detail/:product": "products.detail",
		"PUT /products": "products.import",
		"DELETE /products": "products.delete",
		"POST /products/count": "products.count",
		"GET /products/rebuildpl/:id": "products.rebuildProductPriceLevels",
		"POST /products/upload/:orderCode/:type": function (req, res) {
			this.processUpload(req, res);
		},

		// Categories
		"GET /category/:categoryPath": "categories.detail",
		"PUT /categories": "categories.import",
		"DELETE /categories": "categories.delete",
		"POST /categories/find": "categories.findWithContent",
		"POST /categories/upload/:slug/:type": function (req, res) {
			this.processUpload(req, res);
		},
		"POST /categories/upload/:slug": function (req, res) {
			this.processUpload(req, res);
		},

		// Order
		"GET /order/progress": "orders.progress",
		"POST /order/progress": "orders.progress",
		"POST /order/list": "orders.listOrders",
		"GET /order/invoice/download/:invoice": "orders.invoiceDownload",
		"GET /order/invoice/pay/:orderId": "orders.paid",
		"GET /order/invoice/cancel/:orderId": "orders.cancel",
		"GET /order/invoice/expeded/:orderId": "orders.expede",
		// Subscriptions
		"POST /subscription/list": "subscriptions.listSubscriptions",
		"GET /subscription/suspend/:subscriptionId": "subscriptions.suspend",
		"GET /subscription/reactivate/:subscriptionId": "subscriptions.reactivate",
		// Payment
		"POST /order/payment/:supplier/:action": "orders.payment", // eg. /order/payment/paypal/geturl
		"GET /order/payment/:supplier/:result": "orders.paymentResult",
		// "POST /order/payment/paypalipn": "orders.paypalIpn", // old api
		"POST /order/payment/webhook/:supplier": "orders.paymentWebhook",

		// Pages
		"GET /pages/:category": "pages.pagesList",
		"POST /pages/:category": "pages.pagesList", // needed for category with filter url
		"POST /pages/filter": "pages.findWithCount",
		"POST /pages/find": "pages.findWithCount",
		"POST /pages/listTemplates/:page": "pages.listTemplates",
		"GET /pages/:category/detail/:page": "pages.detail",
		"PUT /pages": "pages.import",
		"DELETE /pages": "pages.delete",
		"POST /pages/count": "pages.count",
		"POST /pages/upload/:slug/:type": function (req, res) {
			this.processUpload(req, res);
		},
		"POST /pages/upload/:slug/": function (req, res) {
			this.processUpload(req, res);
		},

		// Global
		"POST /find": "api.globalSearch",

		// Settings
		"POST /settings": "api.settings",
		"PUT /settings": "api.settingsUpdate",
		// "POST /settings/users": "users.list",
		// "PUT /settings/users": "users.manage",

		// Helpers
		"POST /helpers/recaptcha": "users.recaptcha"
	},

	onBeforeCall(ctx, route, req) {
		this.logger.info("api.authorize() visitor IP: ", req.connection.remoteAddress);
		ctx.meta.remoteAddress = req.connection.remoteAddress;
		ctx.meta.remotePort = req.connection.remotePort;
		// update localsDefault according to cookie value if possible
		ctx.meta.localsDefault = this.settings.localsDefault;
		ctx.meta.mailSettings = this.settings.mailSettings;
		ctx.meta.siteSettings = this.settings.siteSettings;
		ctx.meta.siteSettings.translation = this.settings.translation;
		ctx.meta.siteSettings.assets = this.settings.assets;
	},


	onAfterCall(ctx, route, req, res, data) {
		// writing cookies
		this.logger.info("apiV1 onAfterCall - ctx.meta.makeCookies: ", ctx.meta.makeCookies);
		if (ctx.meta.makeCookies) {
			Object.keys(ctx.meta.makeCookies).forEach(function(key) {
				if ( ctx.meta.makeCookies[key].options && ctx.meta.makeCookies[key].options.expires ) {
					ctx.meta.makeCookies[key].options.expires = new Date(ctx.meta.makeCookies[key].options.expires);
				}

				if ( process.env.COOKIES_SECURE ) {
					if ( process.env.HTTPS_KEY && process.env.HTTPS_CERT ) {
						res.cookies.set(
							key, 
							ctx.meta.makeCookies[key].value, 
							ctx.meta.makeCookies[key].options
						);
					} else {
						res.setHeader("Set-Cookie", 
							cookie.serialize(
								key, 
								String(ctx.meta.makeCookies[key].value), 
								ctx.meta.makeCookies[key].options
							)
						);
					}
				} else { // not secure cookie
					ctx.meta.makeCookies[key].options["secure"] = false;
					res.cookies.set(
						key, 
						ctx.meta.makeCookies[key].value, 
						ctx.meta.makeCookies[key].options
					);
				}
			});
		} else if (ctx.meta.doRedirect) {
			res.setHeader("Location", ctx.meta.doRedirect);
		} else {
			if (ctx.meta.token === null) {
				// delete token cookie if not set in ctx.meta - erased on logout
				res.cookies.set("token", null, null);
			}
			res.cookies.set("order_no_verif", null, null);
		}

		if (ctx.meta.afterCallAction) {
			this.afterCallAction(ctx.meta.afterCallAction);
		}

		// writing special headers
		return data;
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
};
