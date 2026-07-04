"use strict";

const path = require("path");
const { ServiceBroker } = require("moleculer");
const moleculerConfig = require(path.resolve(__dirname, "../../moleculer.config.js"));

/**
 * Create a ServiceBroker configured for unit/integration tests.
 * Disables metrics, tracing, and process signal handlers that can exit Jest workers.
 */
function createTestBroker(options = {}) {
	return new ServiceBroker({
		...moleculerConfig,
		logger: false,
		metrics: false,
		tracing: false,
		cacher: false,
		skipProcessEventRegistration: true,
		...options,
	});
}

module.exports = { createTestBroker };
