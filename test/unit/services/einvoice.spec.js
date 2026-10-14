"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const einvoice = require("../../../modules/einvoice");
const { authHeaders } = require("../../../modules/einvoice/send");

function business(extra = {}) {
	return {
		invoiceData: {
			company: {
				name: "StretchShop s.r.o.",
				address: {
					street: "Internátna 32",
					city: "Banská Bystrica",
					zip: "97404",
					countryCode: "sk"
				},
				orgId: "12345678",
				taxId: "9876543210",
				taxVatId: "SK9876543210",
				registration: "Okresný súd",
				contacts: {
					phone: "+421900000000",
					email: "support@stretchshop.app"
				},
				account: {
					bank: "Tatra banka",
					iban: "SK12 3456 7890 1234",
					swift: "TATRSKBX"
				},
				...extra
			}
		}
	};
}

function order(overrides = {}) {
	return {
		_id: "ord-1",
		externalCode: "ORD-100",
		lang: { code: "en" },
		invoice: { id: "5202610001" },
		user: { id: "user1", email: "buyer@example.com" },
		dates: {
			dateInvoiceIssued: "2026-10-01T00:00:00.000Z",
			datePaid: "2026-10-01T12:00:00.000Z"
		},
		addresses: {
			invoiceAddress: {
				nameFirst: "Ada",
				nameLast: "Lovelace",
				companyName: "Buyer s.r.o.",
				street: "Hlavná 1",
				city: "Bratislava",
				zip: "81101",
				country: "Slovakia",
				phone: "+421911000000",
				companyOrgId: "87654321",
				companyTaxId: "2121358349",
				companyTaxVatId: "SK2121358349"
			}
		},
		prices: { currency: { code: "EUR", symbol: "€" } },
		items: [
			{
				type: "product",
				orderCode: "SHIRT",
				name: { en: "Shirt & Tie", sk: "Košeľa", de: "Hemd", es: "Camisa" },
				nameReady: "Shirt & Tie",
				amount: 2,
				price: 100,
				tax: 0.2,
				taxData: { taxDecimal: 0.2, priceWithoutTax: 80, priceWithTax: 100, tax: 20 }
			},
			{ type: "subscription", name: { en: "Plan" }, amount: 1, price: 9, orderCode: "PLAN" }
		],
		data: {
			paymentData: {
				codename: "online_stripe",
				nameReady: "Card",
				price: 2,
				paidAmountTotal: 199
			},
			deliveryDataReady: [{ name: "Courier", price: 5 }]
		},
		...overrides
	};
}

describe("e-invoice module", () => {
	const countries = [
		{ name: "Slovakia", code: "sk" },
		{ name: "Germany", code: "de" }
	];

	beforeEach(() => {
		einvoice.clearAuthCache();
		delete process.env.E_INVOICE_FORMAT;
	});

	it("registers Peppol BIS Billing 3.0 as the default format", () => {
		expect(einvoice.DEFAULT_FORMAT).toBe("en16931-peppolBisBilling30");
		expect(einvoice.listFormats()).toEqual([
			expect.objectContaining({
				id: "en16931-peppolBisBilling30",
				syntax: "ubl",
				templateBase: "en16931-peppolBisBilling30"
			})
		]);
	});

	it("rejects an unknown format", () => {
		expect(() => einvoice.getFormat("not-a-format")).toThrow(/Unknown e-invoice format/);
	});

	it("fills a Peppol BIS Billing 3.0 invoice and keeps the totals consistent", () => {
		const rendered = einvoice.render({
			order: order(),
			business: business(),
			countries
		});
		const xml = rendered.xml;
		expect(rendered.formatId).toBe("en16931-peppolBisBilling30");
		expect(rendered.lang).toBe("en");
		expect(xml).toContain("urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0");
		expect(xml).toContain("<cbc:ID>5202610001</cbc:ID>");
		expect(xml).toContain("Invoice 5202610001 for order ORD-100.");
		expect(xml).toContain("Paid on 2026-10-01.");
		expect(xml).toContain("Invoice settled.");
		expect(xml).toContain('schemeID="0245">9876543210</cbc:EndpointID>');
		expect(xml).toContain('schemeID="0245">2121358349</cbc:EndpointID>');
		expect(xml).toContain('schemeID="0158">12345678</cbc:CompanyID>');
		expect(xml).toContain("<cbc:ID>SK12345678901234</cbc:ID>");
		expect(xml).toContain("<cbc:PaymentMeansCode>68</cbc:PaymentMeansCode>");
		expect(xml).toContain("Shirt &amp; Tie");
		expect(xml).not.toContain("Plan");
		expect(xml).toContain("<cbc:Name>Courier</cbc:Name>");
		expect(xml).toContain("<cbc:LineExtensionAmount currencyID=\"EUR\">167.00</cbc:LineExtensionAmount>");
		expect(xml).toContain("<cbc:TaxAmount currencyID=\"EUR\">32.00</cbc:TaxAmount>");
		expect(xml).toContain("<cbc:TaxInclusiveAmount currencyID=\"EUR\">199.00</cbc:TaxInclusiveAmount>");
		expect(xml).toContain("<cbc:PayableAmount currencyID=\"EUR\">0.00</cbc:PayableAmount>");
		expect(xml.indexOf("<cac:PaymentMeans>")).toBeLessThan(xml.indexOf("<cac:TaxTotal>"));
		expect(xml.indexOf("<cac:LegalMonetaryTotal>")).toBeLessThan(xml.indexOf("<cac:InvoiceLine>"));
	});

	it("localizes free-text notes in every shop language", () => {
		const notes = {
			en: "Invoice 5202610001 for order ORD-100.",
			sk: "Faktúra 5202610001 k objednávke ORD-100.",
			de: "Rechnung 5202610001 zur Bestellung ORD-100.",
			es: "Factura 5202610001 del pedido ORD-100."
		};
		Object.entries(notes).forEach(([lang, note]) => {
			const rendered = einvoice.render({
				order: order({ lang: { code: lang } }),
				business: business(),
				countries
			});
			expect(rendered.lang).toBe(lang);
			expect(rendered.xml).toContain(note);
		});
	});

	it("falls back to the English template and uses an email endpoint for consumers", () => {
		const rendered = einvoice.render({
			order: order({
				lang: { code: "fr" },
				addresses: {
					invoiceAddress: {
						nameFirst: "Ada",
						nameLast: "Lovelace",
						street: "Main",
						city: "Vienna",
						zip: "1010",
						country: "at"
					}
				},
				data: {
					paymentData: { codename: "cod", price: 0, paidAmountTotal: 0 },
					deliveryDataReady: []
				}
			}),
			business: business(),
			countries
		});
		expect(rendered.xml).toContain("Invoice 5202610001 for order ORD-100.");
		expect(rendered.xml).toContain("Payment due by 2026-10-15.");
		expect(rendered.xml).toContain('schemeID="EM">buyer@example.com</cbc:EndpointID>');
		expect(rendered.xml).toContain("<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>");
		expect(rendered.xml).not.toContain("<cbc:PrepaidAmount");
	});

	it("marks a supplier that is not a VAT payer", () => {
		const seller = business().invoiceData.company;
		delete seller.taxVatId;
		const rendered = einvoice.render({
			order: order({ lang: { code: "sk" } }),
			business: { invoiceData: { company: seller } },
			countries
		});
		expect(rendered.xml).toContain("Dodávateľ nie je platiteľom DPH.");
		expect(rendered.xml).toContain("<cbc:ID>O</cbc:ID>");
		expect(rendered.xml).not.toContain("<cbc:CompanyID>SK9876543210</cbc:CompanyID>");
	});

	it("uses the German VAT scheme when the buyer has no Slovak DIČ", () => {
		const rendered = einvoice.render({
			order: order({
				addresses: {
					invoiceAddress: {
						companyName: "Käufer GmbH",
						street: "Hauptstr. 1",
						city: "Berlin",
						zip: "10115",
						country: "Germany",
						companyTaxVatId: "DE123456789"
					}
				}
			}),
			business: business(),
			countries
		});
		expect(rendered.xml).toContain('schemeID="9930">DE123456789</cbc:EndpointID>');
	});

	it("stores the xml beside the pdf and skips sending when no url is set", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "einvoice-"));
		const request = jest.fn();
		const result = await einvoice.generateAndSend({
			order: order(),
			business: business(),
			countries,
			outputDir: dir,
			relativeDir: "invoices/user1",
			env: {},
			request,
			logger: { info() {}, error() {} }
		});
		const stored = fs.readFileSync(path.join(dir, "5202610001.xml"), "utf8");
		expect(stored).toContain("<cbc:ID>5202610001</cbc:ID>");
		expect(result).toEqual({
			format: "en16931-peppolBisBilling30",
			lang: "en",
			path: "invoices/user1/5202610001.xml",
			sent: false,
			status: null,
			error: null
		});
		expect(request).not.toHaveBeenCalled();
	});

	it("posts the xml with bearer, basic, and api-key auth", async () => {
		const bearer = await authHeaders({ E_INVOICE_TOKEN: "tok-1" }, jest.fn(), null);
		expect(bearer.Authorization).toBe("Bearer tok-1");

		const basic = await authHeaders({
			E_INVOICE_USER: "ada",
			E_INVOICE_PASSWORD: "secret"
		}, jest.fn(), null);
		expect(basic.Authorization).toBe("Basic " + Buffer.from("ada:secret").toString("base64"));

		const apiKey = await authHeaders({
			E_INVOICE_API_KEY: "key-1",
			E_INVOICE_API_KEY_HEADER: "X-Api-Key"
		}, jest.fn(), null);
		expect(apiKey["X-Api-Key"]).toBe("key-1");
	});

	it("fetches an OAuth client-credentials token and sends it as Bearer", async () => {
		const request = jest.fn()
			.mockResolvedValueOnce({
				status: 200,
				body: JSON.stringify({ access_token: "oauth-token", expires_in: 60 })
			})
			.mockResolvedValueOnce({ status: 202, body: "" });
		const result = await einvoice.sendXml({
			xml: "<Invoice/>",
			env: {
				E_INVOICE_URL: "https://ap.example/invoices",
				E_INVOICE_OAUTH_TOKEN_URL: "https://ap.example/token",
				E_INVOICE_CLIENT_ID: "client",
				E_INVOICE_CLIENT_SECRET: "secret",
				E_INVOICE_OAUTH_SCOPE: "einvoice"
			},
			request,
			logger: { info() {}, error() {} }
		});
		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[0][0].url).toBe("https://ap.example/token");
		expect(request.mock.calls[0][0].body).toContain("grant_type=client_credentials");
		expect(request.mock.calls[1][0].headers.Authorization).toBe("Bearer oauth-token");
		expect(request.mock.calls[1][0].headers["Content-Type"]).toContain("application/xml");
		expect(request.mock.calls[1][0].body).toBe("<Invoice/>");
		expect(result).toEqual({ sent: true, status: 202, error: null });
	});

	it("reports a rejected submission without dropping the stored file", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "einvoice-"));
		const request = jest.fn().mockResolvedValue({ status: 401, body: "no" });
		const result = await einvoice.generateAndSend({
			order: order(),
			business: business(),
			countries,
			outputDir: dir,
			relativeDir: "invoices/user1",
			env: { E_INVOICE_URL: "https://ap.example/invoices", E_INVOICE_TOKEN: "tok" },
			request,
			logger: { info() {}, error() {} }
		});
		expect(fs.existsSync(path.join(dir, "5202610001.xml"))).toBe(true);
		expect(result.sent).toBe(false);
		expect(result.status).toBe(401);
		expect(result.error).toBe("HTTP 401");
	});

	it("passes a client certificate through to the request", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "einvoice-tls-"));
		const cert = path.join(dir, "client.crt");
		const key = path.join(dir, "client.key");
		fs.writeFileSync(cert, "CERT");
		fs.writeFileSync(key, "KEY");
		const request = jest.fn().mockResolvedValue({ status: 200, body: "" });
		await einvoice.sendXml({
			xml: "<Invoice/>",
			env: {
				E_INVOICE_URL: "https://ap.example/invoices",
				E_INVOICE_CLIENT_CERT: cert,
				E_INVOICE_CLIENT_KEY: key,
				E_INVOICE_CLIENT_KEY_PASSPHRASE: "phrase"
			},
			request,
			logger: { info() {}, error() {} }
		});
		expect(request.mock.calls[0][0].tls.cert.equals(Buffer.from("CERT"))).toBe(true);
		expect(request.mock.calls[0][0].tls.key.equals(Buffer.from("KEY"))).toBe(true);
		expect(request.mock.calls[0][0].tls.passphrase).toBe("phrase");
	});
});
