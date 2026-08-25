"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
		/**
		 * Admin only action
		 * Batch update subscriptions
		 * 
		 * @actions
		 * 
		 * @param {Array} subscriptionIds - ids of subscriptions to update
		 * @param {Object} action - action to perform
		 * @param {String} action.name - name of action
		 * @param {String} action.value - value of action
		 * 
		 * @returns {Array} results of updates
		 */
		batch: {
			cache: false,
			auth: "required",
			params: {
				subscriptionIds: { type: "array", items: { type: "string", min: 3 } },
				action: {
					type: "object", required: true,
					properties: {
						name: { type: "string", enum: ["status"] },
						value: { type: "string", min: 3 }
					}
				}
			},
			handler(ctx) {
				if (ctx.meta.user?.type !== "admin") {
					return this.Promise.reject(new MoleculerClientError("Forbidden", 403, "", []));
				}
				if (!ctx.params.subscriptionIds || ctx.params.subscriptionIds.length === 0) {
					return this.Promise.reject(new MoleculerClientError("Subscriptions not found", 404, "", []));
				}
				if (ctx.params.action.name !== "status") {
					return this.Promise.reject(new MoleculerClientError("Invalid action", 400, "", []));
				}
				ctx.params.subscriptionIds = ctx.params.subscriptionIds.map(id => this.fixStringToId(id));
				return this.adapter.find({ query: { _id: { $in: ctx.params.subscriptionIds } } })
					.then(found => {
						if (found.length === 0) {
							return this.Promise.reject(new MoleculerClientError("Subscriptions not found", 404, "", []));
						}
						return this.processBatchSubscriptionStatusChange(
							ctx,
							found,
							ctx.params.action.value,
							ctx.params.subscriptionIds
						);
					})
					.catch(error => {
						if (error instanceof MoleculerClientError) {
							return this.Promise.reject(error);
						}
						this.logger.error("subscriptions.batch - error: ", error);
						return this.Promise.reject(new MoleculerClientError("Subscription batch error", 422, "", []));
					});
			}
		},


	}
};
