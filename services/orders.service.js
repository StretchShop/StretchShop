"use strict";

require('dotenv').config();
const { MoleculerClientError } = require("moleculer").Errors;

const passGenerator = require('generate-password');
const fetch 		= require('node-fetch');
const braintree = require("braintree");

const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

module.exports = {
	name: "orders",
	mixins: [
		DbService("orders"),
		// CacheCleanerMixin([
		// 	"cache.clean.cart"
		// ])
	],

	/**
	 * Default settings
	 */
	settings: {
		/** Public fields */
		fields: [
			"_id", "externalId", "externalCode",
			"status", "user", "ip",
			"dates",
			"lang", "country", "addresses",
			"prices", "items",
			"data",
			"notes"
		],

		/** Validator schema for entity */
		entityValidator: {

			externalId: { type: "string", min: 3 },
			externalCode: { type: "string", min: 3 },
			status: { type: "string", min: 3 },
			user: {
				type: "object", props: {
					id: { type: "string", min: 3 },
					externalId: { type: "string", min: 3 },
					username: { type: "string", min: 2 },
					email: { type: "email" },
				}
			},
			ip: { type: "string", min: 4 },
			dates: {
				type: "object", props: {
					dateCreated: { type: "date" },
					dateChanged: { type: "date" },
					dateSent: { type: "date" },
					datePaid: { type: "date" },
					dateExpeded: { type: "date" }
				}
			},
			lang: { type: "string", min: 2 },
			country: { type: "string", min: 2 },
			addresses: {
				type: "object", props: {
					invoiceAddress: { type: "object" },
					deliveryAddress: { type: "object" },
				}
			},
			prices: {
				type: "object", props: {
					currency: { type: "string" },
					priceTotal: { type: "number" },
					priceTotalNoTax: { type: "number" },
					priceGoods: { type: "number" },
					priceGoodsNoTax: { type: "number" },
					priceDelivery: { type: "number" },
					pricePayment: { type: "number" }
				}
			},
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
			}},
			data: {
				type: "object", props: {
					deliveryData: { type: "object" },
					paymentData: { type: "object" },
					couponData: { type: "object" }
				}
			},
			notes: {
				type: "object", props: {
					customerNote: { type: "string" },
					sellerNote: { type: "string" },
				}
			}

		},

		// ------------- ORDER VARIABLES AND SETTINGS -------------
		defaultConstants: {
			tax: 0.2
		},

		order: {
			sendingOrder: {
				url: process.env.SENDING_ORDER_URL,
				port: process.env.SENDING_ORDER_PORT,
				login: process.env.SENDING_ORDER_LOGIN,
				password: process.env.SENDING_ORDER_PWD
			},
			deliveryMethods: [
				{
					codename: "personaly",
					type: "physical",
					name: {
						"en": "Personaly on Branch",
						"sk": "Osobne na Pobočke"
					},
					prices: [
						{
							"range": {"from": 0, "to": 1000000},
							"price": 0
						}
					]
				},
				{
					codename: "courier",
					type: "physical",
					name: {
						"en": "Courier",
						"sk": "Kuriér"
					},
					prices: [
						{
							"range": {"from": 0, "to": 500},
							"price": 5
						},
						{
							"range": {"from": 500, "to": 1000000},
							"price": 0
						}
					]
				},
				{
					codename: "download",
					type: "digital",
					name: {
						"en": "Download",
						"sk": "Stiahnuť"
					},
					prices: [
						{
							"range": {"from": 0, "to": 500},
							"price": 5
						},
						{
							"range": {"from": 500, "to": 1000000},
							"price": 0
						}
					]
				}
			],
			paymentMethods: [
				{
					codename: "cod",
					type: "product",
					name: {
						"en": "Cash On Delivery",
						"sk": "Platba Pri Doručení"
					},
					prices: [
						{
							"range": {"from": 0, "to": 500},
							"price": 10
						},
						{
							"range": {"from": 500, "to": 1000000},
							"price": 2
						}
					]
				},
				{
					codename: "online",
					name: {
						"en": "Pay online (Card, PayPal)",
						"sk": "Zaplatiť online (Karta, PayPal)",
					},
					prices: [
						{
							"range": {"from": 0, "to": 500},
							"price": 2
						},
						{
							"range": {"from": 500, "to": 1000000},
							"price": 0
						}
					]
				}
			]
		},

		orderTemp: {},
		orderErrors: {
			"itemErrors": [],
			"userErrors": [],
			"orderErrors": []
		},
		emptyUpdateResult: { "id": -1, "name": "order not processed", "success": false },

		paymentsConfigs: {
			braintree: {
				enviroment: process.env.BRAINTREE_ENV==='production' ? braintree.Environment.Production : braintree.Environment.Sandbox,
				merchantId: process.env.BRAINTREE_MERCHANT_ID,
				publicKey: process.env.BRAINTREE_PUBLIC_KEY,
				privateKey: process.env.BRAINTREE_PRIVATE_KEY,
				gateway: null
			}
		}
	},


	/**
	 * Actions
	 */
	actions: {
		/**
		 * Get current order progress according to cart
		 *
		 * @returns {Object} cart entity with items
		 */
		progress: {
			// auth: "required",
			params: {
				orderParams: { type: "object", optional: true },
			},
			handler(ctx) {
				let updateResult = this.settings.emptyUpdateResult;
				console.log("\n\n"+'order.progress - intro (IN):', ctx.meta, "\n\n");

				return ctx.call('cart.me')
				.then(cart => {
					console.log("\n\n"+'order.progress - cart result (CR):', cart, "\n\n");
					if (cart.order && cart.order.toString().trim()!="") { // order exists, get it
						return this.adapter.findById(cart.order)
						.then(order => {
							console.log("\n\n"+'order.progress - order result (OR):', cart, "\n\n");
							if ( order && order.status=="cart" ) {
								// update order items
								if ( cart.items ) {
									order.items = cart.items;
								}

								// run processOrder(orderParams) to proces user input and
								// update order data according to it
								this.settings.orderTemp = order;
								updateResult = this.processOrder(ctx);
								this.getAvailableOrderSettings();
								console.log("\n\n"+'order.progress - cart order found updated (COFU):', updateResult, "\n\n");
								// if no params (eg. only refreshed), return original order
								if ( !ctx.params.orderParams || Object.keys(ctx.params.orderParams).length<1 ) {
									let orderProcessedResult = {};
									orderProcessedResult.order = order;
									orderProcessedResult.result = updateResult;
									if ( !updateResult.success ) {
										orderProcessedResult.errors = this.settings.orderErrors;
									}
									return orderProcessedResult;
								}
								// if order check returns success, order can be saved
								if ( updateResult.success ) {
									this.settings.orderTemp.status = "saved";
								}
								// order ready to save and send - update order data in related variables
								order = this.settings.orderTemp;
								cart.order = order._id;
								return ctx.call('cart.updateCartItemAmount', {cartId: cart._id, cart: cart})
								.then(cart2 => {
									return this.adapter.updateById(order._id, this.prepareForUpdate(order))
									.then(orderUpdated => {
										// if order was processed with errors, add them to result for frontend
										let orderProcessedResult = {};
										orderProcessedResult.order = orderUpdated;
										orderProcessedResult.result = updateResult;
										if ( !updateResult.success ) {
											orderProcessedResult.errors = this.settings.orderErrors;
										} else {
											// order was processed without errors, run afterSaveActions
											orderProcessedResult = this.orderAfterSaveActions(ctx, orderProcessedResult);
										}
										return orderProcessedResult;
									});
								});
							} else { // cart has order id, but order with 'cart' status not found
								console.log("\n\n"+'CREATE order - orderId from cart not found'+"\n\n");

								if (
									(
										!this.settings.orderTemp.user ||
										(typeof this.settings.orderTemp.user.id==='undefined' || this.settings.orderTemp.user.id===null || this.settings.orderTemp.user.id=='')
									) &&
									(ctx.params.orderParams.addresses && ctx.params.orderParams.addresses.invoiceAddress && ctx.params.orderParams.addresses.invoiceAddress.email)
								) {
									if ( ctx.meta.user && ctx.meta.user._id && ctx.meta.user._id.toString().trim()!='' ) {
										this.settings.orderTemp.user = ctx.meta.user._id;
									} else { // user not set in meta data

										return ctx.call('users.checkIfEmailExists', {
											email: ctx.params.orderParams.addresses.invoiceAddress.email
										})
										.then((exists) => { // promise #1
											if (exists) {
												this.settings.orderErrors.orderErrors.push({"value": "Email", "desc": "already exists"});
												if ( this.settings.orderErrors.userErrors.length>0 ) {
													return null;
												}
											} else {
												let userData = this.getDataToCreateUser(ctx);
												return ctx.call('users.create', userData)
												.then(newUser => {  // promise #2
													// new user created, add his data to order and create special variable to process it with createOrderAction
													if ( newUser && newUser.user && newUser.user._id && newUser.user._id!='' ) {
														ctx.params.orderParams.user.id = newUser.user._id;
														ctx.params.orderParams.user.email = newUser.user.email;
														ctx.params.orderParams.user.token = newUser.user.token;
														ctx.meta.userNew = true;
													}
													return this.createOrderAction(cart, ctx, this.adapter);;
												})
												.catch(userCreateRej => {
													console.log('new user rejected: ', userCreateRej);
													return null;
												});
											}
										});

									}
								} else { // default option, creates new order if none found - TODO - add auto clear
									return this.createOrderAction(cart, ctx, this.adapter);
								}
							}
						});
					} else { // order does not exist, create it
						console.log("\n\n"+'CREATE order - no order (NO):'+"\n\n");
						return this.createOrderAction(cart, ctx, this.adapter);
					}
				}); // cart end
			}
		},


		cancel: {
			params: {
				itemId: { type: "string", min: 3, optional: true },
				amount: { type: "number", positive: true, optional: true }
			},
			handler(ctx) {
				let entity = ctx.params.cart;
				// get cart
				return ctx.call("cart.me")
					.then(cart => {
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
							// update cart in variable and datasource
							ctx.meta.cart = cart
							return this.adapter.updateById(ctx.meta.cart._id, cart);
						}
					});
			}
		},

		/**
		 * List user orders if logged in
		 *
		 * @actions
		 *
		 * @returns {Object} User entity
		 */
		listOrders: {
			// cache: {
			// 	keys: ["#cartID"]
			// },
			auth: "required",
			params: {
				filter: { type: "object", optional: true }
			},
			handler(ctx) {
				// check if we have logged user
				if ( ctx.meta.user._id ) { // we have user
					if ( !ctx.params.filter ) {
						ctx.params.filter = {};
					}
					ctx.params.filter["user.id"] = ctx.meta.user._id;
					return ctx.call("orders.find", {
						"query": ctx.params.filter
					})
						.then(found => {
							if (found) { // cart found in datasource, save to meta
								return found;
							} else { // no cart found in datasource, create one
								return Promise.reject(new MoleculerClientError("Orders not found!", 400, "", [{ field: "orders", message: "not found"}]));
							}
						});
				}

			}
		},

		braintreeClientToken: {
			handler(ctx) {
				this.paymentBraintreeGateway();
				let self = this;

				let tokenResponse = new Promise(function(resolve, reject) {
					self.settings.paymentsConfigs.braintree.gateway.clientToken.generate({}, function (err, response) {
						if (response && response.clientToken) {
					    resolve(response.clientToken);
						}
						if (err) {
							console.log("braintree err: ", err);
					    reject(err);
						}
				  })
				});

				return tokenResponse.then(token => {
					return { result: "success", token: token };
				});
			}
		},

		braintreeOrderPaymentCheckout: {
			params: {
				orderId: { type: "string", min: 3 },
				checkoutData: { type: "object", props: {
						binData: { type: "object", optional: true },
						description: { type: "string", optional: true },
						details: { type: "object" },
						nonce: { type: "string", min: 3 },
						type: { type: "string" }
					}
				}
			},
			handler(ctx) {
				this.paymentBraintreeGateway();
				let self = this;
				console.log("ctx.params: ", ctx.params);

				// get order data - total amount
				return this.adapter.findById(ctx.params.orderId)
				.then(order => {
					let transactionResponse = new Promise(function(resolve, reject) {
						return self.settings.paymentsConfigs.braintree.gateway.transaction.sale({
						  amount: (Math.round(order.prices.priceTotal*100)/100),
						  paymentMethodNonce: ctx.params.checkoutData.nonce,
						  options: {
						    submitForSettlement: true
						  }
						}, function (err, result) {
							if (err) {
								console.log('\n transaction.sale error: ', err);
								reject(err);
							}
							console.log('\n transaction.sale result: ', result);
							resolve(result);
						});
					}); // promise end

					return transactionResponse.then(transaction => {
						return transaction;
					});
				});
			}
 		}

	},

	/**
	 * Methods
	 */
	methods: {

		createEmptyOrder(ctx) {
			let order = {
				"externalId": null,
				"externalCode": null,
				"status": "cart",
				"user": {
					"id": (ctx.meta.user && ctx.meta.user._id) ? ctx.meta.user._id : null,
					"externalId": (ctx.meta.user && ctx.meta.user.externalId) ? ctx.meta.user.externalId : null,
					"username": (ctx.meta.user && ctx.meta.user.username) ? ctx.meta.user.username : null,
					"email": (ctx.meta.user && ctx.meta.user.email) ? ctx.meta.user.email : null,
				},
				"ip": ctx.meta.remoteAddress,
				"dates": {
					"dateCreated": new Date(),
					"dateChanged": null,
					"dateSent": null,
					"datePaid": null,
					"dateExpeded": null,
					"userConfirmation": null
				},
				"lang": this.getValueByCode(ctx.meta.localsDefault.langs,ctx.meta.localsDefault.lang),
				"country": this.getValueByCode(ctx.meta.localsDefault.countries,ctx.meta.localsDefault.country),
				"addresses": {
					"invoiceAddress": null,
					"deliveryAddress": null
				},
				"prices": {
					"currency": this.getValueByCode(ctx.meta.localsDefault.currencies,ctx.meta.localsDefault.currency),
					"priceTotal": null,
					"priceTotalNoTax": null,
					"priceItems": null,
					"priceItemsNoTax": null,
					"priceTaxTotal": null,
					"priceDelivery": null,
					"pricePayment": null
				},
				"items": [],
				"data": {
					"deliveryData": null,
					"paymentData": null,
					"couponData": null,
				},
				"notes": {
					"customerNote": null,
					"sellerNote": null,
				}
			};

			return order;
		},


		createOrderAction(cart, ctx, adapter){
			let updateResult = this.settings.emptyUpdateResult;
			let order = this.createEmptyOrder(ctx);
			// update order items
			if ( cart.items ) {
				order.items = cart.items;
			}
			// run processOrder(orderParams) to update order data
			this.settings.orderTemp = order;
			this.getAvailableOrderSettings();
			if ( ctx.params.orderParams ) {
				console.log('createOrderAction -> before updateResult');
				updateResult = this.processOrder(ctx);
				console.log('createOrderAction -> updateResult: ', updateResult);
				if ( !updateResult.success ) {
					console.log( 'Order NO SUCCESS: ', this.settings.orderErrors )
				}
			}
			// update order data in related variables
			order = this.settings.orderTemp;
			console.log("\n\n----------order before save--------", order);
			cart.order = order._id;
			// save new order
			return adapter.insert(order)
			.then(orderNew => {
				cart.order = orderNew._id; // order id is not saved to cart
				console.log("\n\n order after save (OAS) -----: ", orderNew);
				return ctx.call('cart.updateMyCart', {"cartNew": cart})
				.then(cart2 => {
					let orderProcessedResult = {};
					orderProcessedResult.order = orderNew;
					orderProcessedResult.result = updateResult;
					if ( !updateResult.success ) {
						orderProcessedResult.errors = this.settings.orderErrors;
					}
					return orderProcessedResult;
				});
			});
		},


		/**
		 * Main service to call on order updates from
		 * Returns these states:
		 * 0: missing cart items
		 * 1: missing user data
		 * 2: missing order data
		 * 3: order ready but not confirmed
		 * 4: order confirmed, ready to save with "saved" status
		 */
		processOrder(ctx) {
			let self = this;

			if (this.settings.orderTemp) {
			// update order params
				if ( typeof ctx.params.orderParams !== "undefined" && ctx.params.orderParams ) {
					this.settings.orderTemp = this.updateBySentParams(this.settings.orderTemp, ctx.params.orderParams);
					console.log("\n ctx.meta \n", ctx.meta);
					if ( ctx.meta.userNew && ctx.meta.userNew===true ) {
						console.log( "\n\n setting new user data \n\n" );
						this.settings.orderTemp.user.id = ctx.params.orderParams.user.id;
						this.settings.orderTemp.user.email = ctx.params.orderParams.user.email;
						this.settings.orderTemp.user.token = ctx.params.orderParams.user.token;
						console.log( this.settings.orderTemp );
					}
				}
				this.settings.orderTemp.dates.dateChanged = new Date();

				if (this.checkCartItems()) {
					if (this.checkUserData(ctx)) { // check if (invoice address) is set and valid
						if (this.checkOrderData()) { // check if order data (delivery, payment) are set and done
							if (this.checkConfirmation()) {
								return { "id": 4, "name": "confirmed", "success": true };
							} else {
								return { "id": 3, "name": "missing confirmation", "success": false };
							}
						} else {
							return { "id": 2, "name": "missing order data", "success": false };
						}
					} else {
						return { "id": 1, "name": "missing user data", "success": false };
					}
				} else {
					return { "id": 0, "name": "missing cart items", "success": false };
				}
				return this.settings.orderTemp;
			}

			return false;
		},


		/**
		 * Updates order parameters using parameters from request
		 * according to template created with createEmptyOrder().
		 * From level 2 it enables to create objects by request.
		 */
		updateBySentParams(orderParams, updateParams, level) {
			level = (typeof level !== 'undefined') ?  level : 0;
			let self = this;
			let level1protectedProps = ['user', 'id'];
			// loop updateParams and check, if they exist in orderParams
			Object.keys(updateParams).forEach(function(key) {
				if ( !(level==0 && level1protectedProps.includes(key)) ) {
					if ( ((orderParams && orderParams.hasOwnProperty(key)) || level>=2) ) { // order has this property
						// update it
						if ( orderParams===null ) {
							orderParams = {};
						}
						if ( typeof updateParams[key] === 'object' ) {
							if ( !orderParams[key] || orderParams[key]===null ) {
								orderParams[key] = {};
							}
							if (updateParams[key]!==null) {
								orderParams[key] = self.updateBySentParams(orderParams[key], updateParams[key], level+1);
							} else {
								orderParams[key] = null;
							}
						} else {
							orderParams[key] = updateParams[key];
						}
					}
				}
			});

			return orderParams;
		},


		/**
		 * Check if there are cart items set
		 */
		checkCartItems() {
			if ( this.settings.orderTemp && this.settings.orderTemp.items ) {
				console.log("this.settings.orderTemp.items.length: ", this.settings.orderTemp.items.length);
				if ( this.settings.orderTemp.items.length>0 ) {
					return true;
				} else {
					this.settings.orderErrors.itemErrors.push({"value": "Cart items", "desc": "no items"});
				}
			} else {
				this.settings.orderErrors.itemErrors.push({"value": "Cart items", "desc": "not set"});
			}
			return false;
		},


		/**
		 * Check if all items to register user and make order on his name are set
		 */
		checkUserData(ctx) {
			let requiredFields = ['email', 'phone', 'nameFirst', 'nameLast', 'street', 'zip', 'city', 'country'];
			if ( ctx.meta.userID && ctx.meta.userID.toString().trim()!=='' ) {
				requiredFields = ['phone', 'nameFirst', 'nameLast', 'street', 'zip', 'city', 'country'];
			}
			let optionalFileds = ['state', 'street2'];
			this.settings.orderErrors.userErrors = [];
			let self = this;

			if ( !this.settings.orderTemp || !this.settings.orderTemp.addresses ||
			!this.settings.orderTemp.addresses.invoiceAddress ) {
				this.settings.orderErrors.userErrors.push({"value": "Invoice address", "desc": "not set"});
				return false;
			}

			// split name
			if ( this.settings.orderTemp.addresses && this.settings.orderTemp.addresses.invoiceAddress ) {
				if ( this.settings.orderTemp.addresses.invoiceAddress.name && this.settings.orderTemp.addresses.invoiceAddress.name.indexOf(' ') ) {
					let nameSplit = this.settings.orderTemp.addresses.invoiceAddress.name.split(" ");
					this.settings.orderTemp.addresses.invoiceAddress.nameFirst = nameSplit[0];
					if ( nameSplit.length>1 ) {
						this.settings.orderTemp.addresses.invoiceAddress.nameLast = nameSplit[nameSplit.length-1];
					}
				}
			}

			if ( this.settings.orderTemp.addresses.invoiceAddress && this.settings.orderTemp.addresses.invoiceAddress!==null ) {
				let hasErrors = false;
				requiredFields.forEach(function(value){
					if ( !self.settings.orderTemp.addresses.invoiceAddress[value] || self.settings.orderTemp.addresses.invoiceAddress[value].toString().trim()=="" ) {
						self.settings.orderErrors.userErrors.push({"value": "Invoice address value '"+value+"'", "desc": "not found"});
						hasErrors = true;
					}
				});
				if (hasErrors) {
					return false;
				}
			} else {
					this.settings.orderErrors.userErrors.push({"value": "Invoice address", "desc": "not set"});
					return false;
			}

			return true;
		},


		checkIfUserEmailExists(ctx) {
			console.log('CTX:', ctx.params);
			if ( ctx.params.orderParams && ctx.params.orderParams.addresses && ctx.params.orderParams.addresses.invoiceAddress ) {
				let self = this;
				console.log(' --- -- - 3.1 - ');
			}
		},


		/**
		 * Check that define basic options of order - delivery and payment types
		 * Get prices of delivery and payment from settings
		 */
		checkOrderData() {
			this.settings.orderErrors.orderErrors = [];
			let self = this;

			// check if delivery type is set
			if ( this.settings.orderTemp.data.deliveryData && this.settings.orderTemp.data.deliveryData.codename ) {
				let deliveryType = this.settings.orderTemp.data.deliveryData.codename;
				this.settings.orderTemp.data.deliveryData = { "codename": deliveryType };
				let deliveryMethodExists = false;

				Object.keys(deliveryType).forEach(function(typeKey){
					if (deliveryType[typeKey]!=null) {
						self.settings.order.deliveryMethods.some(function(value){
							if ( !deliveryType[typeKey].value ) {
								let valueTemp = deliveryType[typeKey];
								deliveryType[typeKey] = { value: valueTemp };
							}
							if ( value && value.codename==deliveryType[typeKey].value ) {
								self.settings.orderTemp.data.deliveryData.codename[typeKey] = {};
								// need to filter language later
								self.settings.orderTemp.data.deliveryData.codename[typeKey].value = value.codename;
								console.log("deliveryValue: ", value);
								// count item prices to get count for delivery
								self.settings.orderTemp.prices.priceItems = 0;
								self.countOrderPrices('items');
								if ( self.settings.orderTemp.prices.priceItems>0 ) {
									// TODO - check if all items in cart are physical / digital and change delivery according to it
									value.prices.some(function(deliveryPrice){
										if ( self.settings.orderTemp.prices.priceItems>=deliveryPrice.range.from && self.settings.orderTemp.prices.priceItems<deliveryPrice.range.to ) {
											// have match set the delivery price
											self.settings.orderTemp.prices.priceDelivery = deliveryPrice.price;
											self.settings.orderTemp.data.deliveryData.codename[typeKey].price = deliveryPrice.price;
											return true;
										}
									})
								}
								deliveryMethodExists = true;
								return true;
							}
						});
					}
				});
				if (!deliveryMethodExists) {
					this.settings.orderErrors.orderErrors.push({"value": "Deliverry type", "desc": "not found"});
				}
			} else {
				this.settings.orderErrors.orderErrors.push({"value": "Deliverry type", "desc": "not set"});
			}

			// check if payment type is set
			if ( this.settings.orderTemp.data.paymentData && this.settings.orderTemp.data.paymentData.codename ) {
				let paymentType = this.settings.orderTemp.data.paymentData.codename;
				this.settings.orderTemp.data.paymentData = { "codename": paymentType };
				let paymentMethodExists = false;

				this.settings.order.paymentMethods.some(function(value){
					if ( value && value.codename==paymentType ) {
						// need to filter language later
						self.settings.orderTemp.data.paymentData.name = value.name;
						console.log("paymentValue: ", value);
						//--
						if ( self.settings.orderTemp.prices.priceItems <= 0 ) {
							self.countOrderPrices(false);
						}
						value.prices.some(function(paymentPrice){
							if ( self.settings.orderTemp.prices.priceItems>=paymentPrice.range.from && self.settings.orderTemp.prices.priceItems<paymentPrice.range.to ) {
								// have match set the delivery price
								self.settings.orderTemp.prices.pricePayment = paymentPrice.price;
								self.settings.orderTemp.data.paymentData.price = paymentPrice.price;
								return true;
							}
						});
						paymentMethodExists = true;
						return true;
					}
				});
				if (!paymentMethodExists) {
					this.settings.orderErrors.orderErrors.push({"value": "Payment type", "desc": "not found"});
				}
			} else {
				this.settings.orderErrors.orderErrors.push({"value": "Payment type", "desc": "not set"});
			}

			if ( this.settings.orderErrors.orderErrors.length>0 ) {
				return false;
			} else {
				this.countOrderPrices('totals');
			}
			return true;
		},


		/**
		 * Count cart items total price and order total prices
		 */
		countOrderPrices(calculate) {
			let calcTypes = ['all', 'items', 'totals'];
			calculate = (typeof calculate !== 'undefined' && calcTypes.includes(calculate)) ?  calculate : 'all';
			let self = this;
			// use default VAT if not custom eg. for product
			let tax = self.settings.defaultConstants.tax;

			// prices of items
			if ( calculate=='all' || calculate=='items' ) {
				this.settings.orderTemp.prices.priceItems = 0;
				this.settings.orderTemp.prices.priceItemsNoTax = 0;
				this.settings.orderTemp.items.forEach(function(value){
					self.settings.orderTemp.prices.priceItems += value.price;
					if ( value.tax && value.tax!=null ) {
						tax = value.tax;
					}
					let priceNoTax = value.price / (1 + tax);
					self.settings.orderTemp.prices.priceItemsNoTax += priceNoTax;
					let taxOnly = value.price / (1 + tax);
					self.settings.orderTemp.prices.priceTaxTotal += taxOnly;
				});
			}

			// count other totals
			if ( calculate=='all' || calculate=='totals' ) {
				this.settings.orderTemp.prices.priceTotal = this.settings.orderTemp.prices.priceItems +
					this.settings.orderTemp.prices.priceDelivery +
					this.settings.orderTemp.prices.pricePayment;
				let priceDeliveryNoTax = this.settings.orderTemp.prices.priceDelivery / (1 + tax);
				let pricePaymentNoTax = this.settings.orderTemp.prices.pricePayment / (1 + tax);
				this.settings.orderTemp.prices.priceTotalNoTax = this.settings.orderTemp.prices.priceItemsNoTax +
					priceDeliveryNoTax + pricePaymentNoTax;
			}
		},


		/**
		 * Check that define basic options of order - delivery and payment types
		 * Get prices of delivery and payment from settings
		 */
		checkConfirmation() {
			console.log( this.settings.orderTemp.dates.userConfirmation, this.settings.orderTemp.dates.userConfirmation, Date.now() );
			if ( this.settings.orderTemp.dates.userConfirmation && this.settings.orderTemp.dates.userConfirmation < Date.now() ) {
				return true;
			} else {
				this.settings.orderErrors.orderErrors.push({"value": "Confirmation", "desc": "missing"});
			}

			return false;
		},


		/**
		 * Get Delivery and Payment settings
		 */
		getAvailableOrderSettings() {
			if ( typeof this.settings.orderTemp.settings == 'undefined' ) {
					this.settings.orderTemp.settings = {};
			}
			this.getAvailableDeliveries();
			this.getAvailablePayments();
		},


		/**
		 * Loop available delivery types
		 */
		getAvailableDeliveries() {
			let self = this;
			let usedProductTypes = [];

			if (this.settings.orderTemp.items && this.settings.orderTemp.items.length>0) {
				Object.keys(this.settings.orderTemp.items).forEach((itemKey) => { // loop items
					if ( usedProductTypes.indexOf(self.settings.orderTemp.items[itemKey].subtype)<0 ) {
						usedProductTypes.push( self.settings.orderTemp.items[itemKey].subtype );
					}
				}); // loop items end
			}

			console.log('orders.getAvailableDeliveries.usedProductTypes:', usedProductTypes);

			if ( usedProductTypes.length>0 ) {
				if ( typeof this.settings.orderTemp.settings == 'undefined' ) {
						this.settings.orderTemp.settings = {};
				}
				this.settings.orderTemp.settings.deliveryMethods = [];
				Object.keys(this.settings.order.deliveryMethods).forEach((deliveryKey) => { // loop deliveries
					if ( usedProductTypes.indexOf(this.settings.order.deliveryMethods[deliveryKey].type)>-1  ) {
						this.settings.orderTemp.settings.deliveryMethods.push( this.settings.order.deliveryMethods[deliveryKey] );
					}
				}); // loop deliveries end
			}
		},


		/**
		 * Loop available payment types
		 */
		getAvailablePayments() {
			if ( typeof this.settings.orderTemp.settings === 'undefined' ) {
					this.settings.orderTemp.settings = {};
			}
			this.settings.orderTemp.settings.paymentMethods = this.settings.order.paymentMethods;
		},


		/**
		 * Run Actions that should follow After Order was checked and Saved
		 *
		 * @returns {Object} order complete result with result, errors
		 */
		orderAfterSaveActions(ctx, orderProcessedResult) {
				let self = this;

			// 1. if set url, send order. If no url or send was success, set status to Sent.
			console.log('this.settings.order.sendingOrder: ', this.settings.order.sendingOrder);
			if ( this.settings.order.sendingOrder && this.settings.order.sendingOrder.url && this.settings.order.sendingOrder.url.toString().trim()!='' ) {
				let auth = "Basic " + Buffer.from(this.settings.order.sendingOrder.login + ':' + this.settings.order.sendingOrder.password).toString('base64');
				return fetch(this.settings.order.sendingOrder.url+"?action=order", {
						method: 'post',
						body:    JSON.stringify({"shopId": "StretchShop","order":orderProcessedResult.order}),
						headers: { "Content-Type": "application/json", "Authorization": auth },
				})
				.then(res => res.json()) // expecting a json response, checking it
				.then(orderSentResponse => {
					console.log("orderSentResponse: ", orderSentResponse);
					// check if response has the most important information about how order was processed
					console.log( orderSentResponse.type , orderSentResponse.type=='success' ,
					orderSentResponse.result.status );
					if ( orderSentResponse.type && orderSentResponse.type=='success' &&
					orderSentResponse.result && orderSentResponse.result.status &&
					orderSentResponse.result.order ) {
						// order SENT, response type is success
						// if response is SUCCESS, nothing has to be changed by user, return original order
						if ( orderSentResponse.result.status=="accepted" ) {
							// process response
							let updatedOrder = this.processResponseOfOrderSent(orderProcessedResult.order, orderSentResponse.result.order);
							// 2. clear cart + 3. send email
							return self.orderAfterAcceptedActions(ctx, orderProcessedResult)
							.then(success => {
								if ( success ) {
									orderProcessedResult.order = updatedOrder;
									orderProcessedResult.order.status = "sent";
									orderProcessedResult.order.emailSent = new Date();
									// save with sent status and email sent date after it
									return this.adapter.updateById(orderProcessedResult.order._id, self.prepareForUpdate(orderProcessedResult.order))
									.then(orderUpdated => {
										return orderProcessedResult;
									});
								}
							});
						} else {
							// response is CHANGED or REJECTED - send response without changes to front-side so user makes decision
							return orderProcessedResult;
						}
					} else { // something is wrong with order data or server
						// return original response, but add error
						orderProcessedResult.errors.push({"value": "Server", "desc": "bad response"});
						return orderProcessedResult;
					}
				});
			} else { // no url to send
				// 2. clear cart + 3. send email
				return self.orderAfterAcceptedActions(ctx, orderProcessedResult)
				.then(success => {
					if ( success ) {
						orderProcessedResult.order.emailSent = new Date();
						// save after it
						return orderProcessedResult;
					}
				});
			}
		},


		/**
		 * This function verifies data from sent response, and if they were
		 * updated, it defines the logic of what new data will be used and what
		 * remains same.
		 * This implementation represents the most conservative version - changes
		 * only amount of cart items. It's up to business model if any more liberal
		 * approach is needed. But be carefull to not create backdoors.
		 */
		processResponseOfOrderSent(orderOriginal, orderResponse) {
			if ( orderOriginal && orderResponse ) {
				// update externalIds
				if ( orderResponse.externalId && orderResponse.externalId.toString().trim()!='' ) {
					orderOriginal.externalId = orderResponse.externalId;
				}
				if ( orderResponse.externalCode && orderResponse.externalCode.toString().trim()!='' ) {
					orderOriginal.externalCode = orderResponse.externalCode;
				}
				// update items
				if ( orderOriginal.items && orderOriginal.items.length>0 &&
				orderResponse.items && orderResponse.items.length>0 &&
				orderOriginal.items.length==orderResponse.items.length ) {
					Object.keys(orderOriginal.items).forEach(function(key){
						/** items of both orders must satisfy these rules:
						 *   - response must have items,
	 					 *   - both orders' items must have same value of ._id property on same array position,
						 *   - both orders' items must have .amount property
						 */
						if ( orderResponse.items[key] &&
						orderOriginal.items[key]._id && orderResponse.items[key]._id &&
						orderResponse.items[key]._id==orderResponse.items[key]._id &&
					  orderOriginal.items[key].amount && orderResponse.items[key].amount ) {
							// if it has responseAction set
							if ( orderOriginal.items[key].responseAction ) {
								if ( orderOriginal.items[key].responseAction=="updated" ) {
									orderOriginal.items[key].amount = orderResponse.items[key].amount;
								} else if ( orderOriginal.items[key].responseAction=="rejected" ) {
									orderOriginal.items[key].amount = 0;
								}
							}
						}
					});
				}
			}

			return orderOriginal;
		},



		/**
		 * actions to perform after order was sent and accepted
		 *
		 * @returns {Boolean}
		 */
		orderAfterAcceptedActions(ctx, orderResult) {
			let self = this;
			// 1. clear the cart
			return ctx.call("cart.delete")
			.then(cart => {
				// 2. send email about order
				let userEmail = '';
				if ( typeof ctx.meta.user.email !== 'undefined' && ctx.meta.user.email ) {
					userEmail = ctx.meta.user.email;
				}
				if ( typeof self.settings.orderTemp.addresses.invoiceAddress.email !== 'undefined' && self.settings.orderTemp.addresses.invoiceAddress.email ) {
					userEmail = self.settings.orderTemp.addresses.invoiceAddress.email;
				}
				console.log("\n\norders.service.orderAfterAcceptedActions:", userEmail, ctx.meta.user, self.settings.orderTemp.addresses.invoiceAddress);
				return ctx.call("users.sendEmail",{
					template: "ordered",
					data: {
						order: self.settings.orderTemp
					},
					settings: {
						subject: "StretchShop - Your Order #"+self.settings.orderTemp._id,
						to: userEmail
					}
				})
				.then(booleanResult => {
					console.log('Email order SENT:', booleanResult);
					return true;
				});
			});
			return false;
		},


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
		},

		paymentBraintreeGateway() {
			this.settings.paymentsConfigs.braintree.gateway = braintree.connect({
			  environment: braintree.Environment.Sandbox,
			  merchantId: this.settings.paymentsConfigs.braintree.merchantId,
			  publicKey: this.settings.paymentsConfigs.braintree.publicKey,
			  privateKey: this.settings.paymentsConfigs.braintree.privateKey
			});
		},

		getValueByCode(arrayOfValues, codeToPick) {
			if (arrayOfValues.length>0 && codeToPick!='') {
				arrayOfValues.forEach(function(value){
					if (value && value.code && value.code!='' && value.code==codeToPick) {
						return value;
					}
				});
			}
			return codeToPick;
		},

		getDataToCreateUser(ctx) {
			let userName = ctx.params.orderParams.addresses.invoiceAddress.nameFirst;// +""+ this.settings.orderTemp.addresses.invoiceAddress.nameLast;
			let userPassword = passGenerator.generate({
					length: 10,
					numbers: true
			});// 'A2JFHnnGqL38D';
			if ( ctx.params.orderParams.password ) {
				userPassword = ctx.params.orderParams.password;
			}
			let userData = {
				user: {
					username: userName,
					email: ctx.params.orderParams.addresses.invoiceAddress.email,
					password: userPassword,
					type: 'user',
					addresses: [ctx.params.orderParams.addresses.invoiceAddress],
					activated: new Date()
				}
			};
			return userData;
		}
	},

	events: {
		// "cache.clean.cart"() {
		// 	if (this.broker.cacher)
		// 		this.broker.cacher.clean(`${this.name}.*`);
		// }
	}
};
