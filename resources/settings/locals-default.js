"use strict";

module.exports = {
	lang: "en",
	langs: [
		{ code: "sk", longCode: "sk-SK", name: "Slovenčina" },
		{ code: "en", longCode: "en-US", name: "English" }
	],
	country: "sk",
	countries: [
		{ 
			"name": "Slovakia", 
			"code": "sk" 
		},
		{
			"name":"Czechia",
			"code":"cz"
		},
		{
			"name":"Austria",
			"code":"at"
		},
		{
			"name":"Hungary",
			"code":"hu"
		},
		{
			"name":"United States of America",
			"code":"us"
		},
	],
	currency: "EUR", // currency codes only in internationaly accepted format, that is accepted by PayPal
	currencies: [
		{ code: "EUR", symbol: "€", ratio: 1 },
		{ code: "USD", symbol: "$", ratio: 1.1 }
	]
};
