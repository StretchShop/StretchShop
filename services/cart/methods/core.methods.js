"use strict";

module.exports = {

	/**
	 * Methods
	 */
	methods: {

		/**
		 * Creates new cart record
		 * 
		 * @param {Object} ctx 
		 * @param {Object} cartCookie 
		 * @returns Promise
		 */
		createEmptyCart(ctx, cartCookie) {
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
			this.logger.info("cart.me - entity: ", entity);
			return this.adapter.insert(entity)
				.then(doc => this.transformDocuments(ctx, {}, doc))
				.then ( json => this.entityChanged("created", json, ctx).then(() => json));
		},


		/**
		 * If product has requirements, adds them with values
		 * 
		 * @param {Object} ctx 
		 * @param {Object} productAvailable 
		 * @returns Object
		 */
		addCartItemRequirements(ctx, productAvailable) {
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
			return productAvailable;
		},


		/**
		 * Add available product to cart
		 * 
		 * @param {Object} ctx 
		 * @param {Object} productAvailable 
		 * @returns Promise
		 */
		addToCart(ctx, productAvailable) {
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
						if (cart.items[isInCart].type=="subscription" || cart.items[isInCart].subtype=="digital") {
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
		}

	}
};
