"use strict";

const { MongoClient } = require("mongodb");
const { useRedisCacher } = require("../mixins/env.helpers");

module.exports = {
	name: "metrics",

	actions: {
		health: {
			cache: false,
			handler(ctx) {
				return this.checkHealth(ctx);
			},
		},
	},

	methods: {
		async checkHealth(ctx) {
			const result = {
				status: "ok",
				timestamp: new Date().toISOString(),
				uptime: process.uptime(),
				nodeID: ctx.broker.nodeID,
				namespace: ctx.broker.namespace,
				checks: {},
			};

			if (!ctx.broker.started) {
				result.status = "error";
				result.checks.broker = "not started";
				return result;
			}
			result.checks.broker = "ok";

			if (process.env.MONGO_URI) {
				result.checks.mongo = await this.pingMongo(process.env.MONGO_URI);
			}

			if (process.env.TRANSPORTER?.trim()) {
				result.checks.transporter = await this.pingTransporter(ctx);
			}

			if (useRedisCacher()) {
				result.checks.redis = await this.pingRedis(ctx);
			}

			const failedChecks = Object.values(result.checks).filter(status => status !== "ok");
			if (failedChecks.length > 0) {
				result.status = "degraded";
			}

			return result;
		},

		async pingMongo(mongoUri) {
			let client;
			try {
				client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 });
				await client.connect();
				await client.db().admin().command({ ping: 1 });
				return "ok";
			} catch (err) {
				this.logger.warn("Health check: MongoDB ping failed");
				return "error";
			} finally {
				if (client) {
					await client.close().catch(() => {});
				}
			}
		},

		async pingTransporter(ctx) {
			try {
				await ctx.broker.call("$node.list", {}, { timeout: 3000 });
				return "ok";
			} catch (err) {
				this.logger.warn("Health check: transporter ping failed");
				return "error";
			}
		},

		async pingRedis(ctx) {
			try {
				const cacher = ctx.broker.cacher;
				if (!cacher || typeof cacher.get !== "function") {
					return "error";
				}
				const probeKey = `${cacher.prefix || "stretchshop"}:health:${ctx.broker.nodeID}`;
				await cacher.set(probeKey, Date.now(), 5);
				await cacher.get(probeKey);
				await cacher.del(probeKey);
				return "ok";
			} catch (err) {
				this.logger.warn("Health check: Redis ping failed");
				return "error";
			}
		},
	},
};
