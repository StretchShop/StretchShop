"use strict";

const crypto = require("crypto");
const QRCode = require("qrcode");
const { encode, PaymentOptions, CurrencyCode } = require("bysquare/pay");

const REQUIRED_BANK_FIELDS = ["iban", "name", "bankName", "bankCode"];
/**
 * Header nibble for the PAY by square type. Specification documents 1.0 through
 * 1.2 all keep this at 0 (Table 4). The npm library's 1 and 2 are document
 * history numbers; bank apps reject them as an unsupported BySquare version,
 * and the Base32hex text then starts with 04 instead of 00.
 */
const PAY_BY_SQUARE_VERSION = 0x00;
const PAY_BY_SQUARE_COUNTRIES = new Set([
	"sk",
	"cz",
	"slovakia",
	"slovensko",
	"czechia",
	"czech republic",
	"cesko",
	"česko",
]);

/**
 * Shop bank account used for transfer payments.
 *
 * @param {*} business
 * @returns {*|null}
 */
function companyBankAccount(business) {
	return business?.invoiceData?.company?.bankAccount || null;
}

/**
 * Bank transfer can be offered only when every account field is set.
 *
 * @param {*} business
 * @returns {boolean}
 */
function isBankTransferConfigured(business) {
	const account = companyBankAccount(business);
	if (!account || typeof account !== "object") {
		return false;
	}
	return REQUIRED_BANK_FIELDS.every((key) => String(account[key] ?? "").trim() !== "");
}

/**
 * Public account fields stored on the order and shown to the customer.
 *
 * @param {*} business
 * @returns {{iban: string, name: string, bankName: string, bankCode: string}|null}
 */
function publicBankAccount(business) {
	if (!isBankTransferConfigured(business)) {
		return null;
	}
	const account = companyBankAccount(business);
	return {
		iban: String(account.iban).trim(),
		name: stripDiacritics(account.name).trim(),
		bankName: stripDiacritics(account.bankName).trim(),
		bankCode: String(account.bankCode).trim(),
	};
}

/**
 * PAY by square is the payment QR for a Slovak or Czech receiving account.
 *
 * @param {*} business
 * @returns {boolean}
 */
function usesPayBySquare(business) {
	const address = business?.invoiceData?.company?.address || {};
	const code = String(address.countryCode || "").trim().toLowerCase();
	const country = String(address.country || "").trim().toLowerCase();
	return PAY_BY_SQUARE_COUNTRIES.has(code) || PAY_BY_SQUARE_COUNTRIES.has(country);
}

function clip(value, max) {
	return stripDiacritics(value).replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function normalizeIban(iban) {
	return String(iban ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * BIC/SWIFT when bankCode matches ISO 9362. Local bank codes stay out of the QR BIC field.
 *
 * @param {string} bankCode
 * @returns {string}
 */
function bicFromBankCode(bankCode) {
	const value = String(bankCode ?? "").replace(/\s+/g, "").toUpperCase();
	return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value) ? value : "";
}

function roundMoney(value) {
	const amount = Number(value);
	if (!Number.isFinite(amount)) {
		return null;
	}
	return Math.round(amount * 100) / 100;
}

function amountDue(order) {
	const prices = order?.prices || {};
	if (prices.priceTotalToPay != null && prices.priceTotalToPay !== "") {
		return roundMoney(prices.priceTotalToPay);
	}
	const total = Number(prices.priceTotal);
	if (!Number.isFinite(total)) {
		return null;
	}
	const paid = Number(order?.data?.paymentData?.paidAmountTotal);
	const paidAmount = Number.isFinite(paid) ? paid : 0;
	return roundMoney(Math.max(total - paidAmount, 0));
}

function orderCurrency(order) {
	const currency = order?.prices?.currency;
	const code = typeof currency === "string" ? currency : currency?.code;
	const normalized = String(code || "EUR").trim().toUpperCase();
	return /^[A-Z]{3}$/.test(normalized) ? normalized : "EUR";
}

function paymentReference(order) {
	return String(order?.invoice?.id || order?.externalCode || order?._id || order?.id || "").trim();
}

const PAYMENT_NOTE_MAX = 140;

/** Latin letters that do not decompose under NFD. */
const ASCII_LETTERS = {
	"ł": "l", "Ł": "L",
	"đ": "d", "Đ": "D",
	"ø": "o", "Ø": "O",
	"æ": "ae", "Æ": "AE",
	"œ": "oe", "Œ": "OE",
	"ß": "ss",
	"þ": "th", "Þ": "Th",
	"ð": "d", "Ð": "D",
	"ŋ": "n", "Ŋ": "N",
	"ĺ": "l", "Ĺ": "L",
	"ľ": "l", "Ľ": "L",
};

function stripDiacritics(value) {
	return String(value ?? "")
		.replace(/[łŁđĐøØæÆœŒßþÞðÐŋŊĺĹľĽ]/g, (char) => ASCII_LETTERS[char])
		.normalize("NFD")
		.replace(/\p{M}+/gu, "");
}

/**
 * Keep letters, digits and spaces. Email parts may also keep . _ + -,
 * and @ is written as (at).
 *
 * @param {*} value
 * @param {"text"|"email"} mode
 * @returns {string}
 */
function sanitizePaymentNotePart(value, mode) {
	const drop = mode === "email" ? /[^A-Za-z0-9@._+-]+/g : /[^A-Za-z0-9 ]+/g;
	const cleaned = stripDiacritics(value)
		.replace(/[\r\n\t]+/g, " ")
		.replace(drop, "")
		.replace(/\s+/g, " ")
		.trim();
	return mode === "email" ? cleaned.replace(/@/g, "(at)") : cleaned;
}

/**
 * Order id shown to the customer. Invoices label externalCode as the order id.
 *
 * @param {*} order
 * @returns {string}
 */
function orderIdentifier(order) {
	const candidates = [order?.externalCode, order?._id, order?.id, order?.invoice?.id];
	for (const candidate of candidates) {
		const raw = String(candidate ?? "").trim();
		if (raw && sanitizePaymentNotePart(raw, "text")) {
			return raw;
		}
	}
	return "";
}

/**
 * @param {*} order
 * @returns {string}
 */
function customerEmail(order) {
	return String(
		order?.user?.email
		|| order?.addresses?.invoiceAddress?.email
		|| order?.invoiceAddress?.email
		|| ""
	).trim();
}

/**
 * @param {*} business
 * @returns {string}
 */
function eshopName(business) {
	return String(process.env.SITE_NAME || business?.invoiceData?.company?.name || "").trim();
}

/**
 * Payment note for every bank-transfer QR.
 * Order id is required. Email and shop name are appended while they fit.
 * The result is cut at 140 characters.
 *
 * @param {{orderId: *, email: *, shopName: *}} parts
 * @returns {string}
 */
function buildPaymentNote({ orderId, email, shopName }) {
	const id = sanitizePaymentNotePart(orderId, "text");
	if (!id) {
		return "";
	}
	const parts = [id];
	const mail = sanitizePaymentNotePart(email, "email");
	const shop = sanitizePaymentNotePart(shopName, "text");
	if (mail) {
		parts.push(mail);
	}
	if (shop) {
		parts.push(shop);
	}
	return parts.join(" ").slice(0, PAYMENT_NOTE_MAX).trim();
}

/**
 * String form of an order id. ObjectIds compare the same in either letter case.
 *
 * @param {*} orderId
 * @returns {string}
 */
function orderIdText(orderId) {
	if (orderId == null) {
		return "";
	}
	const text = String(orderId).trim();
	if (/^[a-fA-F0-9]{24}$/.test(text)) {
		return text.toLowerCase();
	}
	return text;
}

/**
 * 10-digit PAY by square variable symbol for an order id.
 * Regenerated from the id string, so it is not stored on the order.
 *
 * @param {*} orderId
 * @returns {string|undefined}
 */
function variableSymbolFromOrderId(orderId) {
	const id = orderIdText(orderId);
	if (!id) {
		return undefined;
	}
	const digest = crypto.createHash("sha256").update(id, "utf8").digest();
	const value = BigInt(`0x${digest.subarray(0, 8).toString("hex")}`) % 10000000000n;
	return value.toString().padStart(10, "0");
}

/**
 * True when the symbol is the one generated for this order id.
 * Banks may drop leading zeros, so 1 to 10 digits are accepted.
 *
 * @param {*} symbol
 * @param {*} orderId
 * @returns {boolean}
 */
function variableSymbolMatchesOrderId(symbol, orderId) {
	const expected = variableSymbolFromOrderId(orderId);
	if (!expected) {
		return false;
	}
	const raw = String(symbol ?? "").trim();
	if (!/^\d{1,10}$/.test(raw)) {
		return false;
	}
	return raw.padStart(10, "0") === expected;
}

/**
 * Variable symbol placed in the PAY by square field, never taken from free text.
 *
 * @param {{variableSymbol?: string, orderId?: *}} payment
 * @returns {string|undefined}
 */
function payBySquareVariableSymbol(payment) {
	const explicit = String(payment?.variableSymbol ?? "").trim();
	if (/^\d{10}$/.test(explicit)) {
		return explicit;
	}
	return variableSymbolFromOrderId(payment?.orderId);
}

/**
 * EPC remittance text. The SEPA set has no @ or underscore, and a bank that
 * rejects one character drops the whole note.
 *
 * @param {*} value
 * @param {number} max
 * @returns {string}
 */
function epcText(value, max) {
	return stripDiacritics(value)
		.replace(/@/g, "(at)")
		.replace(/_/g, "-")
		.replace(/[^A-Za-z0-9 /\-?:().,'+]+/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max)
		.trim();
}

/**
 * EPC069-12 SEPA credit transfer payload, version 002.
 * The note is the unstructured remittance (140) and the shorter text shown to the payer (70).
 *
 * @param {{name: string, iban: string, bic: string, amount: number|null, currency: string, reference: string, paymentNote?: string}} payment
 * @returns {string}
 */
function buildEpcPayload(payment) {
	const amountField = payment.currency === "EUR" && payment.amount != null && payment.amount > 0
		? `EUR${payment.amount.toFixed(2)}`
		: "";
	const note = epcText(payment.paymentNote || payment.reference, 140);
	return [
		"BCD",
		"002",
		"1",
		"SCT",
		payment.bic || "",
		clip(payment.name, 70),
		payment.iban,
		amountField,
		"",
		"",
		note,
		epcText(note, 70),
	].join("\n");
}

/**
 * PAY by square payload string for Slovak and Czech receiving accounts.
 *
 * @param {{name: string, iban: string, bic: string, amount: number|null, currency: string, reference: string, paymentNote?: string, orderId?: *, variableSymbol?: string}} payment
 * @returns {string}
 */
function buildPayBySquarePayload(payment) {
	const bankAccount = { iban: payment.iban };
	if (payment.bic) {
		bankAccount.bic = payment.bic;
	}
	const model = {
		type: PaymentOptions.PaymentOrder,
		currencyCode: CurrencyCode[payment.currency] || payment.currency || CurrencyCode.EUR,
		beneficiary: { name: clip(payment.name, 70) || " " },
		bankAccounts: [bankAccount],
	};
	if (payment.amount != null && payment.amount > 0) {
		model.amount = payment.amount;
	}
	const symbol = payBySquareVariableSymbol(payment);
	if (symbol) {
		model.variableSymbol = symbol;
	}
	const note = clip(payment.paymentNote || payment.reference, 140);
	if (note) {
		model.paymentNote = note;
	}
	return encode({ payments: [model] }, {
		version: PAY_BY_SQUARE_VERSION,
		deburr: true,
		validate: true,
	});
}

function renderQrSvg(payload, errorCorrectionLevel) {
	return QRCode.toString(payload, {
		type: "svg",
		errorCorrectionLevel,
		margin: 1,
	}).then((svg) => String(svg).replace(/<\?xml[^?]*\?>\s*/g, "").trim());
}

/**
 * Build the payment QR for an order. Does not persist it.
 *
 * @param {{order: *, business: *}} input
 * @returns {Promise<{svg: string, bankAccount: object, standard: string}>}
 */
function buildBankTransferQr({ order, business }) {
	const bankAccount = publicBankAccount(business);
	if (!bankAccount) {
		return Promise.reject(new Error("Bank account is not configured"));
	}
	const payment = {
		name: bankAccount.name,
		iban: normalizeIban(bankAccount.iban),
		bic: bicFromBankCode(bankAccount.bankCode),
		amount: amountDue(order),
		currency: orderCurrency(order),
		reference: paymentReference(order),
		orderId: order?._id ?? order?.id,
		variableSymbol: variableSymbolFromOrderId(order?._id ?? order?.id),
		paymentNote: buildPaymentNote({
			orderId: orderIdentifier(order),
			email: customerEmail(order),
			shopName: eshopName(business),
		}),
	};
	const standard = usesPayBySquare(business) ? "paybysquare" : "epc";
	const payload = standard === "paybysquare"
		? buildPayBySquarePayload(payment)
		: buildEpcPayload(payment);
	const errorCorrectionLevel = standard === "paybysquare" ? "L" : "M";
	return renderQrSvg(payload, errorCorrectionLevel).then((svg) => ({ svg, bankAccount, standard }));
}

/**
 * SVG block appended to the invoice HTML. Empty when this order has no QR.
 *
 * @param {string} svg
 * @returns {string}
 */
function paymentQrInvoiceMarkup(svg) {
	if (!svg || !String(svg).includes("<svg")) {
		return "";
	}
	let sized = String(svg).replace(/<\?xml[^?]*\?>/g, "").trim();
	sized = sized.replace(/\swidth="[^"]*"/i, "").replace(/\sheight="[^"]*"/i, "");
	sized = sized.replace("<svg", "<svg width=\"160\" height=\"160\"");
	return `<p>${sized}</p>`;
}

/**
 * @param {string} html
 * @param {*} order
 * @returns {string}
 */
function injectPaymentQr(html, order) {
	const markup = paymentQrInvoiceMarkup(order?.data?.paymentData?.lastQr);
	return String(html ?? "").replace("<!-- payment_qr //-->", markup);
}

module.exports = {
	isBankTransferConfigured,
	publicBankAccount,
	usesPayBySquare,
	buildPaymentNote,
	variableSymbolFromOrderId,
	variableSymbolMatchesOrderId,
	buildEpcPayload,
	buildPayBySquarePayload,
	buildBankTransferQr,
	paymentQrInvoiceMarkup,
	injectPaymentQr,
};
