"use strict";

const sppf = require("../mixins/subproject.helper");
const resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../resources");
const businessSettings = require( resourcesDirectory+"/settings/business");

module.exports = {
	methods: {

		// READ functions
		/**
		 * Check if user is valid according to ./resources/settings/business.js
		 * compare to its array priceLevels.validTypes.userTypes
		 * @param {*} usertype 
		 */
		isValidUsertype(usertype) {
			if (businessSettings && businessSettings.priceLevels && 
				businessSettings.priceLevels.validTypes && 
				businessSettings.priceLevels.validTypes.userTypes && 
				businessSettings.priceLevels.validTypes.userTypes.indexOf(usertype)>-1 
			) {
				return true;
			}
			return false;
		},
		
		/**
		 * Get price for specific user
		 * @param {*} product 
		 * @param {*} user 
		 */
		priceByUser(product, user) {
			delete product.activity;

			if ( user && user!=null && user.type && user.type!=null && 
				user.subtype && user.subtype!=null && 
				this.isValidUsertype(user.type+"."+user.subtype) ) {
				// product - get price by user type & subtype
				if ( product.priceLevels && product.priceLevels[user.type] && 
				product.priceLevels[user.type][user.subtype] && 
				product.priceLevels[user.type][user.subtype]["price"] ) {
					product.price = product.priceLevels[user.type][user.subtype]["price"];
					delete product.priceLevels;
				}
			}
			
			return product;
		},


		/**
		 * Get price string for correct price list - specific for user
		 * @param {*} user 
		 */
		getPriceVariable(user) {
			user = (typeof user !== "undefined") ?  user : null;
			let sortName = "price";

			if ( user && user!=null && user.type && user.type!=null && 
				user.subtype && user.subtype && user.subtype!=null && 
				this.isValidUsertype(user.type+"."+user.subtype) ) {
				// stirng of correct name for sorting by price with price levels
				sortName = "priceLevels."+user.type+"."+user.subtype;
			}
			return sortName;
		},


		/**
		 * Add price level variables to product
		 * 
		 * @param {*} product 
		 * @param {boolean} recalculate 
		 * 
		 * @returns {*} product
		 */
		makeProductPriceLevels(product, recalculate) {
			recalculate = (typeof recalculate !== "undefined") ?  recalculate : false;
			let newPriceLevels = {};

			if (businessSettings && businessSettings.priceLevels && 
				businessSettings.priceLevels.validTypes.userTypes && 
				businessSettings.priceLevels.validTypes.userTypes.length>0 ) {

				// loop usertypes of product
				businessSettings.priceLevels.validTypes.userTypes.forEach((usertype) => {
					let usertypes = usertype.split(".");

					if ( !product.priceLevels ) {
						product.priceLevels = {};
					}
					if (newPriceLevels[usertypes[0]]) {
						newPriceLevels[usertypes[0]] = {};
					}

					// get price level value if not set
					// means: 
					//  - it is EITHER forced recalculation
					// 	OR
					//  - usertype is not set OR is null
					if ( 
						!recalculate || 
						(						
							!product.priceLevels[usertypes[0]] || 
							!product.priceLevels[usertypes[0]][usertypes[1]] || 
							product.priceLevels[usertypes[0]][usertypes[1]]==null
						) 
					) {
						// recalculate it, force new values
						newPriceLevels[usertypes[0]] = {};
						newPriceLevels[usertypes[0]][usertypes[1]] = {
							type: "calculated",
							price: this.calculatePriceForUsertype(product.price, usertype)
						};
					} else {
						// use existing values
						newPriceLevels[usertypes[0]][usertypes[1]] = product.priceLevels[usertypes[0]][usertypes[1]];
						if (!newPriceLevels[usertypes[0]][usertypes[1]]["type"] || 
						newPriceLevels[usertypes[0]][usertypes[1]]["type"]!=null) {
							newPriceLevels[usertypes[0]][usertypes[1]]["type"] = "defined";
						}
					}
				});

				// finish setting price levels
				if ( newPriceLevels === {} ) {
					// if no price levels set, log an error
					this.logger.error("No priceLevels for product.id: " + product.id);
				} else {
					// set price levels from created newPriceLevels
					product.priceLevels = newPriceLevels;
				}
			}

			return product;
		},

		/**
		 * Calculate price for usertype based on settings in
		 * /resources/settings/business.js
		 * @param {*} price 
		 * @param {*} usertype 
		 */
		calculatePriceForUsertype(price, usertype) {
			if (this.isValidUsertype(usertype) && businessSettings && 
			businessSettings.priceLevels && businessSettings.priceLevels.discounts &&
			businessSettings.priceLevels.discounts[usertype]) {
				let discount = businessSettings.priceLevels.discounts[usertype];
				if (discount && discount.type && discount.value) {
					// define if value should be + or - of the price
					let valueNegative = true; // remove from price
					if (discount.value>0) {
						valueNegative = false; // add to price
					}
					// calculate new price based on type and value
					switch (discount.type) {
					case "percent":
						if (valueNegative) {
							price = price - (price * (Math.abs(discount.value)/100));
						} else {
							price = price + (price * (Math.abs(discount.value)/100));
						}
						// price cannot be less < 0
						if (price<0) { price = 0; }
						break;
					case "amount":
						if (valueNegative) {
							price = price - Math.abs(discount.value);
						} else {
							price = price + Math.abs(discount.value);
						}
						// price cannot be less < 0
						if (price<0) { price = 0; }
						break;
					}
				}
			}
			return price;
		},


		addUsertypePriceLevel(usertype) {
			if (usertype && this.isValidUsertype(usertype)) {
				// add that price level from all products
			}
		},
		removeUsertypePriceLevel(usertype) {
			if (usertype && this.isValidUsertype(usertype)) {
				// remove that price level from all products
			}
		},

		rebuildPriceLevels() {
			// add price to price levels
		},

		setPricesByUserDiscount(usertype) {
			if (usertype && this.isValidUsertype(usertype)) {
				// get user price
			}
		}

	}
};