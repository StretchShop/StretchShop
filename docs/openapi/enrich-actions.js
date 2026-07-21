"use strict";

const actionOpenApi = require("./action-openapi");

/**
 * Merge OpenAPI metadata into a service actions object (for moleculer-auto-openapi).
 * @param {string} serviceName
 * @param {object} actions
 * @returns {object}
 */
function enrichServiceActions(serviceName, actions) {
	const meta = actionOpenApi[serviceName];
	if (!meta) return actions;

	const enriched = {};
	for (const [name, def] of Object.entries(actions)) {
		if (meta[name]) {
			enriched[name] = {
				...def,
				openapi: {
					...meta[name],
					...(def.openapi || {}),
				},
			};
		} else {
			enriched[name] = def;
		}
	}
	return enriched;
}

/**
 * Build openapi-only action stubs for merging via moleculer mixin.
 * @param {string} serviceName
 * @returns {object}
 */
function buildOpenApiActionStubs(serviceName) {
	const meta = actionOpenApi[serviceName] || {};
	return Object.fromEntries(
		Object.entries(meta).map(([actionName, openapi]) => [actionName, { openapi }])
	);
}

module.exports = {
	enrichServiceActions,
	buildOpenApiActionStubs,
	actionOpenApi,
};
