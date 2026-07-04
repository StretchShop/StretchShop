"use strict";

module.exports = {
	mixins: [
		require("./subscription-core.methods"),
		require("./subscription-billing.methods"),
		require("./suspend.methods"),
	]
};
