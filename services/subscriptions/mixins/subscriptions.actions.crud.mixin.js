"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
		import: {
			auth: "required",
			params: {
				subscriptions: { type: "array", items: "object", optional: true },
			},
			// cache: {
			// 	keys: ["#subscriptionID"]
			// },
			handler(ctx) {
				this.logger.info("subscriptions.import - ctx.meta");
				let subscriptions = ctx.params.subscriptions;
				let promises = [];

				if (ctx.meta.user.type=="admin") {
					if ( subscriptions && subscriptions.length>0 ) {
						// loop products to import
						subscriptions.forEach(function(entity) {
							promises.push(
								// add subscription results into result variable
								ctx.call("subscriptions.save", {entity})
								.catch(err => {
									this.logger.error("subscriptions.import subscriptions.save error:", err);
									return this.Promise.reject(new MoleculerClientError("Subscriptions import saveS error", 422, "", []));
								})
							); // push with find end
						});
					}

					// return multiple promises results
					return Promise.all(promises)
						.then(prom => {
							return prom;
						})
						.catch(err => {
							this.logger.error("subscriptions.import all error:", err);
							return this.Promise.reject(new MoleculerClientError("Subscriptions import all error", 422, "", []));
						});
				} else { // not admin user
					return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
				}	
			}
		},


		/**
		 * Save subscription:
		 *  - if no ID, create new;
		 *  - if has ID, update;
		 * 
		 * @actions
		 * 
		 * @param {Object} entity - entity to save, must contain ".id" parameter for identification
		 *
		 * @returns {Object} subscription entity with items
		 */
		save: {
			cache: false,
			params: {
				entity: { type: "object" } // su
			},
			handler(ctx) {
				let self = this;
				let entity = ctx.params.entity;

				return this.adapter.findById(entity.id)
					.then(found => {
						if (found) { // entity found, update it
							if ( entity ) {
								if ( entity.dates ) {
									// convert strings to Dates
									Object.keys(entity.dates).forEach(function(key) {
										let date = entity.dates[key];
										if ( date && date!=null && !(date instanceof Date) && 
										date.toString().trim()!="" ) {
											entity.dates[key] = new Date(entity.dates[key]);
										}
									});
								}
							}

							return self.validateEntity(entity)
								.then(() => {
									if (!entity.dates) {
										entity.dates = {};
									}
									entity.dates.dateUpdated = new Date();
									entity.dates.dateSynced = new Date();
									self.logger.info("subscription.save found - update entity:", entity);
									let entityId = entity.id;
									delete entity.id;
									delete entity._id;
									const update = {
										"$set": self.sanitizeForMongoUpdate(entity)
									};

									return self.adapter.updateById(entityId, update)
										.then(doc => self.transformDocuments(ctx, {}, doc))
										.then(json => self.entityChanged("updated", json, ctx)
										.then(() => json))
										.catch(err => {
											self.logger.error("subscriptions.save update error: ", err);
											return this.Promise.reject(new MoleculerClientError("Subscriptions save update error", 422, "", []));
										});
								})
								.catch(error => {
									self.logger.error("subscriptions.save update validation error: ", error);
									return this.Promise.reject(new MoleculerClientError("Subscriptions save update validation error", 422, "", []));
								});
						} else { // no product found, create one
							return self.validateEntity(entity)
								.then(() => {
									// check if user doesn't have same subscription in that time
									return ctx.call("subscriptions.find", {
										"query": {
											userId: entity.userId,
											orderItemName: entity.orderItemName,
											status: "active"
										}
									})
										.then(entityFound => {
											if (entityFound && entityFound.constructor === Array && 
											entityFound.length>0) {
												self.logger.warn("subscriptions.save - insert - found similar entity:", entityFound);
											}
											if (!entity.dates) {
												entity.dates = {};
											}
											// convert strings to Dates
											Object.keys(entity.dates).forEach(function(key) {
												let date = entity.dates[key];
												if ( date && date!=null && !(date instanceof Date) && 
												date.toString().trim()!="" ) {
													entity.dates[key] = new Date(entity.dates[key]);
												}
											});
											self.logger.info("subscriptions.save - insert entity:", entity);

											return self.adapter.insert(self.sanitizeForMongoUpdate(entity))
												.then(doc => self.transformDocuments(ctx, {}, doc))
												.then(json => self.entityChanged("created", json, ctx)
												.then(() => json))
												.catch(err => {
													self.logger.error("subscriptions.save insert error: ", err);
													return this.Promise.reject(new MoleculerClientError("Subscriptions save insert error", 422, "", []));
												});
										})
										.catch(err => {
											self.logger.error("subscriptions.save insert find error: ", err);
											return this.Promise.reject(new MoleculerClientError("Subscriptions save insert find error", 422, "", []));
										});
								})
								.catch(err => {
									self.logger.error("subscriptions.save insert validation error: ", err);
									return this.Promise.reject(new MoleculerClientError("Subscriptions save insert validation error", 422, "", []));
								});
						} // else end
					})
					.catch(err => {
						self.logger.error("subscriptions.save findById error: ", err);
						return this.Promise.reject(new MoleculerClientError("Subscriptions save findI error", 422, "", []));
					});
			}
		},


		/**
		 * update subscription
		 * 
		 * @actions
		 * 
		 * @param {Object} updateObject - subscription entity to update, with data to update, must contain ".id" parameter for identification
		 *
		 * @returns {Object} updated subscription entity
		 */
		update: {
			cache: false,
			params: {
				updateObject: { type: "object" },
				historyRecordToAdd: { type: "object", optional: true },
				id: { type: "any", optional: true }
			},
			handler(ctx) {
				let self = this;

				return this.adapter.findById(ctx.params.updateObject.id)
					.then(found => {
						if (found) {
							let original = {...found};
							original.data = structuredClone(original.data);
							delete original._id;
							let updatedOriginal = self.updateObject(original, ctx.params.updateObject);
							
							// add history record if set
							if (ctx.params.historyRecordToAdd) {
								updatedOriginal.history.push(
									structuredClone(ctx.params.historyRecordToAdd)
								);
							}

							return ctx.call("subscriptions.save", {
								entity: updatedOriginal
							})
								.then(updated => {
									this.logger.info("subscriptions.save updated:", updated);
									return updated;
								})
								.catch(error => {
									this.logger.error("subscriptions.save update error: ", error);
									return null;
								});
						}
					})
					.catch(err => {
						self.logger.error("subscriptions.save update validation error: ", err);
						return null;
					});

			}
		},


		/**
		 * SUBSCRIPTION FLOW - 1.1 (FE->BE)
		 * Suspend (pause) active subscription
		 * 
		 * @actions
		 * 
		 * @param {String} subscriptionId - id of subscription to suspend
		 *
		 * @returns {Object} result with subscription
		 */
	}
};
