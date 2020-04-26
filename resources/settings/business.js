"use strict";

module.exports = {
	invoiceData: {
		eshop: {
			numberCodePrefix: "5"
		},
		company: {
			name: "StretchShop s.r.o.",
			address: {
				street: "Internátna 32",
				city: "Banská Bystrica",
				zip: "97404",
				country: "Slovakia",
				countryCode: "sk"
			},
			orgId: "12345678",
			taxId: "9876543210",
			taxVatId: "SK9876543210",
			registration: "Okresný súd Banská Bystrica, Vložka číslo: 38180/S",
			account: {
				bank: "Bank Bank",
				iban: "SK 1234567890123456789012",
				swift: "BREXSKXY",
				number: "123456 - 1234567890 / 1234"
			},
			contacts: {
				phone: "+012 987 654 321",
				email: "support@stretchshop.app",
				web: "https://stretchshop.app/"
			}
		}
	}, 
	taxData: {
		global: {
			taxDecimal: 0.2, // 
			taxType: "VAT" // VAT - tax included in price, IT - tax not included
		}
	}
};
