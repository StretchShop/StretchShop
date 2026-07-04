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
		checkOrderData() {
			this.settings.orderErrors.orderErrors = [];
			let self = this;
			const businessSettings = SettingsMixin.getSiteSettings('business');

			// get order item types and subtypes - orderCalcItemsTypology
			let orderCalcItemsTypology = { types: [], subtypes: [] };
			this.settings.orderTemp.items.some(function(product){
				// check if type not in array
				if ( product?.type && !calcExcludedTypes.includes(product.type) ) {
					if ( orderCalcItemsTypology.types.indexOf(product.type)===-1 ) {
						orderCalcItemsTypology.types.push(product.type);
					}
					// check if subtype not in array
					if ( product?.subtype && orderCalcItemsTypology.subtypes.indexOf(product.subtype)===-1 ) {
						orderCalcItemsTypology.subtypes.push(product.subtype);
					}
				}
			});
			Object.keys(this.settings.orderTemp.data.deliveryData?.codename || {}).forEach(function(key){
				if ( !orderCalcItemsTypology.subtypes.includes(key) ) {
					delete self.settings.orderTemp.data.deliveryData.codename[key];
				}
			});

			const orderTypology = self.getOrderTypology(self.settings.orderTemp);

			/**
			 * Check received delivery data:
			 * 1. loop received delivery types (digital, physical)
			 * 2. check if delivery type is in shop settings
			 * 3. get price for that type
			 * 4. if some type is missing in orderCalcItemsTypology.subtypes, return false
			 */
			// check if delivery type is set
			if ( this.settings?.orderTemp?.data?.deliveryData?.codename ) {
				let deliveryType = {...this.settings.orderTemp.data.deliveryData.codename};
				this.settings.orderTemp.data.deliveryData = { "codename": deliveryType };
				let deliveryMethodExists = false;
				let processedDeliveryMethodCodenames = [];
				self.settings.orderTemp.prices.priceDelivery = 0;
				self.settings.orderTemp.prices.priceDeliveryTaxData = null;

				// go through delivery types of order (like physical, digital, ...)
				Object.keys(deliveryType).forEach(function(typeKey){
					// check if delivery type has values
					if (deliveryType[typeKey] !== null) {
						// loop delivery types of this shop
						self.settings.order.deliveryMethods.some(function(shopDeliveryType){
							if ( !deliveryType[typeKey].value ) {
								let valueTemp = deliveryType[typeKey];
								deliveryType[typeKey] = { value: valueTemp };
							}
							if ( shopDeliveryType && shopDeliveryType.codename == deliveryType[typeKey].value ) {
								// delivery type exists in shop settings
								self.settings.orderTemp.data.deliveryData.codename[typeKey] = {};
								// need to filter language later
								self.settings.orderTemp.data.deliveryData.codename[typeKey].value = shopDeliveryType.codename;
								self.logger.info("orders.checkOrderData() - shopDeliveryType: ", shopDeliveryType);
								// count item prices to get total for getting delivery price
								self.settings.orderTemp.prices.priceItems = 0;
								// get delivery price specific to type of product (physical, digital, ...)
								// first count total prices for that specific type of items, to get valid price
								const priceItemsCheck = self.countOrderPrices("items", shopDeliveryType.type, self.settings.orderTemp); // shopDeliveryType.codename = digital, physical, ...
								// then get delivery price for that type and total items price
								if ( priceItemsCheck?.prices?.priceItems > 0 ) {
									// get delivery price for that specific type and items total
									shopDeliveryType.prices.some(function(deliveryPrice){
										if ( priceItemsCheck?.prices?.priceItems >= deliveryPrice.range.from && priceItemsCheck?.prices?.priceItems < deliveryPrice.range.to ) {
											// have match - set the delivery price
											self.settings.orderTemp.prices.priceDelivery += deliveryPrice.price;
											let deliveryProduct = {
												price: deliveryPrice.price,
												tax: deliveryPrice.tax
											};
											deliveryProduct = self.getProductTaxData(deliveryProduct, businessSettings.taxData.global);
											if ( self.settings.orderTemp.prices.priceDeliveryTaxData == null) {
												self.settings.orderTemp.prices.priceDeliveryTaxData = deliveryProduct.taxData;
												self.logger.error("Option #1", self.settings.orderTemp.prices.priceDeliveryTaxData, deliveryProduct.taxData);
											} else {
												self.settings.orderTemp.prices.priceDeliveryTaxData.priceWithTax += deliveryProduct.taxData.priceWithTax;
												self.settings.orderTemp.prices.priceDeliveryTaxData.priceWithoutTax += deliveryProduct.taxData.priceWithoutTax;
												self.settings.orderTemp.prices.priceDeliveryTaxData.tax += deliveryProduct.taxData.tax;
											}
											self.settings.orderTemp.data.deliveryData.codename[typeKey].price = deliveryPrice.price;
											self.settings.orderTemp.data.deliveryData.codename[typeKey].taxData = deliveryProduct.taxData;
											// add this (physical, digital) to processed delivery methods
											if ( processedDeliveryMethodCodenames.indexOf(shopDeliveryType.type)==-1 ) {
												processedDeliveryMethodCodenames.push(shopDeliveryType.type);
											}
											return true;
										}
									});
								}
								deliveryMethodExists = true;
								return true;
							}
						});
					}
				});
				self.countOrderPrices("items");

				// 4. check if no received delivery method is missing for ordered items
				if (deliveryMethodExists && processedDeliveryMethodCodenames) {
					if ( processedDeliveryMethodCodenames.length>0 ) {
						// loop typology to see if nothing is missing
						let typeMissing = false;
						orderCalcItemsTypology.subtypes.some(function(type){
							if ( processedDeliveryMethodCodenames.indexOf(type)==-1 ) {
								typeMissing = true;
								return false;
							}
						});
						if ( typeMissing ) {
							deliveryMethodExists = false;
							this.logger.error("order.checkOrderData() - delivery type missing");
							this.settings.orderErrors.orderErrors.push({"value": "Deliverry type", "desc": "not found"});
						}
					} else {
						deliveryMethodExists = false;
						this.logger.error("order.checkOrderData() - delivery types not processed");
						this.settings.orderErrors.orderErrors.push({"value": "Deliverry type", "desc": "not found"});
					}
				}

				if (!deliveryMethodExists && !orderTypology.types.includes("subscription")) {
					this.logger.error("order.checkOrderData() - delivery type not exist");
					this.settings.orderErrors.orderErrors.push({"value": "Deliverry type", "desc": "not found"});
				}
			} else {
				this.logger.error("order.checkOrderData() - delivery type not set");
				this.settings.orderErrors.orderErrors.push({"value": "Deliverry type", "desc": "not set"});
			}

			// check if payment type is set
			if ( this.settings.orderTemp.data.paymentData && this.settings.orderTemp.data.paymentData.codename ) {
				let paymentType = this.settings.orderTemp.data.paymentData.codename;
				this.settings.orderTemp.data.paymentData = { "codename": paymentType };
				let paymentMethodExists = false;
				let selectedPaymentMethod = null;

				// check if payment method is set in shop order.js settings
				this.settings.order.paymentMethods.some(function(shopPaymentType){
					if ( shopPaymentType && shopPaymentType.codename==paymentType ) {
						// payment method is valid - store its data for later
						selectedPaymentMethod = paymentType;
						// need to filter language later
						self.settings.orderTemp.data.paymentData.name = shopPaymentType.name;
						self.logger.info("orders.checkOrderData() - shopPaymentType ITEMS LAST: ", shopPaymentType);
						//--
						if ( self.settings.orderTemp.prices.priceItems <= 0 ) {
							self.countOrderPrices("items");
						}
						shopPaymentType.prices.some(function(paymentPrice){
							if ( self.settings.orderTemp.prices.priceItems>=paymentPrice.range.from && self.settings.orderTemp.prices.priceItems<paymentPrice.range.to ) {
								// have match set the payment price
								self.settings.orderTemp.prices.pricePayment = paymentPrice.price;
								let paymentProduct = {
									price: paymentPrice.price,
									tax: paymentPrice.tax
								};
								paymentProduct = self.getProductTaxData(paymentProduct, businessSettings.taxData.global);
								self.settings.orderTemp.prices.pricePaymentTaxData = paymentProduct.taxData;
								self.settings.orderTemp.data.paymentData.price = paymentPrice.price;
								self.settings.orderTemp.data.paymentData.taxData = paymentProduct.taxData;
								return true;
							}
						});
						paymentMethodExists = true;
						return true;
					}
				});

				// check if payment method is valid to items
				if (paymentMethodExists && selectedPaymentMethod && selectedPaymentMethod.type) {
					// type is set, that means it's limited only to specific subtype
					// check if payment type restriction IS in itemsTypology.subtypes
					// if there are more product types in order and this one specific is there, this payment method cannot be used
					if ( itemsTypology.subtypes.length>1 && itemsTypology.subtypes.indexOf(selectedPaymentMethod.type)>-1 ) {
						paymentMethodExists = false;
						this.settings.orderErrors.orderErrors.push({"value": "Payment type", "desc": "not valid"});
					}
				}

				if (!paymentMethodExists) {
					this.settings.orderErrors.orderErrors.push({"value": "Payment type", "desc": "not found"});
				}
			} else {
				this.settings.orderErrors.orderErrors.push({"value": "Payment type", "desc": "not set"});
			}

			if ( this.settings.orderErrors.orderErrors.length>0 ) {
				return false;
			} else {
				this.countOrderPrices("totals");
			}
			return true;
		},


		/**
		 * Count cart items total price and order total prices
		 */
		countOrderPrices(calculate, specification, order) {
			this.logger.warn("orders.countOrderPrices() - PARAMS: ", calculate, specification, typeof order !== undefined);

			const calcTypes = ["all", "items", "totals"];
			calculate = (typeof calculate !== "undefined" && calcTypes.includes(calculate)) ?  calculate : "all";
			specification = typeof specification === "undefined" ?  null : specification;

			const businessSettings = SettingsMixin.getSiteSettings('business');
			
			let orderFromParam = true;
			if ( typeof order == "undefined" ) {
				order = this.settings.orderTemp;	
				orderFromParam = false;
			}

			let self = this;
			// use default VAT if not custom eg. for product
			let tax = businessSettings.taxData.global.taxDecimal || self.settings.defaultConstants.tax;

			// prices of items
			if ( calculate=="all" || calculate=="items" ) {
				if ( !order.prices ) {
					order.prices = {};
				}
				order.prices = {
					...order.prices,
					...{
						priceItems: 0,
						priceItemsNoTax: 0,
						priceItemsTax: 0,
						priceTotal: 0,
						priceTotalNoTax: 0,
						priceTaxTotal: 0,
						priceDelivery: 0,
						priceDeliveryTaxData: null,
						pricePayment: 0,
						pricePaymentTaxData: null,
						priceSubsFirstPayTotal: 0
					}
				};
				order.items
					.filter(function(item){
						// if specification is set items are filtered for calculation by subtype - eg. only digital items
						if (specification && specification !== null) {
							self.logger.error("orders.countOrderPrices() - specification set but empty: ", specification);
							return [item.type, item.subtype].includes(specification);
						} else { // otherwise all items except subscriptions, but first count subscriptions separately
							let subsFirstPriceTotal = 0;
							order.items.filter(function(subItem){
								if ( [subItem.type, subItem.subtype].some((i) => i==="subscription") ) {
									subsFirstPriceTotal += subItem.price;
								}
							});
							order.prices.priceSubsFirstPayTotal = self.formatPrice(subsFirstPriceTotal);
							return ![item.type, item.subtype].some((i) => calcExcludedTypes.includes(i));
						}
					})
					.forEach(function(value){
						if ( value.taxData ) {
							order.prices.priceItems += value.taxData.priceWithTax * value.amount;
							if ( value.tax && value.tax!=null ) {
								tax = value.tax;
							}
							order.prices.priceItemsNoTax += value.taxData.priceWithoutTax * value.amount;
							order.prices.priceTaxTotal += value.taxData.tax * value.amount;
						} else {
							order.prices.priceItems += (value.price * value.amount);
							if ( value.tax && value.tax!=null ) {
								tax = value.tax;
							}
							let priceNoTax = value.price / (1 + tax);
							order.prices.priceItemsNoTax += priceNoTax;
							let taxOnly = value.price / (1 + tax);
							order.prices.priceTaxTotal += taxOnly;
						}
					});
				order.prices.priceItems = this.formatPrice(order.prices.priceItems);
				order.prices.priceItemsNoTax = this.formatPrice(order.prices.priceItemsNoTax);
				order.prices.priceItemsTax = this.formatPrice(order.prices.priceTaxTotal);
				if ( calculate=="items" ) { // format only if calculate items
					order.prices.priceTaxTotal = this.formatPrice(order.prices.priceTaxTotal);
				}
			}

			// count other totals
			if ( calculate=="all" || calculate=="totals" ) {
				tax = businessSettings.taxData.global.taxDecimal || self.settings.defaultConstants.tax;
				// price and tax of delivery
				let priceDeliveryNoTax = order.prices.priceDelivery / (1 + tax);
				let priceDeliveryTax = order.prices.priceDelivery * tax;
				if ( order.prices.priceDeliveryTaxData ) {
					priceDeliveryNoTax = order.prices.priceDeliveryTaxData.priceWithoutTax;
					priceDeliveryTax = order.prices.priceDeliveryTaxData.tax;
				}
				// price and tax of delivery
				let pricePaymentNoTax = order.prices.pricePayment / (1 + tax);
				let pricePaymentTax = order.prices.pricePayment * tax;
				if ( order.prices.pricePaymentTaxData ) {
					pricePaymentNoTax = order.prices.pricePaymentTaxData.priceWithoutTax;
					pricePaymentTax = order.prices.pricePaymentTaxData.tax;
				}
				// tax total with tax for delivery and payment
				order.prices.priceTaxTotal += priceDeliveryTax + pricePaymentTax;
				// price total without tax
				order.prices.priceTotalNoTax = order.prices.priceItemsNoTax +
					priceDeliveryNoTax + pricePaymentNoTax;
				console.log(" priceTotalNoTax: ", order.prices.priceTotalNoTax, order.prices.priceItemsNoTax, priceDeliveryNoTax, pricePaymentNoTax);
				order.prices.priceTotalNoTax = this.formatPrice(order.prices.priceTotalNoTax);
				console.log(" priceTaxTotal Formated: ", order.prices.priceTaxTotal);
				// total with tax, delivery and payment
				// total for IT tax
				if ( businessSettings.taxData.global.taxType==="IT" ) {
					order.prices.priceTotal = order.prices.priceItems +
						order.prices.priceDelivery +
						order.prices.pricePayment + 
						order.prices.priceTaxTotal;
					console.log(" priceTotal IT: ", order.prices.priceTotal, order.prices.priceItems, order.prices.priceDelivery, order.prices.pricePayment, order.prices.priceTaxTotal);
				} else {
					// total for VAT tax
					order.prices.priceTotal = order.prices.priceItems +
						order.prices.priceDelivery +
						order.prices.pricePayment;
				}
				console.log(" priceTotal: ", order.prices.priceTotal, order.prices.priceItems, order.prices.priceDelivery, order.prices.pricePayment);
				order.prices.priceTotal = this.formatPrice(order.prices.priceTotal);
				console.log(" priceTotal Formated: ", order.prices.priceTotal);
			}
			this.logger.warn("orders.countOrderPrices() - order.prices: ", calculate, specification, typeof order !== undefined, order.prices);

			if (orderFromParam) {
				return order;
			} else {
				this.settings.orderTemp = order;
			}
		},


		/**
		 * Check if user confirmed order
		 */
		checkConfirmation() {
			this.logger.info("orders.checkConfirmation:", { userConfirmation: this.settings.orderTemp.dates.userConfirmation, now: Date.now() } );
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
			if ( typeof this.settings.orderTemp.settings == "undefined" ) {
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

			this.logger.info("orders.getAvailableDeliveries() - orders.getAvailableDeliveries.usedProductTypes:", usedProductTypes);

			if ( usedProductTypes.length>0 ) {
				if ( typeof this.settings.orderTemp.settings == "undefined" ) {
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
			if ( typeof this.settings.orderTemp.settings === "undefined" ) {
				this.settings.orderTemp.settings = {};
			}
			this.settings.orderTemp.settings.paymentMethods = this.settings.order.paymentMethods;
			if (this.settings.orderTemp.data && this.settings.orderTemp.data.paymentData && 
				this.settings.orderTemp.data.paymentData.codename && 
				this.settings.orderTemp.data.paymentData.codename.indexOf("online_stripe") > -1
			) {
				this.settings.orderTemp.settings.stripeKey = process.env.STRIPE_PUBLISHABLE_KEY;
			}
		}

	}
};
