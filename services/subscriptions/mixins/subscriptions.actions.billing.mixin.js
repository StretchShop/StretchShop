"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
		calculateDates: {
			cache: false,
			params: {
				period: { type: "string" }, 
				duration: { type: "number" }, 
				dateStart: { type: "string" }, //type: "date" },
				cycles: { type: "number" },
				withDateEnd: { type: "boolean", optional: true }
			},
			handler(ctx) {
				ctx.params.withDateEnd = typeof ctx.params.withDateEnd === "undefined" ? true : ctx.params.withDateEnd;
				ctx.params.dateStart = new Date(ctx.params.dateStart);
				const dateOrderNext = this.calculateDateOrderNext(
					ctx.params.period,
					ctx.params.duration,
					ctx.params.dateStart
				);
				let dateEnd = null;
				if (ctx.params.withDateEnd) {
					console.log("calling calculateDateEnd #2", ctx.params);
					dateEnd = this.calculateDateEnd(
						ctx.params.dateStart,
						ctx.params.period,
						ctx.params.duration,
						ctx.params.cycles
					);
				}
				return {
					dateOrderNext: dateOrderNext,
					dateEnd: dateEnd
				};
			}
		},


		/**
		 * 
		 * @param {Object} subscription
		 * 
		 * @returns {Object} date of next order
		 */
		createPaidSubscriptionOrder: {
			cache: false,
			params: {
				subscription: { type: "object" } 
			},
			handler(ctx) {
				return this.createPaidSubscriptionOrder(ctx, ctx.params.subscription);
			}
		},


		subscriptionTrial: {
			cache: false,
			params: {
				subscriptionId: { type: "string" } 
			},
			handler(ctx) {
				return this.subscriptionTrial(ctx, ctx.params.subscription);
			}
		},

	}
};
