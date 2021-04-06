"use strict";

module.exports = {
	timeout: 10000,
	namespace: "stretchshop",
	//transporter: "TCP",
	logger: {
		type: "Console",
		options: {
			// Using colors on the output
			colors: true,
			// Print module names with different colors (like docker-compose for containers)
			moduleColors: false,
		}
	},
	cacher: {
		type: "memory",
		options: {
			maxParamsLength: 100
		}
	},

	// Enable/disable built-in metrics function. More info: https://moleculer.services/docs/0.14/metrics.html
	metrics: {
		enabled: true,
		// Available built-in reporters: "Console", "CSV", "Event", "Prometheus", "Datadog", "StatsD"
		reporter: {
			type: "Prometheus",
			options: {
				// HTTP port
				port: 3030,
				// HTTP URL path
				path: "/metrics",
				// Default labels which are appended to all metrics labels
				defaultLabels: registry => ({
					namespace: registry.broker.namespace,
					nodeID: registry.broker.nodeID
				})
			}
		}
	},

	// Enable built-in tracing function. More info: https://moleculer.services/docs/0.14/tracing.html
	tracing: {
		enabled: true,
		// Available built-in exporters: "Console", "Datadog", "Event", "EventLegacy", "Jaeger", "Zipkin"
		exporter: {
			type: "Console", // Console exporter is only for development!
			options: {
				// Custom logger
				logger: null,
				// Using colors
				colors: true,
				// Width of row
				width: 100,
				// Gauge width in the row
				gaugeWidth: 40
			}
		}
	},
};
