"use strict";

const { decode } = require("bysquare/pay");
const SettingsMixin = require("../../../mixins/settings.mixin");
const pricingMethods = require("../../../services/orders/methods/order-pricing.methods");
const bankTransferMethods = require("../../../services/orders/methods/bank-transfer.methods");
const {
	isBankTransferConfigured,
	publicBankAccount,
	usesPayBySquare,
	buildPaymentNote,
	variableSymbolFromOrderId,
	variableSymbolMatchesOrderId,
	buildEpcPayload,
	buildPayBySquarePayload,
	buildBankTransferQr,
	injectPaymentQr,
} = require("../../../modules/payments/bank-transfer-qr");

function bysquareHeader(payload) {
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUV";
	const c0 = alphabet.indexOf(payload[0]);
	const c1 = alphabet.indexOf(payload[1]);
	const byte0 = ((c0 & 31) << 3) | ((c1 >> 2) & 7);
	return { type: byte0 >> 4, version: byte0 & 15 };
}

const bankAccount = {
	iban: "SK89 7500 0000 0000 1234 5671",
	name: "StretchShop s.r.o.",
	bankName: "Big Bank S.A.",
	bankCode: "1234567890",
};

function businessFor(countryCode) {
	return {
		invoiceData: {
			company: {
				address: { countryCode, country: countryCode === "sk" ? "Slovakia" : "Germany" },
				bankAccount,
			},
		},
	};
}

function orderFor(amount) {
	return {
		_id: "ord-42",
		invoice: { id: "5123456789" },
		prices: {
			currency: { code: "EUR", symbol: "€" },
			priceTotal: amount,
			priceTotalToPay: amount,
		},
		data: {
			paymentData: { codename: "bank_transfer", paidAmountTotal: 0 },
		},
	};
}

describe("bank transfer QR", () => {
	it("requires every bank account field", () => {
		expect(isBankTransferConfigured(businessFor("sk"))).toBe(true);
		const missing = businessFor("sk");
		missing.invoiceData.company.bankAccount = { ...bankAccount, bankCode: "  " };
		expect(isBankTransferConfigured(missing)).toBe(false);
		expect(isBankTransferConfigured({})).toBe(false);
	});

	it("uses PAY by square for Slovakia and Czechia", () => {
		expect(usesPayBySquare(businessFor("sk"))).toBe(true);
		expect(usesPayBySquare(businessFor("cz"))).toBe(true);
		expect(usesPayBySquare(businessFor("de"))).toBe(false);
	});

	it("builds a payment note from order id, email and shop name", () => {
		expect(buildPaymentNote({
			orderId: "OBJ-77",
			email: "jožo.novák@exámple.com",
			shopName: "Môj obchod, s.r.o.",
		})).toBe("OBJ77 jozo.novak(at)example.com Moj obchod sro");

		expect(buildPaymentNote({
			orderId: "Ľ-100",
			email: "",
			shopName: "Rock & Roll",
		})).toBe("L100 Rock Roll");

		expect(buildPaymentNote({
			orderId: "   ",
			email: "a@b.co",
			shopName: "Shop",
		})).toBe("");

		const shop = "S".repeat(200);
		const note = buildPaymentNote({
			orderId: "A".repeat(10),
			email: "a@b.co",
			shopName: shop,
		});
		expect(note.length).toBe(140);
		expect(note.startsWith("AAAAAAAAAA a(at)b.co S")).toBe(true);
		expect(note.endsWith("S")).toBe(true);

		expect(buildPaymentNote({
			orderId: "B".repeat(150),
			email: "a@b.co",
			shopName: "Shop",
		})).toBe("B".repeat(140));
	});

	it("builds a 10-digit variable symbol that matches only its order id", () => {
		const orderId = "674A1C2E8F0B9D3A1C2E8F01";
		const symbol = variableSymbolFromOrderId(orderId);
		expect(symbol).toMatch(/^\d{10}$/);
		expect(variableSymbolFromOrderId(orderId.toLowerCase())).toBe(symbol);
		expect(variableSymbolMatchesOrderId(symbol, orderId)).toBe(true);
		expect(variableSymbolMatchesOrderId(String(Number(symbol)), orderId)).toBe(true);
		expect(variableSymbolMatchesOrderId(symbol, "674a1c2e8f0b9d3a1c2e8f02")).toBe(false);
		expect(variableSymbolMatchesOrderId("5123456789", orderId)).toBe(false);
		expect(variableSymbolFromOrderId("")).toBeUndefined();
		expect(variableSymbolFromOrderId("ord-42")).not.toBe(variableSymbolFromOrderId("ord-43"));
	});

	it("strips diacritics from the account name, bank name and payment note", () => {
		const business = businessFor("de");
		business.invoiceData.company.bankAccount = {
			...bankAccount,
			name: "ŠtretchŠop s.r.o.",
			bankName: "Československá obchodná banka",
		};
		expect(publicBankAccount(business)).toEqual({
			iban: bankAccount.iban,
			name: "StretchSop s.r.o.",
			bankName: "Ceskoslovenska obchodna banka",
			bankCode: bankAccount.bankCode,
		});

		const payload = buildEpcPayload({
			name: "Banská Bystrica",
			iban: "DE89370400440532013000",
			bic: "COBADEFFXXX",
			amount: 10,
			currency: "EUR",
			reference: "1",
			paymentNote: "Ľudovít Novák",
		});
		expect(payload.split("\n")[5]).toBe("Banska Bystrica");
		expect(payload.split("\n")[10]).toBe("Ludovit Novak");

		const decoded = decode(buildPayBySquarePayload({
			name: "Banská Bystrica",
			iban: "SK8975000000000012345671",
			bic: "",
			amount: 10,
			currency: "EUR",
			reference: "1",
			paymentNote: "Ľudovít Novák",
		}));
		expect(decoded.payments[0].beneficiary.name).toBe("Banska Bystrica");
		expect(decoded.payments[0].paymentNote).toBe("Ludovit Novak");
	});

	it("builds an EPC payload for other countries", () => {
		const payload = buildEpcPayload({
			name: "StretchShop s.r.o.",
			iban: "DE89370400440532013000",
			bic: "COBADEFFXXX",
			amount: 10.5,
			currency: "EUR",
			reference: "INV-100",
		});
		expect(payload.startsWith("BCD\n002\n1\nSCT\n")).toBe(true);
		expect(payload).toContain("DE89370400440532013000");
		expect(payload).toContain("EUR10.50");
		expect(payload).toContain("INV-100");
		const withNote = buildEpcPayload({
			name: "StretchShop s.r.o.",
			iban: "DE89370400440532013000",
			bic: "COBADEFFXXX",
			amount: 10.5,
			currency: "EUR",
			reference: "5123456789",
			paymentNote: "OBJ77 buyer@example.com StretchShop",
		});
		expect(withNote.split("\n")[10]).toBe("OBJ77 buyer(at)example.com StretchShop");
		expect(withNote.split("\n")[11]).toBe("OBJ77 buyer(at)example.com StretchShop");
	});

	it("renders a Slovak PAY by square SVG and an EPC SVG", async () => {
		const slovak = await buildBankTransferQr({
			order: orderFor(25.5),
			business: businessFor("sk"),
		});
		expect(slovak.standard).toBe("paybysquare");
		expect(slovak.svg.startsWith("<svg")).toBe(true);
		expect(slovak.bankAccount).toEqual({
			iban: "SK89 7500 0000 0000 1234 5671",
			name: "StretchShop s.r.o.",
			bankName: "Big Bank S.A.",
			bankCode: "1234567890",
		});

		const decodedPayment = decode(
			buildPayBySquarePayload({
				name: "StretchShop s.r.o.",
				iban: "SK8975000000000012345671",
				bic: "",
				amount: 25.5,
				currency: "EUR",
				reference: "5123456789",
			})
		);
		expect(decodedPayment.payments[0].amount).toBe(25.5);
		expect(decodedPayment.payments[0].variableSymbol).toBeUndefined();
		expect(decodedPayment.payments[0].paymentNote).toBe("5123456789");
		expect(decodedPayment.payments[0].bankAccounts[0].iban).toBe("SK8975000000000012345671");

		const orderId = "674A1C2E8F0B9D3A1C2E8F01";
		const notedPayload = buildPayBySquarePayload({
			name: "StretchShop s.r.o.",
			iban: "SK2683600000000012345671",
			bic: "BREXSKBX",
			amount: 25.5,
			currency: "EUR",
			reference: "5123456789",
			orderId,
			paymentNote: "OBJ77 buyer@example.com StretchShop",
		});
		expect(notedPayload.startsWith("00")).toBe(true);
		expect(bysquareHeader(notedPayload)).toEqual({ type: 0, version: 0 });
		const noted = decode(notedPayload);
		expect(noted.payments[0].variableSymbol).toBe(variableSymbolFromOrderId(orderId));
		expect(noted.payments[0].variableSymbol).not.toBe("5123456789");
		expect(noted.payments[0].bankAccounts[0].bic).toBe("BREXSKBX");
		expect(noted.payments[0].paymentNote).toBe("OBJ77 buyer@example.com StretchShop");

		const german = await buildBankTransferQr({
			order: orderFor(10),
			business: businessFor("de"),
		});
		expect(german.standard).toBe("epc");
		expect(german.svg.startsWith("<svg")).toBe(true);
	});

	it("encodes the shop BIC and the order-id variable symbol for the configured account", async () => {
		const business = require("../../../resources/settings/business.json");
		const QRCode = require("qrcode");
		let payload = "";
		const spy = jest.spyOn(QRCode, "toString").mockImplementation((value) => {
			payload = value;
			return Promise.resolve("<svg></svg>");
		});
		const orderId = "674a1c2e8f0b9d3a1c2e8f01";
		try {
			const result = await buildBankTransferQr({
				order: { ...orderFor(18), _id: orderId },
				business,
			});
			expect(result.standard).toBe("paybysquare");
			expect(payload.startsWith("00")).toBe(true);
			expect(bysquareHeader(payload)).toEqual({ type: 0, version: 0 });
			const account = business.invoiceData.company.bankAccount;
			const payment = decode(payload).payments[0];
			expect(payment.bankAccounts[0].iban).toBe(String(account.iban).replace(/\s/g, "").toUpperCase());
			expect(payment.bankAccounts[0].bic).toBe(String(account.bankCode).replace(/\s/g, "").toUpperCase());
			expect(payment.variableSymbol).toBe(variableSymbolFromOrderId(orderId));
			expect(variableSymbolMatchesOrderId(payment.variableSymbol, orderId.toUpperCase())).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});

	it("encodes the payment note into both QR standards", async () => {
		const previousSite = process.env.SITE_NAME;
		process.env.SITE_NAME = "Môj obchod, s.r.o.";
		const QRCode = require("qrcode");
		const payloads = [];
		const spy = jest.spyOn(QRCode, "toString").mockImplementation((payload) => {
			payloads.push(payload);
			return Promise.resolve("<svg></svg>");
		});
		const order = {
			...orderFor(12),
			externalCode: "OBJ-77",
			user: { email: "jožo.novák@exámple.com" },
		};
		try {
			const slovak = await buildBankTransferQr({ order, business: businessFor("sk") });
			const german = await buildBankTransferQr({ order, business: businessFor("de") });
			expect(slovak.standard).toBe("paybysquare");
			expect(german.standard).toBe("epc");
			expect(decode(payloads[0]).payments[0].paymentNote).toBe(
				"OBJ77 jozo.novak(at)example.com Moj obchod sro"
			);
			expect(payloads[1].split("\n")[10]).toBe("OBJ77 jozo.novak(at)example.com Moj obchod sro");
			expect(payloads[1].split("\n")[11]).toBe("OBJ77 jozo.novak(at)example.com Moj obchod sro");
		} finally {
			spy.mockRestore();
			if (previousSite === undefined) {
				delete process.env.SITE_NAME;
			} else {
				process.env.SITE_NAME = previousSite;
			}
		}
	});

	it("injects the QR at the invoice placeholder", async () => {
		const { svg } = await buildBankTransferQr({
			order: orderFor(8),
			business: businessFor("sk"),
		});
		const html = injectPaymentQr("<div><!-- payment_qr //--></div>", {
			data: { paymentData: { lastQr: svg } },
		});
		expect(html).toContain("width=\"160\"");
		expect(html).toContain("<svg");
		expect(html).not.toContain("<!-- payment_qr //-->");
		expect(injectPaymentQr("<div><!-- payment_qr //--></div>", {})).toBe("<div></div>");
	});

	it("serves a bank-transfer QR SVG only in development", async () => {
		const previousEnv = process.env.NODE_ENV;
		const order = orderFor(12);
		const ctx = {
			params: { orderId: order._id },
			meta: {},
		};
		const service = {
			adapter: {
				findById: jest.fn().mockResolvedValue(order),
			},
		};
		const handler = bankTransferMethods.actions.bankTransferQrDev.handler;
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue(businessFor("sk"));

		try {
			process.env.NODE_ENV = "production";
			await expect(handler.call(service, ctx)).rejects.toMatchObject({ code: 404, message: "Not found" });
			expect(service.adapter.findById).not.toHaveBeenCalled();

			process.env.NODE_ENV = "test";
			await expect(handler.call(service, ctx)).rejects.toMatchObject({ code: 404 });
			expect(service.adapter.findById).not.toHaveBeenCalled();

			process.env.NODE_ENV = "development";
			service.adapter.findById.mockResolvedValue(null);
			await expect(handler.call(service, ctx)).rejects.toMatchObject({ code: 404, message: "Not found" });

			service.adapter.findById.mockResolvedValue(order);
			const svg = await handler.call(service, ctx);
			expect(svg.startsWith("<svg")).toBe(true);
			expect(ctx.meta.$responseType).toBe("image/svg+xml; charset=utf-8");
			expect(service.adapter.findById).toHaveBeenCalledWith("ord-42");

			SettingsMixin.getSiteSettings.mockReturnValue({
				invoiceData: { company: { bankAccount: { iban: "SK1" } } },
			});
			await expect(handler.call(service, ctx)).rejects.toMatchObject({
				code: 422,
				message: "Bank account is not configured",
			});
		} finally {
			process.env.NODE_ENV = previousEnv;
			SettingsMixin.getSiteSettings.mockRestore();
		}
	});

	it("stores lastQr on the order and hides the method when the account is incomplete", async () => {
		const order = orderFor(15);
		const updates = [];
		const service = {
			logger: { error() {} },
			idToString: (id) => String(id),
			adapter: {
				updateById: (id, update) => {
					updates.push({ id, update });
					return Promise.resolve(order);
				},
			},
			...bankTransferMethods.methods,
		};
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue(businessFor("sk"));
		const saved = await service.generateBankTransferQr(order);
		expect(saved.data.paymentData.lastQr.startsWith("<svg")).toBe(true);
		expect(saved.data.paymentData.bankAccount.iban).toContain("SK89");
		expect(updates[0].update.$set["data.paymentData.lastQr"]).toBe(saved.data.paymentData.lastQr);

		const work = { orderTemp: { data: { paymentData: { codename: "online_stripe" } } } };
		const pricing = {
			settings: {
				order: {
					paymentMethods: [
						{ codename: "cod" },
						{ codename: "bank_transfer" },
						{ codename: "online_stripe" },
					],
				},
			},
			getOrderWork: () => work,
			...pricingMethods.methods,
		};
		SettingsMixin.getSiteSettings.mockReturnValue({
			invoiceData: { company: { bankAccount: { iban: "SK1", name: "", bankName: "B", bankCode: "1" } } },
		});
		pricing.getAvailablePayments({});
		expect(work.orderTemp.settings.paymentMethods.map((method) => method.codename)).toEqual([
			"cod",
			"online_stripe",
		]);
		SettingsMixin.getSiteSettings.mockRestore();
	});

	it("rejects a bank transfer order when the shop account is incomplete", () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			invoiceData: { company: { bankAccount: { iban: "SK1" } } },
			taxData: { global: { taxDecimal: 0.2, taxType: "VAT" } },
		});
		const work = {
			orderErrors: {},
			orderTemp: {
				items: [],
				prices: { priceItems: 10 },
				data: {
					deliveryData: null,
					paymentData: { codename: "bank_transfer" },
				},
			},
		};
		const service = {
			logger: { info() {}, error() {}, warn() {} },
			settings: {
				order: {
					paymentMethods: [{
						codename: "bank_transfer",
						name: { en: "Bank Transfer" },
						prices: [{ range: { from: 0, to: 1000 }, price: 0 }],
					}],
				},
			},
			getOrderWork: () => work,
			getOrderTypology: () => ({ types: [], subtypes: [] }),
			getProductTaxData: (product) => ({ ...product, taxData: {} }),
			countOrderPrices: () => {},
			...pricingMethods.methods,
		};
		expect(service.checkOrderData({})).toBe(false);
		expect(work.orderErrors.orderErrors).toEqual(expect.arrayContaining([
			{ value: "Payment type", desc: "bank account not configured" },
		]));
		SettingsMixin.getSiteSettings.mockRestore();
	});
});
