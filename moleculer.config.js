"use strict";

/**
 * Keep this file free of project `require()`s (e.g. mixins/*).
 * Moleculer hot-reload treats config dependencies as brokerRestart triggers;
 * on macOS fs.watch often emits spurious "change" events when watchers are
 * recreated after a restart, which causes an infinite restart loop.
 */
function getCacherConfig() {
	const useRedis = process.env.NODE_ENV === "production" && !!process.env.TRANSPORTER?.trim();
	if (useRedis) {
		const redis = process.env.REDIS_URL;
		if (!redis || !redis.toString().trim()) {
			throw new Error("Missing required environment variable: REDIS_URL");
		}
		return {
			type: "Redis",
			options: {
				prefix: process.env.CACHER_PREFIX || "stretchshop",
				ttl: parseInt(process.env.CACHER_TTL || "3600", 10),
				redis,
				maxParamsLength: 100,
			},
		};
	}
	return {
		type: "Memory",
		options: {
			maxParamsLength: 100,
		},
	};
}

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
	cacher: getCacherConfig(),

	// Prometheus HTTP server on :3030 races with --hot reloads (ERR_SERVER_NOT_RUNNING / EADDRINUSE).
	// Off in local/dev/test; set METRICS_ENABLED=true to force on, =false to force off.
	metrics: {
		enabled: process.env.METRICS_ENABLED === "true" || (
			process.env.METRICS_ENABLED !== "false" &&
			!["development", "dockerdev", "test"].includes(process.env.NODE_ENV)
		),
		reporter: {
			type: "Prometheus",
			options: {
				port: 3030,
				path: "/metrics",
				defaultLabels: registry => ({
					namespace: registry.broker.namespace,
					nodeID: registry.broker.nodeID
				})
			}
		}
	},

	tracing: {
		enabled: true,
		exporter: {
			type: "Console", // Console exporter is only for development!
			options: {
				logger: null,
				colors: true,
				width: 100,
				gaugeWidth: 40
			}
		}
	},
};
