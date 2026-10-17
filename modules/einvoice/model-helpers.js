"use strict";

const ISO_FIX = { UK: "GB" };

/**
 * Peppol electronic-address schemes for VAT numbers (EAS / ISO 6523).
 * Slovakia production routing uses DIČ scheme 0245, not this VAT scheme.
 */
const VAT_ENDPOINT_SCHEME = {
	AT: "9914",
	BE: "9925",
	BG: "9926",
	CH: "9927",
	CY: "9928",
	CZ: "9929",
	DE: "9930",
	DK: "0184",
	EE: "9931",
	EL: "9933",
	ES: "9920",
	FR: "9957",
	GB: "9932",
	GR: "9933",
	HR: "9934",
	HU: "9910",
	IE: "9935",
	IT: "9906",
	LI: "9936",
	LT: "9937",
	LU: "9938",
	LV: "9939",
	MT: "9943",
	NL: "9944",
	PL: "9945",
	PT: "9946",
	RO: "9947",
	SI: "9949",
	SK: "9950"
};

function orderLanguage(order) {
	if (order?.lang && typeof order.lang === "object" && order.lang.code) {
		return String(order.lang.code).trim().toLowerCase();
	}
	if (typeof order?.lang === "string" && order.lang.trim()) {
		return order.lang.trim().toLowerCase();
	}
	return "en";
}

function countryCode(value, countries) {
	if (!value) {
		return "";
	}
	if (typeof value === "object") {
		return countryCode(value.code || value.name, countries);
	}
	const raw = String(value).trim();
	if (!raw) {
		return "";
	}
	if (/^[a-z]{2}$/i.test(raw)) {
		const upper = raw.toUpperCase();
		return ISO_FIX[upper] || upper;
	}
	const found = (countries || []).find(country => {
		return String(country.name || "").toLowerCase() === raw.toLowerCase()
			|| String(country.code || "").toLowerCase() === raw.toLowerCase();
	});
	if (found?.code) {
		return countryCode(found.code, countries);
	}
	return "";
}

function digits(value) {
	return String(value || "").replace(/\D/g, "");
}

function compactId(value) {
	return String(value || "").replace(/\s/g, "").toUpperCase();
}

function vatScheme(country, vatId) {
	const prefix = compactId(vatId).slice(0, 2);
	if (VAT_ENDPOINT_SCHEME[prefix]) {
		return VAT_ENDPOINT_SCHEME[prefix];
	}
	if (VAT_ENDPOINT_SCHEME[country]) {
		return VAT_ENDPOINT_SCHEME[country];
	}
	return null;
}

function explicitEndpoint(source) {
	const endpoint = source?.endpoint || source?.electronicAddress;
	if (endpoint?.scheme && endpoint?.id) {
		return {
			scheme: String(endpoint.scheme).trim(),
			id: String(endpoint.id).trim()
		};
	}
	return null;
}

/**
 * Slovak Peppol participant id is scheme 0245 plus the 10-digit DIČ.
 * 9950 is the Slovakia VAT scheme (SK + VAT id), used when no DIČ is available.
 */
function sellerEndpoint(company, country) {
	const configured = explicitEndpoint(company);
	if (configured) {
		return configured;
	}
	const taxDigits = digits(company?.taxId);
	if (country === "SK" && taxDigits.length === 10) {
		return { scheme: "0245", id: taxDigits };
	}
	const vat = compactId(company?.taxVatId);
	const scheme = vatScheme(country, vat);
	if (vat && scheme) {
		return { scheme, id: vat };
	}
	const org = digits(company?.orgId);
	if (country === "SK" && org) {
		return { scheme: "0158", id: org };
	}
	if (company?.contacts?.email) {
		return { scheme: "EM", id: String(company.contacts.email).trim() };
	}
	return { scheme: "EM", id: "seller" };
}

function buyerEndpoint(address, country, email) {
	const configured = explicitEndpoint(address);
	if (configured) {
		return configured;
	}
	const taxDigits = digits(address?.companyTaxId);
	if (country === "SK" && taxDigits.length === 10) {
		return { scheme: "0245", id: taxDigits };
	}
	const vat = compactId(address?.companyTaxVatId);
	const scheme = vatScheme(country, vat);
	if (vat && scheme) {
		return { scheme, id: vat };
	}
	if (email) {
		return { scheme: "EM", id: String(email).trim() };
	}
	return { scheme: "EM", id: "buyer" };
}

function localizedName(value, lang) {
	if (!value) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "object") {
		if (typeof value[lang] === "string" && value[lang]) {
			return value[lang];
		}
		if (typeof value.en === "string" && value.en) {
			return value.en;
		}
		const first = Object.values(value).find(item => typeof item === "string" && item);
		return first || "";
	}
	return "";
}

function parseDate(value) {
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return new Date(value.getTime());
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed;
		}
	}
	if (typeof value === "number") {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed;
		}
	}
	return new Date();
}

function formatDate(value) {
	return parseDate(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
	const date = parseDate(value);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function currencyCode(order) {
	const currency = order?.prices?.currency;
	const code = typeof currency === "string" ? currency : currency?.code;
	const normalized = String(code || "EUR").trim().toUpperCase();
	return /^[A-Z]{3}$/.test(normalized) ? normalized : "EUR";
}

function toCents(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) {
		return 0;
	}
	return Math.round((number + Number.EPSILON) * 100);
}

function fromCents(cents) {
	return (cents / 100).toFixed(2);
}

function round4(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) {
		return 0;
	}
	return Math.round((number + Number.EPSILON) * 10000) / 10000;
}

function formatQty(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) {
		return "0";
	}
	if (Number.isInteger(number)) {
		return String(number);
	}
	return number.toFixed(2);
}

function taxPercent(item) {
	let rate = Number(item?.taxData?.taxDecimal ?? item?.tax ?? 0);
	if (!Number.isFinite(rate) || rate < 0) {
		rate = 0;
	}
	if (rate > 0 && rate <= 1) {
		rate = rate * 100;
	}
	return Math.round(rate * 100) / 100;
}

function paymentMeansCode(paymentData) {
	const code = String(paymentData?.codename || paymentData?.code || "").toLowerCase();
	if (code.includes("stripe") || code.includes("card") || code.includes("paypal") || code.includes("online")) {
		return "68";
	}
	if (code.includes("cod") || code.includes("cash")) {
		return "10";
	}
	if (code.includes("transfer") || code.includes("bank") || code.includes("wire") || code.includes("sepa")) {
		return "30";
	}
	return "1";
}

module.exports = {
	VAT_ENDPOINT_SCHEME,
	orderLanguage,
	countryCode,
	digits,
	sellerEndpoint,
	buyerEndpoint,
	localizedName,
	formatDate,
	addDays,
	currencyCode,
	toCents,
	fromCents,
	round4,
	formatQty,
	taxPercent,
	paymentMeansCode
};
