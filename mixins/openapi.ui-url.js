"use strict";

const crypto = require("node:crypto");

const DEFAULT_SPEC_URL = "/openapi/openapi.json";

/**
 * Encode JSON so it is safe inside an HTML <script> tag.
 * JSON.stringify does not escape </script>, which would close the tag and enable XSS.
 */
function jsonForHtmlScript(value) {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

/**
 * Only the local generated spec may be loaded. Empty/missing url uses the default.
 * Anything else (javascript:, remote hosts, HTML metacharacters) is rejected.
 *
 * @returns {{ ok: true, url: string } | { ok: false }}
 */
function resolveOpenApiUiSpecUrl(raw, defaultUrl = DEFAULT_SPEC_URL) {
	const fallback = String(defaultUrl || DEFAULT_SPEC_URL);
	if (raw == null || String(raw).trim() === "") {
		return { ok: true, url: fallback };
	}
	const value = String(raw).trim();
	if (
		/[<>"'`\\]/.test(value) ||
		/[\u0000-\u001F\u2028\u2029]/.test(value) ||
		/^\s*(javascript|data|vbscript|file):/i.test(value) ||
		value.startsWith("//")
	) {
		return { ok: false };
	}
	if (value === fallback) {
		return { ok: true, url: fallback };
	}
	return { ok: false };
}

function createCspNonce() {
	return crypto.randomBytes(16).toString("base64url");
}

function openApiUiCsp(nonce) {
	return [
		"default-src 'none'",
		`script-src 'nonce-${nonce}' 'self'`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"connect-src 'self'",
		"font-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"object-src 'none'",
	].join("; ");
}

/**
 * Swagger UI HTML that never interpolates unsanitized query params into the page.
 */
function renderOpenApiUiHtml({
	specUrl,
	assetsPath,
	oauth2RedirectUrl,
	nonce,
	oauthOptions,
	uiOptions,
}) {
	const settings = {
		swaggerSettings: {
			deepLinking: true,
			showExtensions: true,
			layout: "StandaloneLayout",
			...(uiOptions || {}),
			// Force after UIOptions so a mixin setting cannot re-enable query-param config.
			validatorUrl: null,
			queryConfigEnabled: false,
			url: specUrl,
			dom_id: "#swagger-ui",
			oauth2RedirectUrl,
		},
		oauth: oauthOptions || undefined,
	};

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>OpenAPI UI</title>
	<style>body{margin:0}</style>
</head>
<body>
	<div id="swagger-ui"><p>Loading...</p><noscript>JavaScript is required to view API docs.</noscript></div>
	<script type="application/json" id="__SWAGGER_SETTINGS__">${jsonForHtmlScript(settings)}</script>
	<script nonce="${nonce}">
		var assetsURL = ${jsonForHtmlScript(assetsPath)};
		var configElement = document.getElementById("__SWAGGER_SETTINGS__");
		if (!configElement) { throw new Error("fail to load configurations"); }
		var settings = JSON.parse(configElement.textContent);
		window.onload = function () {
			var cssLink = document.createElement("link");
			cssLink.rel = "stylesheet";
			cssLink.href = assetsURL + "/swagger-ui.css";
			document.head.appendChild(cssLink);
			function initSwaggerUIDependentCode() {
				var ui = SwaggerUIBundle(Object.assign(settings.swaggerSettings, {
					presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
					plugins: [SwaggerUIBundle.plugins.DownloadUrl]
				}));
				if (settings.oauth) { ui.initOAuth(settings.oauth); }
			}
			var scripts = [assetsURL + "/swagger-ui-bundle.js", assetsURL + "/swagger-ui-standalone-preset.js"];
			var scriptsLoaded = 0;
			function loadScript(script, callback) {
				var scriptElement = document.createElement("script");
				scriptElement.src = script;
				scriptElement.onload = function () {
					scriptsLoaded++;
					if (scriptsLoaded === scripts.length) { callback(); }
				};
				document.body.appendChild(scriptElement);
			}
			for (var i = 0; i < scripts.length; i++) {
				loadScript(scripts[i], initSwaggerUIDependentCode);
			}
		};
	</script>
</body>
</html>`;
}

module.exports = {
	DEFAULT_SPEC_URL,
	jsonForHtmlScript,
	resolveOpenApiUiSpecUrl,
	createCspNonce,
	openApiUiCsp,
	renderOpenApiUiHtml,
};
