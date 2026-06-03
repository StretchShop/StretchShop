"use strict";



module.exports = {
	methods: {
		prepareForUpdate(object) {
			let objectToSave = { ...object}; //JSON.parse(JSON.stringify(object));
			if ( typeof objectToSave._id !== "undefined" && objectToSave._id ) {
				delete objectToSave._id;
			}
			return { "$set": objectToSave };
		},


		/**
		 * 
		 * @param {Object} order 
		 * 
		 * @returns Object
		 */
		prepareOrderForSubscription(order, item) {
			item = (typeof item !== "undefined") ? item : null;
			let subscriptionOrder = Object.assign({}, order);
			// remove unwanted attributes
			delete subscriptionOrder._id;
			subscriptionOrder.externalId = null;
			subscriptionOrder.externalCode = null;

			subscriptionOrder.dates.datePaid = null;
			subscriptionOrder.dates.emailSent = null;

			subscriptionOrder.status = "cart";

			delete subscriptionOrder.data.paymentData.paymentRequestId;
			delete subscriptionOrder.data.paymentData.supplier;
			delete subscriptionOrder.data.paymentData.lastStatus;
			delete subscriptionOrder.data.paymentData.lastDate;
			delete subscriptionOrder.data.paymentData.paidAmountTotal;
			subscriptionOrder.data.paymentData.lastResponseResult = [];
			delete subscriptionOrder.invoice;
			
			subscriptionOrder.prices.priceTotal = 0;
			subscriptionOrder.prices.priceTotalNoTax = 0;
			subscriptionOrder.prices.priceItems = 0;
			subscriptionOrder.prices.priceItemsNoTax = 0;
			subscriptionOrder.prices.priceTaxTotal = 0;
			subscriptionOrder.prices.priceDelivery = 0;
			subscriptionOrder.prices.pricePayment = 0;

			if ( !subscriptionOrder.data.subscription ) {
				subscriptionOrder.data.subscription = {
					created: new Date(),
					ids: []
				};
			}
			
			// define items
			subscriptionOrder.items = [];
			if (item && item!=null) {
				// add the item
				subscriptionOrder.items.push(item);
				// subscriptionOrder.items[0].id = subscriptionOrder.items[0]._id;
				// delete subscriptionOrder.items[0]._id;
				// count the prices
			}
			// do NOT set the dates
			return subscriptionOrder;
		},

		
		/**
		 * 
		 * @param {Object} order 
		 * 
		 * @returns Array - subscriptions in order
		 */
		getOrderSubscriptions(order) {
			let subscriptions = [];

			if (order.items && order.items.length>0) {
				order.items.forEach(item => {
					if (item.type === "subscription") {
						subscriptions.push(item);
					}
				});
			}

			return subscriptions;
		},


		/**
		 * Create template for subscription 
		 * with properties, that it should have
		 * NOTE: you may have problem to insert properties that 
		 * are not in this object and settings.fields && settings.entityValidator
		 * 
		 * @returns {Object} - empty subscription object
		 */
		createEmptySubscription() {
			const nextYear = new Date();
			nextYear.setFullYear( nextYear.getFullYear() + 1);

			return {
				userId: null,
				ip: null,
				type: "autorefresh", // autorefresh, singletime, ...
				period: "month", // year, month, week, day, ...
				duration: 1, // 1, 3, 9.5, ...
				cycles: 0,
				status: "inactive", // active, inactive, ...
				orderOriginId: null,
				orderItemName: null,
				dates: {
					dateStart: new Date(),
					dateOrderNext: null,
					dateEnd: nextYear,
					dateCreated: new Date(),
					dateUpdated: new Date(),
				},
				price: null,
				data: { // create here if you want to have it after helpers.mixin.js updateObject()
					product: null,
					order: null,
					agreement: null
				},
				history: [],
			};
		},


		/**
		 * Calculate when subscriptions ends
		 * For infinity (durationMax==0) it calculates date to nex
		 * 
		 * @param {Date} dateStart 
		 * @param {String} period 
		 * @param {Number} duration 
		 * @param {Number} durationMax 
		 */
		calculateDateEnd(dateStart, period, duration, durationMax) {
			console.log("calculateDateEnd: ", dateStart, period, duration, durationMax);
			let dateEnd = new Date(dateStart.getTime());
			const maxDuration = 1000; // eternity does not exist and it prevents infinite loops
			if (!durationMax || durationMax<=0 || durationMax>maxDuration) {
				dateEnd.setFullYear(dateEnd.getFullYear() + maxDuration);
			} else {
				for (let i=0; i<durationMax; i++) {
					dateEnd = this.calculateDateOrderNext(period, duration, dateEnd);
				}
			}
			return dateEnd;
		},


		/**
		 * 
		 * @param {String} period 
		 * @param {Number} duration 
		 * @param {Date} dateStart
		 * 
		 * @returns {Date} 
		 */
		calculateDateOrderNext(period, duration, dateStart) {
			this.logger.info("subscriptions.calculateDateOrderNext() - period, duration, datestart", period, duration, dateStart);
		
			let dateOrderNext = dateStart || new Date();
			switch (period) {
			case "day":
				dateOrderNext = this.addDays(dateOrderNext, duration); // add a day(s)
				break;
			case "week": 
				dateOrderNext = this.addDays(dateOrderNext, duration * 7); // add a week(s)
				return;
			case "month":
				dateOrderNext = this.addMonths(dateOrderNext, duration); // add month(s)
				break;
			default: // year
				dateOrderNext.setFullYear(dateOrderNext.getFullYear() + duration); // add years
				break;
			}
			this.logger.info("subscriptions.calculateDateOrderNext() - dateOrderNext", dateOrderNext);

			return dateOrderNext;
		},


		/**
		 * Helper to create history record
		 * 
		 * @param {String} action // created, prolonged, stopped, paused, ...
		 * @param {String} type // user, automatic, ...
		 * @param {Object} data 
		 */
		newHistoryRecord(action, type, data) {
			action = action ? action : "created";
			type = type ? type : "user";
			let result = {
				action,
				type,
				date: new Date()
			};
			if (data) {
				result.data = JSON.parse(JSON.stringify(data));
			}
			return result;
		},


		addToHistory(ctx, subscriptionId, historyRecord) {
			return ctx.call("subscriptions.update", 
				{
					updateObject: { id: subscriptionId },
					historyRecordToAdd: historyRecord 
				})
				.then(updated => {
					return updated;
				})
				.catch(error => {
					this.logger.error("subscriptions.addToHistory() - error: ", JSON.stringify(error));
					return null;
				});
		},


		/**
		 * create order of paid subscription
		 * 
		 * @param {Object} ctx 
		 * @param {Object} subscription 
		 * 
		 * @returns {Object}
		 */
	}
};
