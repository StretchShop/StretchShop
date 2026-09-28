"use strict";

/**
 * Baseline Content-Security-Policy for the shop SPA and API HTML responses.
 * Vite hashes scripts under 'self'; Stripe and Google reCAPTCHA/gtag load from known CDNs.
 * OpenAPI UI uses a stricter nonce policy in mixins/openapi.ui-url.js instead.
 *
 * @returns {string}
 */
function shopContentSecurityPolicy() {
	return [
		"default-src 'self'",
		"script-src 'self' https://js.stripe.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://www.googletagmanager.com",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: https:",
		"font-src 'self' data:",
		"connect-src 'self' https://api.stripe.com https://www.google.com/recaptcha/ https://www.google-analytics.com https://www.googletagmanager.com https://region1.google-analytics.com",
		"frame-src https://js.stripe.com https://hooks.stripe.com https://www.google.com/recaptcha/ https://recaptcha.google.com",
		"worker-src 'self' blob: https://js.stripe.com",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");
}

/**
 * Apply baseline security headers to an HTTP response.
 * Does not enable Cross-Origin-Embedder-Policy unless COEP_REQUIRE_CORP=true
 * (require-corp breaks Stripe Elements and reCAPTCHA until all embeds send CORP).
 *
 * @param {import("http").ServerResponse} res
 * @param {{ cookiesSecure?: boolean, coepRequireCorp?: boolean }} [options]
 */
function applyBaselineSecurityHeaders(res, options = {}) {
	const cookiesSecure = options.cookiesSecure ?? (process.env.COOKIES_SECURE === "true");
	const coepRequireCorp = options.coepRequireCorp ?? (process.env.COEP_REQUIRE_CORP === "true");

	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	res.setHeader("Content-Security-Policy", shopContentSecurityPolicy());
	res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
	res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
	if (coepRequireCorp) {
		res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
	}
	if (cookiesSecure) {
		res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}
}

module.exports = {
	shopContentSecurityPolicy,
	applyBaselineSecurityHeaders,
};
