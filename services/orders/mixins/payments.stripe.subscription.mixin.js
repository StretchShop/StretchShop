"use strict";

module.exports = {
	mixins: [
		require("./payments.stripe.subscription.action.mixin"),
		require("./payments.stripe.subscription.setup.methods"),
		require("./payments.stripe.subscription.create.methods")
	]
};
