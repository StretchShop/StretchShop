"use strict";

module.exports = {
	lang: "en",
	langs: [
		{ code: "sk", longCode: "sk-SK", name: "Slovenčina" },
		{ code: "en", longCode: "en-US", name: "English" }
	],
	country: "sk",
	countries: [
		{ code: "sk", name: "Slovakia" },
		{ code: "us", name: "USA" }
	],
	currency: "EUR", // currency codes only in internationaly accepted format, that is accepted by PayPal
	currencies: [
		{ code: "EUR", symbol: "€", ratio: 1 },
		{ code: "USD", symbol: "$", ratio: 1.1 }
	]
};
