"use strict";

const stripeCheckout = require("./payments.stripe.checkout.mixin");
const stripeSubscription = require("./payments.stripe.subscription.mixin");
const stripeWebhook = require("./payments.stripe.webhook.mixin");
const stripeHelpers = require("./payments.stripe.helpers.mixin");

module.exports = {
	mixins: [
		stripeCheckout,
		stripeSubscription,
		stripeWebhook,
		stripeHelpers
	]
};
