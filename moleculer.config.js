"use strict";

module.exports = {
	timeout: 10000,
	namespace: "stretchshop",
	//transporter: "TCP",
	logger: true,
	logLevel: "info",
	logFormatter: "short",
	cacher: {
		type: "memory",
		options: {
			maxParamsLength: 100
		}
	},
	metrics: true
};
