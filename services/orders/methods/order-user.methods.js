"use strict";

require("dotenv").config();
const passGenerator = require("generate-password");
const fetch = require("cross-fetch");
const jwt = require("jsonwebtoken");
const handlebars = require("handlebars");
const { writeFileSync, ensureDir, createWriteStream } = require("fs-extra");
const pathResolve = require("path").resolve;
const SettingsMixin = require("../../../mixins/settings.mixin");
const PdfPrintMixin = require("../../../mixins/pdfprint.mixin");
const { subscriptionPaymentStatuses } = require("../constants/subscription.constants");
const { productStatuses } = require("../constants/product.constants");
const { orderStatuses } = require("../constants/order.constants");
const { update } = require("lodash");

const calcExcludedTypes = ["subscription"];

module.exports = {
	methods: {
		checkUserData(ctx) {
			let user = null;
			this.logger.info("orders.checkUserData() - user inputs: ", { orderUser: this.settings.orderTemp.user, loggedUser: ctx.meta.user });

			if ( this.settings.orderTemp.user && ctx.meta.user && ctx.meta.user._id && 
				ctx.meta.user._id!=null && this.settings.orderTemp.user.id != ctx.meta.user._id ) {
				// we have user but it's not set in order 
				// (eg. logged in after started order)
				this.logger.info("orders.checkUserData() CUD - #1 user logged, but not set in order");
				user = {
					id: (ctx.meta.user._id) ? ctx.meta.user._id : null,
					externalId: (ctx.meta.user.externalId) ? ctx.meta.user.externalId : null,
					username: (ctx.meta.user.username) ? ctx.meta.user.username : null,
					email: (ctx.meta.user.email) ? ctx.meta.user.email : null,
					addresses: (ctx.meta.user.addresses) ? ctx.meta.user.addresses : null
				};

			} else if ( this.settings.orderTemp.user && ctx.meta.userNew===true ) {
				// it's new user, created in order, use already set order data
				// that means, there is no registered & activated & logged user 
				// creating "order_no_verif" cookie
				this.logger.info("orders.checkUserData() CUD - #2 new user from order, use order data & order_no_verif cookie");
				user = this.settings.orderTemp.user ? this.settings.orderTemp.user : ctx.params.orderParams.user;
				if ( user && user.id && user.email ) {
					this.generateJWT(user, ctx);
				}

			} else if ( ctx.meta.cookies && ctx.meta.cookies["order_no_verif"] ) {
				// user is set from "order_no_verif" cookie
				// that means, there is no registered & activated & logged user 
				// user is being created in process of order
				let orderNoVerif = jwt.decode(ctx.meta.cookies["order_no_verif"]);
				if ( orderNoVerif?.id && orderNoVerif.email ) {
					user = {
						id: orderNoVerif.id,
						externalId: null,
						username: null,
						email: orderNoVerif.email
					};
					this.generateJWT(user, ctx);
				}
				this.logger.info("orders.checkUserData() CUD - #3 user from order_no_verif cookie");

			} else if ( this.settings.orderTemp.user && 
				(
					(!ctx.meta.user || !ctx.meta.user._id ) && 
					(this.settings.orderTemp.user && this.settings.orderTemp.user.id != null)
				)
			) {
				// we don't have user, but it's set in order (eg. user logged out)
				this.logger.info("orders.checkUserData() CUD - #4 no user, but set in order");
				user = {
					id: null,
					externalId: null,
					username: null,
					email: null
				};
				this.settings.orderTemp.addresses.invoiceAddress = null;

			} else if ( ctx.meta.user && ctx.meta.user._id && ctx.meta.user._id.toString().trim()!="" ) {
				// regular user (registered & activated), logged in
				user = ctx.meta.user;
				user.id = user._id;
				delete user._id;
				this.logger.info("orders.checkUserData() CUD - #5 regular registered & activated user");
			}

			// set user
			this.logger.info("orders.checkUserData() CUD - result user", user);
			if ( user ) {
				this.settings.orderTemp.user = user;
				// user has to have id and email
				if ( !user.id || !user.email ) {
					this.logger.error("orders.checkUserData() user error - missing id or email");
					return false;
				}
			} else {
				return false;
			}

			// fields
			let requiredFields = ["email", "phone", "nameFirst", "nameLast", "street", "zip", "city", "country"];
			if ( ctx.meta.userID && ctx.meta.userID.toString().trim()!=="" ) {
				requiredFields = ["phone", "nameFirst", "nameLast", "street", "zip", "city", "country"];
			}
			// let optionalFileds = ["state", "street2"];
			let self = this;

			this.logger.info("orders.checkUserData() - this.settings.orderTemp.addresses:", this.settings.orderTemp.addresses);
			// check if invoice address set
			if ( !this.settings.orderTemp || !this.settings.orderTemp.addresses ||
			!this.settings.orderTemp.addresses.invoiceAddress ) {
				// no invoice address set, check if user is available
				if ( ctx.meta.user && ctx.meta.user.id && ctx.meta.user.addresses && ctx.meta.user.addresses.length>0 ) {
					// having user, try to get his invoice address
					let loggedUserInvoiceAddress = this.getUserAddress(ctx.meta.user, "invoice");
					this.logger.info("orders.checkUserData() - loggedUserInvoiceAddress:", loggedUserInvoiceAddress);
					if ( loggedUserInvoiceAddress ) {
						// set invoice address for order
						this.settings.orderTemp.addresses.invoiceAddress = loggedUserInvoiceAddress;
					} else {
						// no invoice address, can't get user invoice address
						this.settings.orderErrors.userErrors.push({"value": "Invoice address", "desc": "not set"});
						return false;
					}
				} else {
					// no user set, can't get user invoice address
					this.settings.orderErrors.userErrors.push({"value": "Invoice address", "desc": "not set"});
					return false;
				}
			}

			// split name
			if ( this.settings.orderTemp.addresses && this.settings.orderTemp.addresses.invoiceAddress ) {
				if ( this.settings.orderTemp.addresses.invoiceAddress.name && this.settings.orderTemp.addresses.invoiceAddress.name.indexOf(" ") ) {
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
					this.logger.error("orders.checkUserData() - invoice address not found");
					return false;
				}
			} else {
				this.settings.orderErrors.userErrors.push({"value": "Invoice address", "desc": "not set"});
				this.logger.error("orders.checkUserData() - invoice address not set");
				return false;
			}

			if (this.settings.orderErrors.userErrors.length>0) {
				this.logger.error("orders.checkUserData() - errors.length=="+this.settings.orderErrors.userErrors.length, this.settings.orderErrors);
				return false;
			}

			this.logger.info("orders.checkUserData() - user checked and is OK");
			return true;
		},


		/**
		 * Get user in context if possible.
		 * if user not found in context and his email is not used
		 * create new user, add him to ctx and return ctx
		 */
		manageUser(ctx) {
			let self = this;
			self.logger.info("order.manageUser() #0 - ctx.meta.user:", ctx.meta.user);

			if ( ctx.meta?.user && ctx.meta.user._id === undefined && ctx.meta.user.id !== undefined ) {
				ctx.meta.user._id = ctx.meta.user.id;
			}

			if ( ctx.meta.user?._id && ctx.meta.user._id.toString().trim()!="" ) {
				// user logged in
				self.logger.info("orders.manageUser() #1");
				return new Promise(function(resolve) {
					self.settings.orderTemp.user = ctx.meta.user;
					ctx.params.orderParams["user"] = ctx.meta.user;
					resolve(ctx);
				})
					.then( (oldCtx) => {
						return oldCtx;
					});

			} else if ( ctx.meta.cookies?.["order_no_verif"] ) {
				self.logger.info("orders.manageUser() #2");
				// if order temp user is set in cookie, use him
				return new Promise(function(resolve) {
					let orderNoVerif = jwt.decode(ctx.meta.cookies["order_no_verif"]);
					self.logger.info("orders.manageUser() #2 - orderNoVerif:", orderNoVerif);
					if ( orderNoVerif?.id && orderNoVerif.email ) {
						let user = {
							id: orderNoVerif.id,
							externalId: null,
							username: null,
							email: orderNoVerif.email
						};
						ctx.params.orderParams["user"] = user;
						self.settings.orderTemp["user"] = user;
						self.logger.info("orders.manageUser() #2 - 'order_no_verif' user:", user);
					}
					resolve(ctx);
				})
					.then( (oldCtx) => {
						return oldCtx;
					});

			} else { // user not set in meta data
				self.logger.info("orders.manageUser() #3");
				if ( ctx.params.orderParams?.addresses?.invoiceAddress.email ) {
					self.logger.info("orders.manageUser() #3 - checking user email");
					return ctx.call("users.checkIfEmailExists", {
						email: ctx.params.orderParams.addresses.invoiceAddress.email
					})
						.then((exists) => { // promise #1
							if (exists?.result?.emailExists) {
								self.logger.info("orders.manageUser() #3 - user email already exists");
								this.settings.orderErrors.orderErrors.push({"value": "email", "desc": "exists"});
								return ctx;
							} else {
								let userData = this.getDataToCreateUser(ctx);
								self.logger.info("orders.manageUser() #3 - users.create userData", userData);
								return ctx.call("users.create", { user: userData.user })
									.then(newUser => {  // promise #2
										// new user created, add his data to order and 
										// create special variable to process it with createOrderAction
										if ( newUser?.user?._id && newUser.user._id!="" ) {
											ctx.params.orderParams.user = {
												id: newUser.user._id,
												email: newUser.user.email,
												username: newUser.user.username,
												token: newUser.user.token
											};
											self.settings.orderTemp.user = ctx.params.orderParams.user;
											ctx.meta.userNew = true;
											self.logger.info("orders.manageUser() #3 - self.settings.orderTemp.user", self.settings.orderTemp.user);
										}
										return ctx;
									})
									.catch(userCreateRej => {
										self.logger.info("orders.manageUser() #3 - users.create error: ", userCreateRej);
										return ctx;
									});
							}
						})
						.catch(userFoundErr => {
							this.settings.orderErrors.userErrors.push({"value": "email", "desc": "exists"});
							self.logger.info("orders.manageUser() #3 - user email already exists", userFoundErr, this.settings.orderErrors.userErrors);
							return ctx;
						});
				} else {
					return new Promise(function(resolve) {
						resolve(ctx);
					})
						.then( (oldCtx) => {
							self.logger.info("orders.manageUser() #4 - user email not found - returning oldCtx");
							return oldCtx;
						});
				}
			}
		}

	}
};
