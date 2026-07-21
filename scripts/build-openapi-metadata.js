"use strict";

/**
 * Builds docs/openapi/swaggerhub-components.json and docs/openapi/action-openapi.js
 * from the SwaggerHub spec and apiV1 route aliases.
 *
 * Usage: node scripts/build-openapi-metadata.js
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const SWAGGERHUB_URL = "https://api.swaggerhub.com/apis/marcelzubrik/StretchShop_API/1.0.0-oas3";
const OUT_DIR = path.resolve(__dirname, "../docs/openapi");

/** Route aliases from resources/routes/apiV1.js (method + path -> service.action) */
const API_V1_ALIASES = {
	"GET /coredata": "users.getCoreData",
	"GET /coredata/translation": "users.readTranslation",
	"PUT /coredata/translation": "users.updateDictionary",
	"POST /users/login": "users.login",
	"GET /users/logout": "users.logout",
	"POST /users/checkemail": "users.checkIfEmailExists",
	"POST /users/checkusername": "users.checkIfUserExists",
	"POST /users/register": "users.create",
	"GET /user": "users.me",
	"PUT /user": "users.updateUser",
	"POST /user/verify": "users.verifyHash",
	"POST /user/reset": "users.resetPassword",
	"DELETE /user/image/:type/:code/:image": "users.deleteUserImage",
	"DELETE /user/profile": "users.deleteProfile",
	"POST /user/cancelDelete": "users.cancelDelete",
	"GET /cart": "cart.me",
	"POST /cart": "cart.updateCartItemAmount",
	"PUT /cart": "cart.add",
	"DELETE /cart": "cart.delete",
	"POST /cart/find": "cart.find",
	"DELETE /cart/:itemId": "cart.delete",
	"DELETE /cart/:itemId/:amount": "cart.delete",
	"GET /products/:category": "products.productsListGet",
	"POST /products/:category": "products.productsList",
	"POST /products/filter": "products.findWithCount",
	"POST /products/find": "products.find",
	"GET /products/:category/detail/:product": "products.detail",
	"PUT /products": "products.import",
	"DELETE /products": "products.delete",
	"POST /products/count": "products.count",
	"GET /products/rebuildpl/:id": "products.rebuildProductPriceLevels",
	"GET /category/:categoryPath": "categories.detail",
	"PUT /categories": "categories.import",
	"DELETE /categories": "categories.delete",
	"POST /categories/find": "categories.findWithContent",
	"GET /order/progress": "orders.progress",
	"POST /order/progress": "orders.progress",
	"POST /order/list": "orders.listOrders",
	"POST /order/invoice/download/:invoice": "orders.invoiceDownload",
	"POST /order/invoice/pay/:orderId": "orders.paid",
	"POST /order/invoice/cancel/:orderId": "orders.cancel",
	"POST /order/invoice/expeded/:orderId": "orders.expede",
	"POST /subscription/list": "subscriptions.listSubscriptions",
	"POST /subscription/suspend/:subscriptionId": "subscriptions.suspend",
	"POST /subscription/reactivate/:subscriptionId": "subscriptions.reactivate",
	"POST /order/payment/:supplier/:action": "orders.payment",
	"GET /order/payment/:supplier/:result": "orders.paymentResult",
	"POST /order/payment/webhook/:supplier": "orders.paymentWebhook",
	"GET /pages/:category": "pages.pagesList",
	"POST /pages/:category": "pages.pagesList",
	"POST /pages/filter": "pages.findWithCount",
	"POST /pages/find": "pages.findWithCount",
	"POST /pages/listTemplates/:page": "pages.listTemplates",
	"GET /pages/:category/detail/:page": "pages.detail",
	"PUT /pages": "pages.import",
	"DELETE /pages": "pages.delete",
	"POST /pages/count": "pages.count",
	"POST /find": "api.globalSearch",
	"POST /settings": "api.settings",
	"PUT /settings": "api.settingsUpdate",
	"POST /helpers/recaptcha": "users.recaptcha",
};

/** Extra routes not in apiV1 */
const EXTRA_ALIASES = {
	"POST /order/payment/webhook-raw/:supplier": "orders.paymentWebhookRaw",
};

const CSRF_ACTIONS = new Set([
	"users.login",
	"users.create",
	"users.checkIfEmailExists",
	"users.checkIfUserExists",
]);

const COOKIE_ACTIONS = new Set([
	"users.logout",
	"users.me",
	"users.updateUser",
	"users.verifyHash",
	"users.resetPassword",
	"users.deleteUserImage",
	"users.deleteProfile",
	"users.cancelDelete",
	"cart.find",
	"orders.listOrders",
	"orders.invoiceDownload",
	"orders.paid",
	"orders.cancel",
	"orders.expede",
	"orders.payment",
	"orders.paymentResult",
	"subscriptions.listSubscriptions",
	"subscriptions.suspend",
	"subscriptions.reactivate",
	"api.settings",
	"api.settingsUpdate",
	"users.recaptcha",
]);

function fetchJson(url) {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			let data = "";
			res.on("data", (chunk) => { data += chunk; });
			res.on("end", () => {
				try {
					resolve(JSON.parse(data));
				} catch (err) {
					reject(err);
				}
			});
		}).on("error", reject);
	});
}

function normalizePath(routePath) {
	return routePath.replace(/:(\w+)/g, "{$1}");
}

function parseAliasKey(key) {
	const [method, ...pathParts] = key.split(" ");
	return { method: method.toLowerCase(), path: normalizePath(pathParts.join(" ")) };
}

function sanitizeOpenApi(obj) {
	if (obj === null || obj === undefined) return undefined;
	if (Array.isArray(obj)) {
		return obj.map(sanitizeOpenApi).filter((v) => v !== undefined);
	}
	if (typeof obj === "object") {
		return Object.fromEntries(
			Object.entries(obj)
				.map(([k, v]) => [k, sanitizeOpenApi(v)])
				.filter(([, v]) => v !== undefined)
		);
	}
	return obj;
}

function buildSecurity(actionFullName) {
	if (CSRF_ACTIONS.has(actionFullName)) {
		return [{ CsrfHeader: [] }];
	}
	if (COOKIE_ACTIONS.has(actionFullName)) {
		return [{ CookieAuth: [] }];
	}
	return [];
}

function operationToOpenApi(op, actionFullName) {
	if (!op) return null;
	const openapi = sanitizeOpenApi({
		summary: op.summary,
		description: op.description,
		operationId: op.operationId,
		tags: op.tags,
		responses: op.responses,
	}) || {};
	const security = buildSecurity(actionFullName);
	if (security.length) {
		openapi.security = security;
	}
	return openapi;
}

function addPaymentOverrides(actionOpenApi) {
	// Stripe subscription prepare (via orders.payment with action=prepare)
	if (!actionOpenApi.orders) actionOpenApi.orders = {};
	actionOpenApi.orders.payment = {
		summary: "Order payment action (prepare, notify, etc.)",
		description: "Routes to supplier-specific payment handlers. Use action=prepare to start Stripe checkout or subscription setup. For subscription orders with finite cycles and dateEnd, Stripe subscriptions receive cancel_at automatically.",
		tags: ["user"],
		security: [{ CookieAuth: [] }],
		responses: {
			200: {
				description: "Payment prepare or action result",
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/PaymentActionResponse" },
					},
				},
			},
		},
	};

	actionOpenApi.orders.stripeOrderSubscription = {
		summary: "Stripe subscription payment prepare",
		description: "Creates or retrieves a Stripe subscription and returns clientSecret for Elements. Finite plans (cycles > 0 with dateEnd) set Stripe cancel_at from dates.dateEnd.",
		tags: ["user"],
		security: [{ CookieAuth: [] }],
		responses: {
			200: {
				description: "Stripe subscription prepare result",
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/StripeSubscriptionPrepareResponse" },
					},
				},
			},
		},
	};

	if (!actionOpenApi.subscriptions) actionOpenApi.subscriptions = {};
	actionOpenApi.subscriptions.listSubscriptions = {
		summary: "List user subscriptions",
		description: "Paginated list of subscriptions for the logged-in user (admins may pass fullData).",
		tags: ["user"],
		security: [{ CookieAuth: [] }],
		responses: {
			200: {
				description: "Paginated subscription list",
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/SubscriptionListResponse" },
					},
				},
			},
		},
	};

	actionOpenApi.subscriptions.suspend = {
		summary: "Suspend subscription",
		description: "Suspends a subscription and cancels the Stripe billing agreement when found.",
		tags: ["user"],
		security: [{ CookieAuth: [] }],
		responses: {
			200: {
				description: "Suspend result",
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/SubscriptionActionResponse" },
					},
				},
			},
		},
	};

	actionOpenApi.subscriptions.reactivate = {
		summary: "Reactivate suspended subscription",
		description: "Not implemented — route exists but handler is missing.",
		tags: ["admin"],
		deprecated: true,
		security: [{ CookieAuth: [] }],
		responses: {
			501: {
				description: "Not implemented",
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/Error" },
					},
				},
			},
		},
	};

	if (!actionOpenApi.orders.paymentWebhookRaw) {
		actionOpenApi.orders.paymentWebhookRaw = {
			summary: "Stripe raw-body payment webhook",
			description: "Webhook endpoint with raw body parsing for Stripe signature verification. URL: POST /apis/v1/order/payment/webhook-raw/{supplier}",
			tags: ["developer"],
			responses: {
				200: {
					description: "Webhook processed",
					content: {
						"application/json": {
							schema: { type: "object" },
						},
					},
				},
			},
		};
	}
}

async function main() {
	const spec = await fetchJson(SWAGGERHUB_URL);

	const extraSchemas = {
		StripeSubscriptionPrepareResponse: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				url: { type: "string", nullable: true },
				message: { type: "string" },
				data: {
					type: "object",
					properties: {
						clientSecret: { type: "string", nullable: true, description: "Stripe client secret from setup intent, confirmation_secret, or payment_intent" },
						existing: { type: "boolean" },
						supplier: { type: "object", nullable: true },
						finished: { type: "boolean" },
						message: { type: "string" },
					},
				},
				paymentStatus: {
					type: "object",
					description: "Attached when called via orders.payment prepare",
				},
			},
		},
		PaymentActionResponse: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				url: { type: "string", nullable: true },
				message: { type: "string" },
				data: { type: "object", nullable: true },
				paymentStatus: { type: "object", nullable: true },
			},
		},
		SubscriptionListResponse: {
			type: "object",
			properties: {
				total: { type: "number" },
				results: {
					type: "array",
					items: { $ref: "#/components/schemas/Subscription" },
				},
			},
		},
		SubscriptionActionResponse: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				url: { type: "string", nullable: true },
				message: { type: "string" },
				error: { type: "string", nullable: true },
			},
		},
		Error: {
			type: "object",
			properties: {
				name: { type: "string" },
				message: { type: "string" },
				code: { type: "number" },
				type: { type: "string" },
				data: { type: "object" },
			},
		},
	};

	const components = sanitizeOpenApi({
		info: spec.info,
		tags: spec.tags,
		components: {
			schemas: {
				...spec.components.schemas,
				...extraSchemas,
			},
			securitySchemes: {
				CookieAuth: {
					type: "apiKey",
					in: "cookie",
					name: "token",
					description: "JWT session cookie set after login",
				},
				CsrfHeader: {
					type: "apiKey",
					in: "header",
					name: "x-xsrf-token",
					description: "CSRF token required for login, register, and email/username checks",
				},
			},
		},
	});

	fs.mkdirSync(OUT_DIR, { recursive: true });
	fs.writeFileSync(
		path.join(OUT_DIR, "swaggerhub-components.json"),
		JSON.stringify(components, null, 2)
	);

	const actionOpenApi = {};
	const allAliases = { ...API_V1_ALIASES, ...EXTRA_ALIASES };

	Object.entries(allAliases).forEach(([aliasKey, actionFullName]) => {
		const { method, path: routePath } = parseAliasKey(aliasKey);
		const pathItem = spec.paths[routePath];
		if (!pathItem) {
			// path with different param names may not match — try without normalization issues
			return;
		}
		const op = pathItem[method];
		if (!op) return;

		const [serviceName, actionName] = actionFullName.split(".");
		if (!actionOpenApi[serviceName]) actionOpenApi[serviceName] = {};
		actionOpenApi[serviceName][actionName] = operationToOpenApi(op, actionFullName);
	});

	addPaymentOverrides(actionOpenApi);

	const jsContent = `"use strict";

/**
 * OpenAPI metadata keyed by service name and action name.
 * Generated by scripts/build-openapi-metadata.js — re-run after SwaggerHub updates.
 */
module.exports = ${JSON.stringify(actionOpenApi, null, 2)};
`;

	fs.writeFileSync(path.join(OUT_DIR, "action-openapi.js"), jsContent);

	// SwaggerHub paths-only export for drift comparison
	fs.writeFileSync(
		path.join(OUT_DIR, "swaggerhub-export.json"),
		JSON.stringify({ paths: spec.paths, openapi: spec.openapi, info: spec.info }, null, 2)
	);

	console.log("Wrote docs/openapi/swaggerhub-components.json");
	console.log("Wrote docs/openapi/action-openapi.js");
	console.log(`Mapped ${Object.values(actionOpenApi).reduce((n, s) => n + Object.keys(s).length, 0)} actions`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
