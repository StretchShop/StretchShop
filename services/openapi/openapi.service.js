"use strict";

const fs = require("fs");
const path = require("path");
const { OpenApiMixin } = require("@spailybot/moleculer-auto-openapi");
const pkg = require("../../package.json");

const { MoleculerClientError } = require("moleculer").Errors;
const baseComponents = require("../../docs/openapi/swaggerhub-components.json");
const { isOpenApiEnabled } = require("../../mixins/openapi.enabled");
const {
	resolveOpenApiUiSpecUrl,
	createCspNonce,
	openApiUiCsp,
	renderOpenApiUiHtml,
} = require("../../mixins/openapi.ui-url");

const openapiEnabled = isOpenApiEnabled();

module.exports = {
	name: "openapi",
	mixins: [OpenApiMixin],

	settings: {
		rest: "/openapi",
		openApiPaths: "/openapi",
		cacheOpenApi: true,
		openapi: {
			info: {
				title: baseComponents.info?.title || `${pkg.name} API Documentation`,
				description: baseComponents.info?.description || "StretchShop REST API",
				version: pkg.version,
				contact: baseComponents.info?.contact,
				license: baseComponents.info?.license,
			},
			tags: baseComponents.tags,
			components: baseComponents.components,
			server: { url: "/api/v1", description: "Main API (relative to host)" },
		},
	},

	created() {
		if (!openapiEnabled) {
			this.logger.warn("OpenAPI docs disabled (set OPENAPI_ENABLED=true to enable in production)");
		}
	},

	started() {
		if (openapiEnabled) {
			this.logger.info("OpenAPI docs: GET /openapi/ui | GET /openapi/openapi.json");
		}
	},

	actions: {
		/**
		 * Override mixin UI: the upstream handler interpolates `?url=` into a
		 * <script> tag via JSON.stringify, which does not escape </script> (XSS).
		 */
		ui: {
			rest: { path: "/ui", method: "GET" },
			openapi: {
				summary: "OpenAPI ui",
				description: "Serves Swagger UI for the local generated schema only",
				tags: ["OpenApi"],
			},
			params: {
				url: { type: "string", optional: true },
			},
			async handler(ctx) {
				const paths = await this.getOpenApiPaths();
				const resolved = resolveOpenApiUiSpecUrl(ctx.params.url, paths.schemaPath);
				if (!resolved.ok) {
					throw new MoleculerClientError("Invalid OpenAPI spec url", 400, "INVALID_OPENAPI_URL", [
						{ field: "url", message: "must be the local schema path" },
					]);
				}
				const nonce = createCspNonce();
				ctx.meta.$responseType = "text/html; charset=utf-8";
				ctx.meta.$responseHeaders = {
					"Content-Security-Policy": openApiUiCsp(nonce),
					"X-Content-Type-Options": "nosniff",
					"Referrer-Policy": "no-referrer",
				};
				return renderOpenApiUiHtml({
					specUrl: resolved.url,
					assetsPath: paths.assetsPath,
					oauth2RedirectUrl: paths.oauth2RedirectPath,
					nonce,
					oauthOptions: this.settings.UIOauthOptions,
					uiOptions: this.settings.UIOptions,
				});
			},
		},

		exportDocs: {
			visibility: "public",
			params: {
				outPath: { type: "string", optional: true, default: "docs/openapi/generated.json" },
			},
			async handler(ctx) {
				const schema = await ctx.call("openapi.generateDocs");
				const outPath = path.resolve(process.cwd(), ctx.params.outPath);
				fs.mkdirSync(path.dirname(outPath), { recursive: true });
				fs.writeFileSync(outPath, JSON.stringify(schema, null, 2));
				return { success: true, path: outPath };
			},
		},
	},
};
