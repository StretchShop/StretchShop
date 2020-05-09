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
			type: "physical",
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
			type: "physical",
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
			type: "digital",
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
			type: "product",
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
		{
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
		}
	]
};
