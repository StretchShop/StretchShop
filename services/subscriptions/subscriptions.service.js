"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("@stretchshop/moleculer-cron");

// global mixins
const DbService = require("../../mixins/db.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");

// methods
const SubscriptionsActionsQuery = require("./mixins/subscriptions.actions.query.mixin");
const SubscriptionsActionsOrder = require("./mixins/subscriptions.actions.order.mixin");
const SubscriptionsActionsCron = require("./mixins/subscriptions.actions.cron.mixin");
const SubscriptionsActionsCrud = require("./mixins/subscriptions.actions.crud.mixin");
const SubscriptionsActionsBilling = require("./mixins/subscriptions.actions.billing.mixin");
const SubscriptionsActionsSuspend = require("./mixins/subscriptions.actions.suspend.mixin");

const SubscriptionsMethodsCore = require("./methods/core.methods");
const openApiActionMetadata = require("../../mixins/openapi.action-metadata.mixin");

module.exports = {
	name: "subscriptions",
	mixins: [
		CacheCleanerMixin([
			"cache.clean.subscriptions"
		]),
		Cron,
		HelpersMixin,
		// methods
		SubscriptionsMethodsCore,
		SubscriptionsActionsQuery,
		SubscriptionsActionsOrder,
		SubscriptionsActionsCron,
		SubscriptionsActionsCrud,
		SubscriptionsActionsBilling,
		SubscriptionsActionsSuspend,
		openApiActionMetadata("subscriptions"),
		DbService("subscriptions"), // has to be the last to not override actions
	],

	/**
	 * Default settings
	 */
	settings: {
		cronJobs: [{
			name: "SubscriptionsCheck",
			cronTime: "5 0 * * *",
			onTick: function() {

				this.logger.info("Starting to Clean up the Subscriptions");

				this.broker.call("subscriptions.checkSubscriptions")
					.then((data) => {
						this.logger.info("Subscriptions runned", data);
					});
			}
		}, {
			name: "SubscriptionsEndCheck",
			cronTime: "*/15 * * * *",
			onTick: function() {

				this.logger.info("Starting to Check for ending Subscriptions");

				this.broker.call("subscriptions.stopEndingSubscriptions")
					.then((data) => {
						this.logger.info("Subscriptions runned", data);
					});
			}
		}],

		/** Public fields */
		fields: ["_id", "userId", "ip", "type", "period", "duration", "cycles", "cyclesTrial", "status", "orderOriginId", "orderItemName", "dates", "price", "data", "history"],

		/** Validator schema for entity */
		entityValidator: {
			userId: { type: "string", min: 3 },
			ip: { type: "string", min: 4 },
			period: { type: "string", min: 3 }, // year, month, week, day, ...
			duration: { type: "number", positive: true }, // 1, 3, 9.5, ...
			cycles: { type: "number" }, // number of repeats, for infinity use 0 and less
			cyclesTrial: { type: "number", optional: true }, // number of trial repeats, must be less than cycles
			status: { type: "string", min: 3 }, // inactive, active, finished, ...
			orderOriginId: { type: "string", min: 3 },
			orderItemName: { type: "string", min: 3 },
			dates: {
				type: "object", props: {
					dateStart: { type: "date" },
					dateOrderNext: { type: "date", optional: true },
					dateEnd: { type: "date", optional: true },
					dateCreated: { type: "date" },
					dateUpdated: { type: "date" },
				}
			},
			price: { type: "number" },
			data: {
				type: "object", props:
				{
					product: { type: "object" },
					order: { type: "object", optional: true },
					remoteData: { type: "object", optional: true },
					agreementId: { type: "string", optional: true },
					agreement: { type: "any", optional: true }
				}
			},
			history: {
				type: "array", optional: true, items:
				{
					type: "object", props: {
						action: { type: "string" }, // created, prolonged, stopped, paused, ...
						type: { type: "string" }, // user, automatic, ...
						date: { type: "date" },
						data: { type: "object", optional: true }
					}
				}
			}
		}
	},


	events: {
		"cache.clean.subscriptions"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
