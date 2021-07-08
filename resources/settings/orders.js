"use strict";
require("dotenv").config();

module.exports = {
	sendingOrder: {
		url: process.env.SENDING_ORDER_URL,
		port: process.env.SENDING_ORDER_PORT,
		login: process.env.SENDING_ORDER_LOGIN,
		password: process.env.SENDING_ORDER_PWD
	},
	deliveryMethods: [
		{
			codename: "personaly",
			type: "physical", // use if cart has ALSO physical product
			name: {
				"en": "Personaly on Branch",
				"sk": "Osobne na Pobočke"
			},
			prices: [
				{
					"range": {"from": 0, "to": 1000000},
					"price": 0,
					"tax": 0.2
				}
			]
		},
		{
			codename: "courier",
			type: "physical", // use if cart has ALSO physical product
			name: {
				"en": "Courier",
				"sk": "Kuriér"
			},
			prices: [
				{
					"range": {"from": 0, "to": 500},
					"price": 5,
					"tax": 0.2
				},
				{
					"range": {"from": 500, "to": 1000000},
					"price": 0
				}
			]
		},
		{
			codename: "download",
			type: "digital", // use if cart has ALSO physical product
			name: {
				"en": "Download",
				"sk": "Stiahnuť"
			},
			prices: [
				{
					"range": {"from": 0, "to": 500},
					"price": 5,
					"tax": 0.2
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
			type: "physical", // show if cart has ONLY the physical products
			name: {
				"en": "Cash On Delivery",
				"sk": "Platba Pri Doručení"
			},
			prices: [
				{
					"range": {"from": 0, "to": 500},
					"price": 10,
					"tax": 0.2
				},
				{
					"range": {"from": 500, "to": 1000000},
					"price": 2,
					"tax": 0.2
				}
			]
		},
		{ // show if cart has any subtype of products
			codename: "online_paypal_paypal",
			name: {
				"en": "Pay online with Paypal (Card, PayPal)",
				"sk": "Zaplatiť online cez Paypal (Karta, PayPal)",
			},
			prices: [
				{
					"range": {"from": 0, "to": 500},
					"price": 2,
					"tax": 0.2
				},
				{
					"range": {"from": 500, "to": 1000000},
					"price": 0
				}
			]
		},
		{ // show if cart has any subtype of products
			codename: "online_stripe",
			name: {
				"en": "Pay online with Stripe (Card, PayPal)",
				"sk": "Zaplatiť online cez Stripe (Karta, PayPal)",
			},
			prices: [
				{
					"range": {"from": 0, "to": 500},
					"price": 2,
					"tax": 0.2
				},
				{
					"range": {"from": 500, "to": 1000000},
					"price": 0
				}
			]
		}
	],
	availablePaymentActions: [
		"paypalOrderGeturl",
		"paypalResult",
		"paypalWebhook",
		"stripeOrderPaymentintent",
		"stripeWebhook"
	]
};
