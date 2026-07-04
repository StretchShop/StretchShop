"use strict";

process.env.NODE_ENV = "test";

if (!process.env.JWT_SECRET) {
	process.env.JWT_SECRET = "test-jwt-secret";
}

if (!process.env.STRIPE_SECRET_KEY) {
	process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
}

if (!process.env.STRIPE_PUBLISHABLE_KEY) {
	process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_dummy";
}

if (!process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET) {
	process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET = "whsec_test_dummy";
}
