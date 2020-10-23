"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("moleculer-cron");

const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

module.exports = {
	name: "subscriptions",
	mixins: [
		DbService("subscriptions"),
		CacheCleanerMixin([
			"cache.clean.subscriptions"
		]),
		Cron
	],

	crons: [{
		name: "SubscriptionsCleaner",
		cronTime: "0 1 * * *",
		onTick: function() {

			this.logger.info("Starting to Clean up the Carts");

			this.getLocalService("cart")
				.actions.cleanCarts()
				.then((data) => {
					this.logger.info("Carts Cleaned up", data);
				});
		}
	}],

	/**
	 * Default settings
	 */
	settings: {
		/** Public fields */
		fields: ["_id", "userId", "ip", "type", "period", "duration", "orderId", "dates", "price", "data", "history"],

		/** Validator schema for entity */
		entityValidator: {
			userId: { type: "string", min: 3 },
			ip: { type: "string", min: 4 },
			type: {type: "string", min: 3 }, // autorefresh, singletime, ...
			period: {type: "string", min: 3 }, // year, month, week, day, ...
			duration: {type: "number", positive: true }, // 1, 3, 9.5, ...
			orderId: { type: "string", min: 3 },
			dates: { type: "object", props: {
				dateStart: { type: "date" },
				dateEnd: { type: "date" },
				dateCreated: { type: "date" },
				dateUpdated: { type: "date" },
			}},
			price: { type: "number" },
			data: { type: "object", props:
				{
					product: { type: "object" }
				}
			},
			history: { type: "array", optional: true, items:
				{ type: "object", props: {
					action: { type: "string" }, // created, prolonged, stopped, paused
					type: { type: "string" }, // user, automatic, ...
					date: { type: "date" },
					data: { type: "object", optional: true }
				} }
			},
		}
	},


	/**
	 * Actions
	 */
	actions: {

		/**
		 * disable cache for find action
		 */
		find: {
			cache: false
		},

		/**
		 * Get currently active user's subscriptions
		 *
		 * @actions
		 *
		 * @returns {Object} User entity
		 */
		me: {
			cache: {
				keys: ["dates.dateUpdated"],
				ttl: 30
			},
			handler(ctx) {
				if ( ctx.meta.user && ctx.meta.user._id ) {
					return ctx.call("cart.find", {
						"query": {
							userId: ctx.meta.user._id
						}
					})
						.then(found => {
							if (found && found.constructor===Array ) {
								return this.transformDocuments(ctx, {}, found);
							} else {
								return this.Promise.reject(new MoleculerClientError("Subscriptions not found!", 400));
							}
						})
						.then(subscriptions => {
							return this.transformEntity(subscriptions, true, ctx);
						})
						.catch((error) => {
							this.logger.error("subscriptions.me error", error);
							return null;
						});
				}

			}
		},


		/**
		 * Save subscription:
		 *  - if no ID, create new;
		 *  - if has ID, update;
		 *
		 * @returns {Object} subscription entity with items
		 */
		save: {
			cache: false,
			params: {
				itemId: { type: "string", min: 3 },
				amount: { type: "number", positive: true },
				requirements: { type: "array", optional: true }
			},
			handler(ctx) {
				// 1. check if product with that properties exists and
				// 2. if enough pieces on stock
				return ctx.call("products.findWithId", {
					"query": {
						"_id": ctx.params.itemId
					}
				})
					.then(productAvailable => {
						if (productAvailable && productAvailable.length>0) {
							productAvailable = productAvailable[0];
							productAvailable._id = productAvailable._id.toString();
						}
						if (!productAvailable || (productAvailable.length===0 && productAvailable[0])) {
							return this.Promise.reject(new MoleculerClientError("No matching product found"));
						}
						// check if amount is available
						if (ctx.params.amount > productAvailable.stockAmount) {
							// if digital or subscription - only 1 pcs can be ordered, 
							// but only if stockAmount is set (more than -1) 
							if (productAvailable.subtype=="subscription" || productAvailable.subtype=="digital") {
								ctx.params.amount = 1;
								if (productAvailable.stockAmount>-1) {
									return this.Promise.reject(new MoleculerClientError("Requested amount is not available"));
								}
							} else { // physical products
								return this.Promise.reject(new MoleculerClientError("Requested amount is not available"));
							}
						}
						return productAvailable;
					})
					.then(productAvailable => {
						// if requirements available, add them
						if (ctx.params.requirements && ctx.params.requirements.length>0 && 
							productAvailable && productAvailable.data && productAvailable.data.requirements &&
							productAvailable.data.requirements.inputs) {
							// loop requirements' input & params to fill in value
							productAvailable.data.requirements.inputs.some((input, key) => {
								ctx.params.requirements.some((paramReq) => {
									if (input.codename && paramReq.codename && paramReq.value && 
										input.codename == paramReq.codename) {
										// codename match, set value of requirement
										productAvailable.data.requirements.inputs[key]["value"] = paramReq.value;
										return true;
									}
								});
							});
						}

						return ctx.call("cart.me")
							.then(cart => {
								if (cart && cart.length>0) {
									cart = cart[0];
								}

								// 2. check if it's already in cart
								let isInCart = -1;
								if ( cart.items ) {
									for (let i=0; i<cart.items.length; i++) {
										if (cart.items[i]._id == productAvailable._id) {
											isInCart = i;
											break;
										}
									}
								} else {
									cart.items = [];
								}
								// TODO - check if it's in cart with specific data of product (color, size, ...) if any

								// perform action according to
								if ( isInCart>-1 ) { // is in cart, update quantity, note the max
									if (cart.items[isInCart].subtype=="subscription" || cart.items[isInCart].subtype=="digital") {
										cart.items[isInCart].amount = 1;
									} else {
										let newAmount = cart.items[isInCart].amount + ctx.params.amount;
										if ( newAmount>productAvailable.stockAmount ) {
											newAmount = productAvailable.stockAmount;
										}
										cart.items[isInCart].amount = newAmount;
									}
								} else { // not in cart
									if ( typeof productAvailable === "object" && productAvailable.constructor !== Array ) {
										productAvailable.amount = ctx.params.amount;
										cart.items.push(productAvailable);
									} else {
										cart.items = null;
									}
								}

								cart.dateUpdated = new Date();

								// 3. add to cart and write to datasource
								ctx.meta.cart = cart;
								return this.adapter.updateById(ctx.meta.cart._id, this.prepareForUpdate(cart))
									.then(doc => this.transformDocuments(ctx, {}, doc))
									.then(json => this.entityChanged("updated", json, ctx).then(() => json));
							});
					});
			}
		},

		/**
		 * Delete item(s) from user's cart
		 *
		 * @returns {Object} cart entity with items
		 */
		delete: {
			cache: false,
			params: {
				itemId: { type: "string", min: 3, optional: true },
				amount: { type: "number", positive: true, optional: true }
			},
			handler(ctx) {
				// get cart
				return ctx.call("cart.me")
					.then(cart => {
						if (cart && cart.length>0) {
							cart = cart[0];
						}
						// check if there are any items inside
						if ( cart.items.length>0 ) {
							if ( ctx.params.itemId ) {
								// find product in cart
								let productInCart = -1;
								for (let i=0; i<cart.items.length; i++) {
									if (cart.items[i]._id == ctx.params.itemId) {
										productInCart = i;
										break;
									}
								}
								// if found, remove one product from cart
								if (productInCart>-1) {
									if ( ctx.params.amount && ctx.params.amount>0 ) {
										// remove amount from existing value
										cart.items[productInCart].amount = cart.items[productInCart].amount - ctx.params.amount;
										if (cart.items[productInCart].amount<=0) {
											// if new amount less or equal to 0, remove whole product
											cart.items.splice(productInCart, 1);
										}
									} else {
										// remove whole product from cart
										cart.items.splice(productInCart, 1);
									}
								}
							} else {
								// no ID, remove all items from cart
								cart.items = [];
							}
							cart.dateUpdated = new Date();

							// update cart in variable and datasource
							ctx.meta.cart = cart;
							return this.adapter.updateById(ctx.meta.cart._id, this.prepareForUpdate(cart))
								.then(doc => this.transformDocuments(ctx, {}, doc))
								.then(json => this.entityChanged("removed", json, ctx).then(() => json));
						}
					});
			}
		},


		updateCartItemAmount: {
			cache: false,
			params: {
				itemId: { type: "string", min: 3, optional: true },
				amount: { type: "number", positive: true, optional: true }
			},
			handler(ctx) {
				ctx.params.itemId = (typeof ctx.params.itemId !== "undefined") ?  ctx.params.itemId : null;
				ctx.params.amount = (typeof ctx.params.amount !== "undefined") ?  ctx.params.amount : 1;
				// get cart
				return ctx.call("cart.me")
					.then(cart => {
						if (cart && cart.length>0) {
							cart = cart[0];
						}
						// check if there are any items inside
						if ( cart.items && cart.items.length>0 ) {
							if ( ctx.params.itemId ) {
								// find product in cart
								let productInCart = -1;
								for (let i=0; i<cart.items.length; i++) {
									if (cart.items[i]._id == ctx.params.itemId) {
										productInCart = i;
										break;
									}
								}
								// if found, remove one product from cart
								if (productInCart>-1) {
									if ( ctx.params.amount && ctx.params.amount>0 ) {
										// remove amount from existing value
										cart.items[productInCart].amount = ctx.params.amount;
										if (cart.items[productInCart].amount<=0) {
											// if new amount less or equal to 0, remove whole product
											cart.items.splice(productInCart, 1);
										}
										// if product contains requirements, remove amount
										if (cart.items[productInCart].requirements && cart.items[productInCart].requirements.length>0) {
											cart.items[productInCart].amount = 1;
										}
									}
								}
							}
							cart.dateUpdated = new Date();
							// update cart in variable and datasource
							ctx.meta.cart = cart;
							return this.adapter.updateById(ctx.meta.cart._id, this.prepareForUpdate(cart))
								.then(doc => this.transformDocuments(ctx, {}, doc))
								.then(json => this.entityChanged("updated", json, ctx).then(() => json));
						}
					});
			}
		},


		updateMyCart: {
			cache: false,
			params: {
				cartNew: { type: "object" }
			},
			handler(ctx) {
				// get user's cart
				return ctx.call("cart.me")
					.then(cart => {
						if (cart && cart.length>0) {
							cart = cart[0];
						}

						// update old cart according to new one, if property set, otherwise keep old
						if ( ctx.params.cartNew ) {
							for ( let property in ctx.params.cartNew ) {
								if ( Object.prototype.hasOwnProperty.call(cart,property) && Object.prototype.hasOwnProperty.call(ctx.params.cartNew,property) ) {
									cart[property] = ctx.params.cartNew[property];
								}
							}
						}

						cart.dateUpdated = new Date();
						// update cart in variable and datasource
						ctx.meta.cart = cart;
						this.logger.info("cart.updateMyCart - newCart: ", cart);
						return this.adapter.updateById(ctx.meta.cart._id, this.prepareForUpdate(cart))
							.then(doc => this.transformDocuments(ctx, {}, doc))
							.then(json => this.entityChanged("updated", json, ctx).then(() => json));
					});
			}
		}, 


		cleanCarts: {
			cache: false,
			handler(ctx) {
				let promises = [];
				const d = new Date();
				d.setMonth(d.getMonth() - 1);
				return this.adapter.find({
					query: {
						dateUpdated: { "$lt": d }
					}
				})
					.then(found => {
						found.forEach(cart => {
							promises.push( 
								ctx.call("cart.remove", {id: cart._id} )
									.then(removed => {
										return "Removed carts: " +JSON.stringify(removed);
									})
							);
						});
						// return all delete results
						return Promise.all(promises).then((result) => {
							return result;
						});
					});
			}
		}

	},



	/**
	 * Methods
	 */
	methods: {
		prepareForUpdate(object) {
			let objectToSave = JSON.parse(JSON.stringify(object));
			if ( typeof objectToSave._id !== "undefined" && objectToSave._id ) {
				delete objectToSave._id;
			}
			return { "$set": objectToSave };
		}
	},

	events: {
		"cache.clean.cart"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
