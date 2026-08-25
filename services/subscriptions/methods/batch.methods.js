"use strict";

const DISTINCT_SUBSCRIPTION_FIELDS = ["status"];
const DISTINCT_VALUES_CACHE_KEY = "subscriptions.distinctValues";
const DISTINCT_VALUES_CACHE_TTL = 60;

module.exports = {
	methods: {
		normalizeBatchSubscriptionStatus(status) {
			if (status === "cancelled") {
				return "canceled";
			}
			if (status === "reactivate" || status === "reactivated") {
				return "active";
			}
			if (status === "suspend") {
				return "canceled";
			}
			if (status === "pause") {
				return "paused";
			}
			return status;
		},


		getDedicatedSubscriptionStatusAction(status) {
			const suspendStatuses = ["canceled", "stopped"];
			if (suspendStatuses.includes(status)) {
				return "subscriptions.suspend";
			}
			if (status === "paused") {
				return "subscriptions.pause";
			}
			if (status === "active") {
				return "subscriptions.reactivate";
			}
			return null;
		},


		summarizeDedicatedSubscriptionResult(subscriptionId, result) {
			return {
				subscriptionId,
				success: result?.success !== false,
				result
			};
		},


		/**
		 * Run a single-subscription status action for each item.
		 * Stripe suspend/reactivate run sequentially.
		 *
		 * @param {Object} ctx
		 * @param {Array} subscriptions
		 * @param {String} actionName
		 * @returns {Promise<Array>}
		 */
		runDedicatedSubscriptionStatusActions(ctx, subscriptions, actionName) {
			const altUser = ctx.meta?.user?.type || "admin";
			const runOne = (subscription) => {
				const subscriptionId = this.idToString(subscription._id);
				return ctx.call(actionName, {
					subscriptionId,
					altUser,
					altMessage: "batch"
				})
					.then(result => this.summarizeDedicatedSubscriptionResult(subscriptionId, result))
					.catch(error => {
						this.logger.error(
							"subscriptions.runDedicatedSubscriptionStatusActions() - error:",
							actionName,
							subscriptionId,
							error
						);
						return {
							subscriptionId,
							success: false,
							message: error?.message || "error"
						};
					});
			};

			return subscriptions.reduce((chain, subscription) => {
				return chain.then(results => {
					return runOne(subscription).then(item => {
						results.push(item);
						return results;
					});
				});
			}, Promise.resolve([]));
		},


		notifySubscriptionsUpdated(ctx, subscriptions) {
			return Promise.all(subscriptions.map(subscription => {
				return this.adapter.findById(subscription._id)
					.then(doc => this.transformDocuments(ctx, {}, doc))
					.then(json => {
						return this.entityChanged("updated", json, ctx)
							.then(() => ({
								subscriptionId: this.idToString(json._id || json.id),
								success: true,
								subscription: json
							}));
					})
					.catch(error => {
						this.logger.error("subscriptions.notifySubscriptionsUpdated() - error:", subscription._id, error);
						return {
							subscriptionId: this.idToString(subscription._id),
							success: false,
							message: error?.message || "error"
						};
					});
			}));
		},


		/**
		 * Apply a batch status change: reuse suspend / pause / reactivate endpoints
		 * (Stripe billing, emails, content dependencies), otherwise
		 * update status and notify entityChanged.
		 *
		 * @param {Object} ctx
		 * @param {Array} subscriptions
		 * @param {String} status
		 * @param {Array} subscriptionIds
		 * @returns {Promise<Array>}
		 */
		processBatchSubscriptionStatusChange(ctx, subscriptions, status, subscriptionIds) {
			const normalized = this.normalizeBatchSubscriptionStatus(status);
			const dedicatedAction = this.getDedicatedSubscriptionStatusAction(normalized);
			if (dedicatedAction) {
				return this.runDedicatedSubscriptionStatusActions(ctx, subscriptions, dedicatedAction);
			}

			const now = new Date();
			const update = {
				"$set": {
					status: normalized,
					"dates.dateUpdated": now
				},
				"$push": {
					history: this.newHistoryRecord(normalized, ctx.meta?.user?.type || "admin", {
						relatedOrder: null,
						message: "batch"
					})
				}
			};
			this.logger.info("subscriptions.processBatchSubscriptionStatusChange() - update:", {
				_id: { $in: subscriptionIds }
			}, update);
			return this.adapter.updateMany({ _id: { $in: subscriptionIds } }, update)
				.then(() => this.notifySubscriptionsUpdated(ctx, subscriptions));
		},


		normalizeDistinctSubscriptionValues(values) {
			if (!Array.isArray(values)) {
				return [];
			}
			return [...new Set(
				values
					.filter(value => value != null && value !== "")
					.map(value => typeof value === "string" ? value : String(value))
			)].sort((a, b) => a.localeCompare(b));
		},


		loadDistinctSubscriptionField(field) {
			const collection = this.adapter?.collection;
			if (collection && typeof collection.distinct === "function") {
				return Promise.resolve()
					.then(() => collection.distinct(field))
					.then(values => this.normalizeDistinctSubscriptionValues(values));
			}
			return Promise.resolve([]);
		},


		loadDistinctSubscriptionValues() {
			return Promise.all(
				DISTINCT_SUBSCRIPTION_FIELDS.map(field => {
					return this.loadDistinctSubscriptionField(field)
						.then(values => [field, values]);
				})
			).then(pairs => Object.fromEntries(pairs));
		},


		/**
		 * Distinct filter values across all subscriptions.
		 * Cached under subscriptions.distinctValues (cleaned with cache.clean.subscriptions).
		 *
		 * @returns {Promise<Object>}
		 */
		getDistinctSubscriptionValues() {
			const empty = {
				status: [],
				type: [],
				period: [],
				orderItemName: []
			};
			const load = () => {
				return this.loadDistinctSubscriptionValues()
					.catch(error => {
						this.logger.error("subscriptions.getDistinctSubscriptionValues() - load error:", error);
						return empty;
					});
			};
			const cacher = this.broker?.cacher;
			if (!cacher || typeof cacher.get !== "function") {
				return load();
			}
			return Promise.resolve(cacher.get(DISTINCT_VALUES_CACHE_KEY))
				.then(cached => {
					if (cached) {
						return cached;
					}
					return load().then(values => {
						if (typeof cacher.set !== "function") {
							return values;
						}
						return Promise.resolve(cacher.set(
							DISTINCT_VALUES_CACHE_KEY,
							values,
							DISTINCT_VALUES_CACHE_TTL
						))
							.then(() => values)
							.catch(error => {
								this.logger.error("subscriptions.getDistinctSubscriptionValues() - cache set error:", error);
								return values;
							});
					});
				})
				.catch(error => {
					this.logger.error("subscriptions.getDistinctSubscriptionValues() - cache get error:", error);
					return load();
				});
		},
	}
};
