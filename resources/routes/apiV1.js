"use strict";

let cookie = require("cookie");

module.exports = {
	path: "/api/v1",

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
		"POST /user/verify": "users.verifyHash",
		"POST /user/reset": "users.resetPassword",
		"PUT /user": "users.updateUser",
		"POST /user/image": function (req, res) {
			this.processUpload(req, res);
		},
		"DELETE /user/image/:type/:code/:image": "users.deleteUserImage",
		"DELETE /user/profile": "users.deleteProfile",
		"POST /user/cancelDelete": "users.cancelDelete",

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
		"POST /products/filter": "products.findWithCount",
		"POST /products/find": "products.find",
		"POST /products/:category": "products.productsList", // needed for category with filter url
		"GET /products/:category/detail/:product": "products.detail",
		"PUT /products": "products.import",
		"POST /products/count": "products.count",
		"DELETE /products": "products.delete",
		"POST /products/upload/:orderCode/:type": function (req, res) {
			this.processUpload(req, res);
		},

		// Categories
		"GET /category/:categoryPath": "categories.detail",
		"PUT /categories": "categories.import",
		"POST /categories/find": "categories.findWithContent",
		"DELETE /categories": "categories.delete",
		"POST /categories/upload/:slug": function (req, res) {
			this.processUpload(req, res);
		},

		// Order
		"GET /order/progress": "orders.progress",
		"POST /order/progress": "orders.progress",
		"POST /order/list": "orders.listOrders",
		"REST /webhook/:service": "orders.paymentWebhook",
		"GET /order/invoice/download/:invoice": "orders.invoiceDownload",
		"GET /order/invoice/generate/:orderId": "orders.invoiceGenerate",
		// Payment PayPal
		"POST /order/paypalcheckout": "orders.paypalOrderCheckout",
		"GET /order/paypalipn": "orders.paypalIpn",
		"GET /order/paypal/:result": "orders.paypalResult",

		// Pages
		"GET /pages/:category": "pages.pagesList",
		"POST /pages/find": "pages.findWithCount",
		"POST /pages/listTemplates/:page": "pages.listTemplates",
		"POST /pages/:category": "pages.pagesList", // needed for category with filter url
		"GET /pages/:category/detail/:page": "pages.detail",
		"PUT /pages": "pages.import",
		"POST /pages/count": "pages.count",
		"DELETE /pages": "pages.delete",
		"GET /pages/tags": "pages.tags",
		"GET /pages/feed": "pages.feed",
		"POST /pages/upload/:slug": function (req, res) {
			this.processUpload(req, res);
		},

		// Helpers
		"POST /helpers/recaptcha": "users.recaptcha"
	},

	onAfterCall(ctx, route, req, res, data) {
		if (ctx.meta.makeTokenCookie) {
			if ( ctx.meta.makeTokenCookie.options && ctx.meta.makeTokenCookie.options.expires ) {
				ctx.meta.makeTokenCookie.options.expires = new Date(ctx.meta.makeTokenCookie.options.expires);
			}

			console.log("ctx.meta.makeTokenCookie.options:", ctx.meta.makeTokenCookie.options);
			if ( process.env.COOKIES_SECURE ) {
				if ( process.env.HTTPS_KEY && process.env.HTTPS_CERT ) {
					res.cookies.set(
						"token", 
						ctx.meta.makeTokenCookie.value, 
						ctx.meta.makeTokenCookie.options
					);
				} else {
					res.setHeader("Set-Cookie", 
						cookie.serialize(
							"token", 
							String(ctx.meta.makeTokenCookie.value), 
							ctx.meta.makeTokenCookie.options
						)
					);
				}
			} else { // not secure cookie
				ctx.meta.makeTokenCookie.options["secure"] = false;
				res.cookies.set(
					"token", 
					ctx.meta.makeTokenCookie.value, 
					ctx.meta.makeTokenCookie.options
				);
			}
		} else if (ctx.meta.token === null) {
			// delete token cookie if not set in ctx.meta - erased on logout
			res.cookies.set("token", null, null);
		}
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
