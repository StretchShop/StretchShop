"use strict";

const OrderMethodsCreate = require("./order-create.methods");
const OrderMethodsUser = require("./order-user.methods");
const OrderMethodsPricing = require("./order-pricing.methods");
const OrderMethodsFlow = require("./order-flow.methods");
const OrderMethodsFulfillment = require("./order-fulfillment.methods");
const OrderMethodsPayment = require("./order-payment.methods");

module.exports = {
	mixins: [
		OrderMethodsCreate,
		OrderMethodsUser,
		OrderMethodsPricing,
		OrderMethodsFlow,
		OrderMethodsFulfillment,
		OrderMethodsPayment
	]
};
