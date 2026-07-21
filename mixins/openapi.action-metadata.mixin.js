"use strict";

const { actionOpenApi } = require("../docs/openapi/enrich-actions");

/**
 * Moleculer mixin: merges OpenAPI metadata into existing actions (never creates new actions).
 * @param {string} serviceName
 */
module.exports = function openApiActionMetadataMixin(serviceName) {
	return {
		merged(schema) {
			const meta = actionOpenApi[serviceName];
			if (!meta || !schema.actions) return;

			Object.entries(meta).forEach(([actionName, openapi]) => {
				if (schema.actions[actionName]) {
					schema.actions[actionName].openapi = {
						...openapi,
						...(schema.actions[actionName].openapi || {}),
					};
				}
			});
		},
	};
};
