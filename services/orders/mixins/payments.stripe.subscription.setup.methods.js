"use strict";
const { MoleculerClientError } = require("moleculer").Errors;
const { result, get } = require("lodash");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");
const DbService = require("../../../mixins/db.mixin");
const fetch = require("cross-fetch");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = {
	mixins: [ DbService("orders"), HelpersMixin, priceLevels ],
	methods: {
		getOrderSubscriptions(ctx, related) {
			let self = this;
			let filter = { query: {} };
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() related.order:", related.order);

			// add ids of subscriptions that are not agreed
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() DEBUG1:", related.ids , related.order );
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() DEBUG2:", related.order.data.subscription);
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() DEBUG3:", related.order.data.subscription.ids);
			if (related.ids && related?.order?.data?.subscription?.ids) { 
				let idsObjs = [];
				related.order.data.subscription.ids.forEach(id => {
					// check if subscription is agreed, if - add its product
					if (!id.agreed || id.agreed.toString().trim()=="") {
						idsObjs.push(self.fixStringToId(id.subscription));
					}
				});
				if (idsObjs.length > 0) {
					filter.query = {
						_id: { "$in": idsObjs }
					};
				}
			}
			this.logger.info("payments.stripe.mixin getOrderSubscriptions() filter:", filter, filter.query);

			// get related subscriptions without stripeID
			return ctx.call("subscriptions.find", filter)
				.then(subscriptions => {
					this.logger.info("payments.stripe.mixin getOrderSubscriptions() subscriptions:", subscriptions);
					return subscriptions;
				})
				.catch(err => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptions() err:", err);
					return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "product", message: "not found"}]));
				});
		},


		/**
		 * Get Order Subscription products from datasource.
		 * Even we have products saved in order, we need to get them from datasource
		 * because we need to get latest stripe IDs for products and prices.
		 * (it may not be saved in time of order creation)
		 * 
		 * @param {*} ctx 
		 * @param {*} related 
		 * @returns 
		 */
		getOrderSubscriptionProducts(ctx, related) {
			let self = this;
			let filter = { query: {}, limit: 1 };
			this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() related:", related);

			// add ids of subscriptions that are not agreed
			if (related?.orderPaymentStatus?.subscriptions?.next?.use?.product ) { 
				filter.query = {
					_id: related.orderPaymentStatus.subscriptions.next.use.product
				};
			}

			if ( Object.keys(filter.query).length < 1 ) {
				return null;
			}
			this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() filter:", filter, filter.query);

			// get product to that don't have stripe IDs (productId, stripe.prices)
			return ctx.call("products.find", filter)
				.then(subscriptionProducts => {
					this.logger.info("payments.stripe.mixin getOrderSubscriptionProducts() subscriptionProducts:", subscriptionProducts);
					return subscriptionProducts;
				})
				.catch(err => {
					this.logger.error("payments.stripe.mixin getOrderSubscriptionProducts() err:", err);
					return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "product", message: "not found"}]));
				});
		},


		/**
		 * 
		 * @param {Object} ctx 
		 * @param {Object} related 
		 */
		prepareStripeSubscription(ctx, related) {
			let user = ctx.meta.user;
			this.logger.info("payments.stripe.mixin pSS() #0:");
			
			return this.checkProduct(ctx, related)
				.then(stripeProduct => {
					related.product = stripeProduct;
					this.logger.info("payments.stripe.mixin pSS() #1.X related.product:", related.product);
					return this.checkPrice(ctx, related);
				})
				.then(stripeProductPrice => {
					related.product = stripeProductPrice;
					this.logger.info("payments.stripe.mixin pSS() #2.X related.product:", related.product);
					return this.checkCustomer(ctx, related);
				})
				.then(customer => {
					related.customer = customer;
					this.logger.info("payments.stripe.mixin pSS() #3.X customer:", customer);
					return this.stripeCreateSubscription(ctx, related);
				})
				.then(stripeSubscriptionResult => {
					related.result = stripeSubscriptionResult;
					return related;
				})
				.catch(err => {
					this.logger.error("payments.stripe.mixin prepareStripeSubscription() err:", err);
					return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "stripe subscription", message: "error"}]));
				});
		},


		/**
		 * 
		 * @param {Object} related 
		 * @returns Promise
		 */
		checkProduct(ctx, related) {
			let self = this;
			let lang = this.getOrderLang(related.order);
			
			return new Promise((resolve, reject) => {
				this.logger.info("payments.stripe.mixin pSS() #1:", related.product);
				if ( related?.product?.data?.stripe?.productId &&  
				related.product.data.stripe.productId.toString().trim()!="" ) {
					this.logger.info("payments.stripe.mixin pSS() #1.1 true");
					resolve(true);
				}
				this.logger.info("payments.stripe.mixin pSS() #1.1 false");
				resolve(false);
			})
				.then(hasId => {
					if (hasId) {
						this.logger.info("payments.stripe.mixin pSS() #1.2 result:", related.product);
						return related.product;
					}
					return self.stripeCreateProduct(ctx, related);
				});
		},


		// #1
		/**
		 * 
		 * @param {Object} related 
		 * @returns Promise
		 */
		stripeCreateProduct(ctx, related) {
			let lang = this.getOrderLang(related.order);
			this.logger.info("payments.stripe.mixin pSS() #1.3 related.product:", related.product);

			// check if product does exist
			return stripe.products.create({
				name: related.product._id + " - " + related.product.name[lang],
				description: related.product.descriptionShort[lang],
			})
				.then(stripeProduct => {
					this.logger.info("payments.stripe.mixin pSS() #1.3.1 stripeProduct:", stripeProduct);
					let updateProduct = { ...related.product};
					if (!updateProduct.data.stripe) { updateProduct.data["stripe"] = {}; }
					updateProduct.data.stripe["productId"] = stripeProduct.id;
					if ( updateProduct && updateProduct._id && !updateProduct.id ) {
						updateProduct.id = updateProduct._id;
						delete updateProduct._id;
					}
					this.logger.info("payments.stripe.mixin pSS() #1.3.2 updateProduct:", updateProduct);
					return ctx.call("products.import", { products: [updateProduct] })
						.then(updatedProducts => {
							if (updatedProducts[0]) {
								this.logger.info("payments.stripe.mixin pSS() #1.3.3 updatedProducts[0]:", updatedProducts[0]);
								return updatedProducts[0];
							}
							return updateProduct;
						})
						.catch(err => {
							this.logger.error("payments.stripe.mixin stripeCreateProduct() err:", err);
							return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "stripe product", message: "error"}]));
						});
				});
		},


		/**
		 * 
		 * @param {Object} order 
		 * @param {Object} product 
		 * @returns Promise
		 */
		checkPrice(ctx, related) {
			let self = this;
			
			return new Promise((resolve, reject) => {
				this.logger.info("payments.stripe.mixin pSS() #2:", related.product);
				const priceCode = self.getStripePriceAmountCode(related.product.price);
				if ( related?.product?.data?.stripe?.prices?.[priceCode]?.toString().trim() == "" ) {
					this.logger.info("payments.stripe.mixin pSS() #2.1 true");
					resolve(true);
				}
				this.logger.info("payments.stripe.mixin pSS() #2.1 false");
				resolve(false);
			})
				.then(hasId => {
					if (hasId) {
						const result = {
							id: related.product.data.stripe.prices[priceCode],
							object: "price",
						};
						this.logger.info("payments.stripe.mixin pSS() #2.2 result:", result);
						return result;
					}
					return self.stripeCreatePrice(ctx, related);
				});
		},


		// #2
		stripeCreatePrice(ctx, related) {
			let self = this;
			let product = self.priceByUser(related.product, ctx.meta.user);
			this.logger.info("payments.stripe.mixin pSS() #2.3 related.product:", related.product);

			this.logger.info("payments.stripe.mixin pSS() #2.3.1 stripeRequestObject:", 
				product.price, 
				{
					unit_amount: product.price * 100, // price as positive integer in cents
					currency: related.order.prices.currency.code,
					recurring: {
						interval: related.subscription?.period, 
						interval_count: related.subscription?.duration
					},
					product: related.product.data.stripe.productId,
				}
			);

			const stripePriceAmount = this.getStripePriceAmount(product.price); // price as positive integer in cents
			// create Stripe price for product
			return stripe.prices.create({
				unit_amount: stripePriceAmount, 
				currency: related.order.prices.currency.code,
				recurring: {
					interval: related.subscription?.period, 
					interval_count: related.subscription?.duration
				},
				product: related.product.data.stripe.productId,
			})
				.then(stripePrice => {
					this.logger.info("payments.stripe.mixin pSS() #2.3.2 stripePrice:", stripePrice);
					let updateProduct = Object.assign({}, related.product);
					if (!updateProduct.data.stripe) { updateProduct.data["stripe"] = {}; }
					if (!updateProduct.data.stripe.prices) {  updateProduct.data.stripe["prices"] = {}; } 
					// add stripe price ID to product
					const priceCode = self.getStripePriceAmountCode(product.price);
					updateProduct.data.stripe.prices[priceCode] = stripePrice.id;
					// prepare product to update with stripe price ID
					if ( updateProduct && updateProduct._id && !updateProduct.id ) {
						updateProduct.id = updateProduct._id;
						delete updateProduct._id;
					}
					this.logger.info("payments.stripe.mixin pSS() #2.3.3 updateProduct:", updateProduct);
					return ctx.call("products.import", { products: [updateProduct] })
						.then(updatedProducts => {
							if (updatedProducts[0]) {
								this.logger.info("payments.stripe.mixin pSS() #2.3.4 updatedProducts[0]:", updatedProducts[0]);
								return updatedProducts[0];
							}
							return updateProduct;
						})
						.catch(err => {
							this.logger.error("payments.stripe.mixin stripeCreatePrice() err:", err);
							return Promise.reject(new MoleculerClientError("error", 400, "", [{ field: "stripe price", message: "error"}]));
						});
				});
		},


		/**
		 * 
		 * @param {Object} related
		 * @returns Promise
		 */
	}
};
