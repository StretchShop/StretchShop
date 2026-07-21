"use strict";

const fs = require("fs");
const path = require("path");
const { OpenApiMixin } = require("@spailybot/moleculer-auto-openapi");
const pkg = require("../../package.json");

const baseComponents = require("../../docs/openapi/swaggerhub-components.json");
const { isOpenApiEnabled } = require("../../mixins/openapi.enabled");

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
