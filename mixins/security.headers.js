"use strict";

/**
 * Baseline Content-Security-Policy for the shop SPA and API HTML responses.
 * Hosts match the widgets the Vue app loads, including the frames and API calls
 * those libraries make after the first script:
 * - Stripe Payment Element (js.stripe.com/v3, Link, 3-D Secure, Maps autocomplete)
 * - Google reCAPTCHA v3
 * - Google tag (vue-gtag → googletagmanager.com/gtag/js, then Analytics)
 * - Packeta pickup widget
 * - YouTube and Vimeo embeds from the page editor
 * OpenAPI UI uses a stricter nonce policy in mixins/openapi.ui-url.js instead.
 *
 * @returns {string}
 */
function shopContentSecurityPolicy() {
	const stripeScripts = "https://js.stripe.com https://*.js.stripe.com https://maps.googleapis.com";
	const stripeFrames = "https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://link.com https://*.link.com";
	const stripeConnect = "https://api.stripe.com https://maps.googleapis.com https://link.com https://*.link.com";

	const recaptchaScripts = "https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/";
	const recaptchaFrames = "https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/";
	const recaptchaConnect = "https://www.google.com/recaptcha/";

	const gtagScripts = "https://www.googletagmanager.com https://*.googletagmanager.com";
	const gtagConnect = "https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://*.googletagmanager.com";
	const gtagFrames = "https://www.googletagmanager.com";

	const packetaFrames = [
		"https://widget.packeta.com",
		"https://hd.widget.packeta.com",
		"https://backup.widget.packeta.com",
		"https://error-page-service-widget-errors.prod.packeta-com.codenow.com",
	].join(" ");
	const packetaConnect = "https://widget.packeta.com https://hd.widget.packeta.com";

	const embedFrames = "https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com";

	return [
		"default-src 'self'",
		`script-src 'self' ${stripeScripts} ${recaptchaScripts} ${gtagScripts} https://widget.packeta.com`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: https:",
		"font-src 'self' data:",
		`connect-src 'self' ${stripeConnect} ${recaptchaConnect} ${gtagConnect} ${packetaConnect}`,
		`frame-src ${stripeFrames} ${recaptchaFrames} ${gtagFrames} ${packetaFrames} ${embedFrames}`,
		"worker-src 'self' blob: https://js.stripe.com https://*.js.stripe.com",
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
	res.setHeader(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=(self \"https://widget.packeta.com\" \"https://hd.widget.packeta.com\" \"https://backup.widget.packeta.com\")"
	);
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
