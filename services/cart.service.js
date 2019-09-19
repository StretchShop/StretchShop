"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

module.exports = {
	name: "cart",
	mixins: [
		DbService("cart"),
		CacheCleanerMixin([
			"cache.clean.cart"
		])
	],

	/**
	 * Default settings
	 */
	settings: {
		/** Public fields */
		fields: ["_id", "user", "ip", "hash", "order", "dateCreated", "dateUpdated", "items"],

		/** Validator schema for entity */
		entityValidator: {
			user: { type: "string" },
			ip: { type: "string", min: 4 },
			hash: {type: "string", min: 32 },
			order: { type: "number", positive: true },
			dateCreated: { type: "date" },
			dateUpdated: { type: "date" },
			items: { type: "array", items: { type: "object", props:
				{
					id: { type: "string", min: 2 },
					externalId: { type: "string", min: 1 },
					orderCode: { type: "string", min: 1 },
					amount: { type: "number", positive: true },
					parentId: { type: "number", positive: true },
					itemDesc: {
						type: "object", props: {
							name: { type: "string", min: 1, optional: true },
							description: { type: "string", min: 1, optional: true },
						}
					},
					properties: {
						type: "object", props: { // size, color, upgrades, serial number, ...
						}
					},
					prices: {
						type: "object", props: {
							price: { type: "number", positive: true },
							priceNoTax: { type: "number", positive: true },
							priceTotal: { type: "number", positive: true },
							priceTotalNoTax: { type: "number", positive: true },
							tax: { type: "number", positive: true },
						}
					},
					url: { type: "string", min: 2 },
				}
			}}
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
		 * Get current user cart.
		 *
		 * @actions
		 *
		 * @returns {Object} User entity
		 */
		me: {
			cache: {
				keys: ["#cookies.cart", "dateUpdated"],
				ttl: 30
			},
			handler(ctx) {
				let cartCookie = (ctx.meta && ctx.meta.cookies && ctx.meta.cookies.cart) ? ctx.meta.cookies.cart : null;
				if ( cartCookie && ctx.meta.cart ) { // we have cart in meta
					return ctx.meta.cart;
				} else { // no cart in meta, find it in datasource
					return ctx.call("cart.find", {
						"query": {
							hash: cartCookie
						}
					})
					.then(found => {
						if (found && found.constructor===Array && found[0] && found[0].constructor!==Array ) {
							// cart found in datasource, save to meta
							if ( found && found.length>0 ) {
								found = found[0];
							}
							ctx.meta.cart = found;
							return ctx.meta.cart;
						} else { // no cart found in datasource, create one
							let userId = null,
									orderId = null;
							if ( ctx.meta.user && ctx.meta.user._id ) {
								userId = ctx.meta.user._id;
							}
							if ( ctx.meta.order && ctx.meta.order._id ) {
								orderId = ctx.meta.order._id;
							}
							let entity = {
								user: userId,
								ip: ctx.meta.remoteAddress || null,
								hash: cartCookie || null,
								order: orderId,
								dateCreated: new Date(),
								dateUpdated: new Date(),
								items: null
							};
							console.log("\n\n _______2 ---- cart.new entity: ", entity);
							return this.adapter.insert(entity)
								.then(doc => this.transformDocuments(ctx, {}, doc))
								.then ( json => this.entityChanged("created", json, ctx).then(() => json));
						}
					})
					.catch(err => {
						console.log('cart err: ', err);
					});
				}

			}
		},


		/**
		 * Add item to user's cart
		 *
		 * @returns {Object} cart entity with items
		 */
		add: {
			cache: false,
			params: {
				itemId: { type: "string", min: 3 },
				amount: { type: "number", positive: true }
			},
			handler(ctx) {
				let entity = ctx.params.cart;
				// 1. check if product with that properties exists and
				// 2. if enough pieces on stock
				return ctx.call("products.findWithId", {
						"query": {
							"_id": ctx.params.itemId,
							"stockAmount": { "$gte": ctx.params.amount }
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
						return productAvailable;
					})
					.then(productAvailable => {
						return ctx.call("cart.me")
						.then(cart => {
								if (cart && cart.length>0) {
									cart = cart[0];
								}

								// 2. check if it's already in cart
								let isInCart = -1;
								if ( cart.items ) {
									for (var i=0; i<cart.items.length; i++) {
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
									let newAmount = cart.items[isInCart].amount + ctx.params.amount;
									if ( newAmount>productAvailable.stockAmount ) {
										newAmount = productAvailable.stockAmount;
									}
									cart.items[isInCart].amount = newAmount;
								} else { // not in cart
									if ( typeof productAvailable === "object" && typeof productAvailable !== "Array" ) {
										productAvailable.amount = ctx.params.amount;
										cart.items.push(productAvailable);
									} else {
										cart.items = null;
									}
								}
								// TODO - update stockAmount of product
								cart.dateUpdated = new Date();

								// 3. add to cart and write to datasource
								ctx.meta.cart = cart
								return this.adapter.updateById(ctx.meta.cart._id, this.prepareForUpdate(cart))
								.then(doc => this.transformDocuments(ctx, {}, doc))
								.then(json => this.entityChanged("updated", json, ctx).then(() => json));
								//return ctx.meta.cart;
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
				let entity = ctx.params.cart;
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
								for (var i=0; i<cart.items.length; i++) {
										if (cart.items[i]._id == ctx.params.itemId) {
											productInCart = i;
											break;
										}
								}
								// if found, remove one product from cart
								if (productInCart>-1) {
									if ( ctx.params.amount && ctx.params.amount>0 ) {
										// remove amount from existing value
										cart.items[i].amount = cart.items[i].amount - ctx.params.amount;
										if (cart.items[i].amount<=0) {
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
							ctx.meta.cart = cart
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
				ctx.params.itemId = (typeof ctx.params.itemId !== 'undefined') ?  ctx.params.itemId : null;
				ctx.params.amount = (typeof ctx.params.amount !== 'undefined') ?  ctx.params.amount : 1;
				let entity = ctx.params.cart;
				// get cart
				return ctx.call("cart.me")
					.then(cart => {
						if (cart && cart.length>0) {
							cart = cart[0];
						}
						console.log('updateCartItemAmount.cart: ', cart);
						// check if there are any items inside
						if ( cart.items && cart.items.length>0 ) {
							if ( ctx.params.itemId ) {
								// find product in cart
								let productInCart = -1;
								for (var i=0; i<cart.items.length; i++) {
										if (cart.items[i]._id == ctx.params.itemId) {
											productInCart = i;
											break;
										}
								}
								// if found, remove one product from cart
								if (productInCart>-1) {
									if ( ctx.params.amount && ctx.params.amount>0 ) {
										// remove amount from existing value
										cart.items[i].amount = ctx.params.amount;
										if (cart.items[i].amount<=0) {
											// if new amount less or equal to 0, remove whole product
											cart.items.splice(productInCart, 1);
										}
									}
								}
							}
							cart.dateUpdated = new Date();
							// update cart in variable and datasource
							ctx.meta.cart = cart
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
							for (var property in ctx.params.cartNew) {
								if (cart.hasOwnProperty(property) && ctx.params.cartNew.hasOwnProperty(property)) {
									cart[property] = ctx.params.cartNew[property];
								}
							}
						}

						cart.dateUpdated = new Date();
						// update cart in variable and datasource
						ctx.meta.cart = cart
						console.log('cart.updateCart newCart: ', cart);
						return this.adapter.updateById(ctx.meta.cart._id, this.prepareForUpdate(cart))
						.then(doc => this.transformDocuments(ctx, {}, doc))
						.then(json => this.entityChanged("updated", json, ctx).then(() => json));
					});
			}
		}

	},



	/**
	 * Methods
	 */
	methods: {
		// sort object's params in alphabetical order
		sortObject(o) {
	  	var sorted = {},
	  	key, a = [];

	  	// get object's keys into array
	  	for (key in o) {
	  		if (o.hasOwnProperty(key)) {
	  			a.push(key);
	  		}
	  	}

	  	// sort array of acquired keys
	  	a.sort();

	  	// fill array keys with related values
	  	for (key = 0; key < a.length; key++) {
	  		if (typeof o[a[key]] === "object") {
	  			// if object, sort its keys recursively
	  		  sorted[a[key]] = sortObject( o[a[key]] );
	  		} else {
	  			// assign value to key
	  		  sorted[a[key]] = o[a[key]];
	  		}
	  	}

	  	// return sorted result
	  	return sorted;
	  },


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
