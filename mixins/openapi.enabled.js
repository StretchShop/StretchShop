"use strict";

/**
 * Whether runtime OpenAPI routes and metadata are active.
 * Enabled when OPENAPI_ENABLED=true, in dev/test envs, or on the public demo host.
 */
function isOpenApiEnabled() {
	if (process.env.OPENAPI_ENABLED === "true") return true;
	if (process.env.OPENAPI_ENABLED === "false") return false;
	if (["development", "dockerdev", "test"].includes(process.env.NODE_ENV)) return true;
	const siteUrl = process.env.SITE_URL || "";
	if (/demo\.stretchshop\.app/i.test(siteUrl)) return true;
	return false;
}

module.exports = { isOpenApiEnabled };
