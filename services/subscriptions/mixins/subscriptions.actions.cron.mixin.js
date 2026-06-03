"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
		checkSubscriptions: {
			cache: false,
			handler(ctx) {
				let promises = [];

				promises.push(
					this.stopEndedActiveSubscriptions(ctx)
				);
				promises.push(
					this.firstPaymentAfterTrial(ctx)
				);

				return Promise.all(promises)
					.then((values) => {
						let results = {};
						if (values) {
							values.forEach(v => {
								if (v && v !== null && typeof v === "object") {
									Object.keys(v).forEach(k => {
										results[k] = v[k];
									});
								}
							});
						}
						return results;
					})
					.catch(err => {
						console.error('subscription.checkSubscriptions error: ', err);
						return this.Promise.reject(new MoleculerClientError("Check Subscriptions", 422, "", []));
					});

			}
		},


		/**
		 * CRON action (see crons.cronTime setting for time to process):
		 *  1. find all subscriptions that end in next 15 minutes
		 * ??? TODO
		 *  2. check if:
		 *     2.1. all payments in subscription have been received
		 *     2.2. stripe paid subscriptions were suspended 
		 *  3. if not, make them inactive
		 * 
		 * to debug you can use - mol $ call subscriptions.checkSubscriptions
		 * 
		 * @actions
		 */
		stopEndingSubscriptions: {
			cache: false,
			handler(ctx) {
				let promises = [];
				
				console.log("subscriptions.checkEndingSubscriptions");

				promises.push(
					this.stopEndedActiveSubscriptions(ctx)
				);

				return Promise.all(promises)
					.then((values) => {
						let results = {};
						if (values) {
							values.forEach(v => {
								if (v && v !== null && typeof v === "object") {
									Object.keys(v).forEach(k => {
										results[k] = v[k];
									});
								}
							});
						}
						return results;
					})
					.catch(err => {
						console.error('subscription.checkEndingSubscriptions error: ', err);
						return this.Promise.reject(new MoleculerClientError("Check Ending Subscriptions", 422, "", []));
					});

			}
		},


		/**
		 * Import subscriptions data:
		 *
		 * @actions
		 * 
		 * @param {Array} - array of subscription to import
		 *
		 * @returns {Object} Category entity
		 */
	}
};
