"use strict";

const jwt	= require("jsonwebtoken");

const sppf = require("../../../mixins/subproject.helper");
let resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../../resources");
const businessSettings = require( resourcesDirectory+"/settings/business");


module.exports = {
	methods: {

		/**
		 * Generate a JWT token from user entity
		 *
		 * @param {Object} user
		 */
		generateJWT(user, ctx) { //
			const today = new Date();
			const exp = new Date(today);
			exp.setDate(today.getDate() + 60);

			const generatedJwt = jwt.sign({
				id: user.id,
				email: user.email,
				exp: Math.floor(exp.getTime() / 1000)
			}, this.settings.JWT_SECRET);

			if ( ctx.meta.cookies ) {
				if (!ctx.meta.makeCookies) {
					ctx.meta.makeCookies = {};
				}
				ctx.meta.makeCookies["order_no_verif"] = {
					value: generatedJwt,
					options: {
						path: "/",
						signed: true,
						expires: exp,
						secure: ((process.env.COOKIES_SECURE && process.env.COOKIES_SECURE==true) ? true : false),
						httpOnly: true
					}
				};
				if ( process.env.COOKIES_SAME_SITE ) {
					ctx.meta.makeCookies["order_no_verif"].options["sameSite"] = process.env.COOKIES_SAME_SITE;
				}
			}

			return;
		},



		/**
		 * Prepare values for template (eg. invoice PDF) 
		 * that need to be extracted or generated - eg. localized strings, numbers, ...
		 * 
		 * @param {*} data 
		 */
		prepareDataForTemplate(data) {
			let lang = data.order.lang.code;
			data.order.data.paymentData.nameReady = data.order.data.paymentData.name[lang];
			// let taxItemsTotal = 
			for(let i=0; i<data.order.items.length; i++) {
				data.order.items[i] = this.getProductTaxData(
					data.order.items[i], 
					businessSettings.taxData.global
				);
				data.order.items[i].nameReady = data.order.items[i].name[lang];
				data.order.items[i].itemTotal = data.order.items[i].taxData.priceWithTax * data.order.items[i].amount;
			}
			// reformat dates
			Object.keys(data.order.dates).forEach(function(key) {
				if ( data.order.dates[key] instanceof Date ) {
					data.order.dates[key] = data.order.dates[key].toISOString();
				}
			});
			// set delivery types
			let deliveryDataCodenames = {};
			let deliveryDataReady = [];
			if ( data.order.data.deliveryData.codename.physical ) {
				deliveryDataCodenames[data.order.data.deliveryData.codename.physical.value] = data.order.data.deliveryData.codename.physical.price;
			}
			if ( data.order.data.deliveryData.codename.digital ) {
				deliveryDataCodenames[data.order.data.deliveryData.codename.digital.value] = data.order.data.deliveryData.codename.digital.price;
			}
			Object.keys(data.order.settings.deliveryMethods).forEach(function(key) {
				// check if delivery codename exists in order
				if ( data.order.settings.deliveryMethods[key].codename && 
					deliveryDataCodenames[data.order.settings.deliveryMethods[key].codename] ) {
					let deliveryDataRow = {
						name: data.order.settings.deliveryMethods[key].name[lang],
						price: deliveryDataCodenames[data.order.settings.deliveryMethods[key].codename]
					};
					deliveryDataReady.push(deliveryDataRow);
				}
			});
			data.order.data["deliveryDataReady"] = deliveryDataReady;
			// set payment name
			data.order.data.paymentData.nameReady = data.order.data.paymentData.name[lang];
			// return updated order data
			return data;
		},


		/**
		 * Removing _id and wrapping into "$set"
		 * 
		 * @param {*} object 
		 */
		prepareForUpdate(object) {
			let objectToSave = JSON.parse(JSON.stringify(object));
			if ( typeof objectToSave._id !== "undefined" && objectToSave._id ) {
				delete objectToSave._id;
			}
			return { "$set": objectToSave };
		},


	}
};
