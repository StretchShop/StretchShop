"use strict";

const {
	orderLanguage,
	countryCode,
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
} = require("../model-helpers");

/**
 * EN 16931 invoice in the Peppol BIS Billing 3.0 syntax (UBL 2.1).
 * This is the structured invoice Slovakia requires for domestic B2B/B2G
 * from 1 January 2027. Transmission itself goes through a Peppol access
 * point; this format only builds the XML document.
 */
module.exports = {
	id: "en16931-peppolBisBilling30",
	syntax: "ubl",
	templateBase: "en16931-peppolBisBilling30",
	customizationId: "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
	profileId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
	invoiceTypeCode: "380",

	buildModel({ order, business, countries }) {
		const lang = orderLanguage(order);
		const company = business?.invoiceData?.company || {};
		const address = order?.addresses?.invoiceAddress || {};
		const sellerCountry = countryCode(company.address?.countryCode || company.address?.country, countries);
		const buyerCountry = countryCode(address.country, countries) || sellerCountry;
		const vatRegistered = Boolean(String(company.taxVatId || "").trim());
		const issueDate = formatDate(order?.dates?.dateInvoiceIssued || order?.dates?.datePaid || new Date());
		const dueDaysSetting = Number(business?.invoiceData?.einvoice?.dueDays);
		const dueDays = Number.isFinite(dueDaysSetting) && dueDaysSetting >= 0 ? dueDaysSetting : 14;
		const dueDate = addDays(issueDate, dueDays);
		const paidDate = order?.dates?.datePaid ? formatDate(order.dates.datePaid) : issueDate;
		const invoiceId = String(order?.invoice?.id || "").trim();
		const orderReference = String(order?.externalCode || invoiceId || order?._id || "").trim();
		const seller = buildSeller(company, sellerCountry);
		const buyer = buildBuyer(address, buyerCountry, order);
		const lines = buildLines(order, lang, vatRegistered);
		if (lines.length === 0) {
			throw new Error("e-invoice has no billable lines");
		}
		const totals = buildTotals(lines, order);
		const account = company.account || {};
		const iban = String(account.iban || "").replace(/\s/g, "").toUpperCase();

		return {
			customizationId: this.customizationId,
			profileId: this.profileId,
			invoiceTypeCode: this.invoiceTypeCode,
			id: invoiceId,
			issueDate,
			dueDate,
			paidDate,
			currency: currencyCode(order),
			buyerReference: orderReference,
			orderReference,
			paidInFull: totals.paidInFull,
			hasPrepaid: totals.hasPrepaid,
			lineExtensionAmount: totals.lineExtensionAmount,
			taxExclusiveAmount: totals.taxExclusiveAmount,
			taxInclusiveAmount: totals.taxInclusiveAmount,
			prepaidAmount: totals.prepaidAmount,
			payableAmount: totals.payableAmount,
			taxAmount: totals.taxAmount,
			taxSubtotals: totals.taxSubtotals,
			lines: totals.lines,
			seller,
			buyer,
			payment: {
				meansCode: paymentMeansCode(order?.data?.paymentData),
				iban,
				bic: String(account.swift || account.bic || "").replace(/\s/g, "").toUpperCase(),
				accountName: account.bank || company.name || ""
			}
		};
	}
};

function buildSeller(company, country) {
	const endpoint = sellerEndpoint(company, country);
	const legalId = String(company.orgId || "").trim();
	return {
		name: company.name || "",
		street: company.address?.street || "",
		city: company.address?.city || "",
		zip: company.address?.zip || "",
		country,
		vatRegistered: Boolean(String(company.taxVatId || "").trim()),
		vatId: String(company.taxVatId || "").replace(/\s/g, "").toUpperCase(),
		legalId,
		legalScheme: country === "SK" && legalId ? "0158" : "",
		registration: company.registration || "",
		phone: company.contacts?.phone || "",
		email: company.contacts?.email || "",
		endpointScheme: endpoint.scheme,
		endpointId: endpoint.id
	};
}

function buildBuyer(address, country, order) {
	const person = [address.nameFirst, address.nameLast].filter(Boolean).join(" ").trim();
	const companyName = String(address.companyName || "").trim();
	const email = address.email || order?.user?.email || "";
	const endpoint = buyerEndpoint(address, country, email);
	const vatId = String(address.companyTaxVatId || "").replace(/\s/g, "").toUpperCase();
	return {
		name: companyName || person || "Customer",
		legalName: companyName,
		legalId: String(address.companyOrgId || "").trim(),
		contactName: person,
		street: address.street || "",
		street2: address.street2 || "",
		city: address.city || "",
		zip: address.zip || "",
		country,
		vatId,
		phone: address.phone || "",
		email,
		endpointScheme: endpoint.scheme,
		endpointId: endpoint.id,
		hasContact: Boolean(person || address.phone || email)
	};
}

function buildLines(order, lang, vatRegistered) {
	const lines = [];
	const items = Array.isArray(order?.items) ? order.items : [];
	items
		.filter(item => item && item.type !== "subscription")
		.forEach(item => {
			const percent = vatRegistered ? taxPercent(item) : 0;
			pushLine(lines, {
				name: item.nameReady || localizedName(item.name, lang) || item.orderCode || "Item",
				quantity: item.amount,
				unitNet: lineUnitNet(item, vatRegistered),
				percent,
				category: vatRegistered ? (percent > 0 ? "S" : "Z") : "O",
				sellersItemId: item.orderCode || item.externalId || ""
			});
		});

	const deliveries = order?.data?.deliveryDataReady;
	if (Array.isArray(deliveries)) {
		deliveries.forEach(delivery => {
			pushLine(lines, extraLine(delivery?.name || "Delivery", delivery?.price, vatRegistered));
		});
	}

	const payment = order?.data?.paymentData || {};
	const paymentPrice = payment.price ?? order?.prices?.pricePayment;
	const paymentName = payment.nameReady || localizedName(payment.name, lang) || "Payment";
	pushLine(lines, extraLine(paymentName, paymentPrice, vatRegistered));
	return lines;
}

function extraLine(name, price, vatRegistered) {
	const amount = Number(price);
	if (!Number.isFinite(amount) || amount <= 0) {
		return null;
	}
	return {
		name,
		quantity: 1,
		unitNet: amount,
		percent: 0,
		category: vatRegistered ? "Z" : "O",
		sellersItemId: ""
	};
}

function lineUnitNet(item, vatRegistered) {
	if (!vatRegistered) {
		const gross = Number(item?.taxData?.priceWithTax ?? item?.price ?? 0);
		return Number.isFinite(gross) ? gross : 0;
	}
	const net = item?.taxData?.priceWithoutTax;
	if (net !== null && net !== undefined && net !== "" && Number.isFinite(Number(net))) {
		return Number(net);
	}
	const gross = Number(item?.taxData?.priceWithTax ?? item?.price ?? 0);
	const percent = taxPercent(item);
	if (percent > 0 && Number.isFinite(gross)) {
		return gross / (1 + (percent / 100));
	}
	return Number.isFinite(gross) ? gross : 0;
}

function pushLine(lines, source) {
	if (!source) {
		return;
	}
	const qty = Number(source.quantity);
	if (!Number.isFinite(qty) || qty <= 0) {
		return;
	}
	const unit = round4(source.unitNet);
	if (!Number.isFinite(unit) || unit < 0) {
		return;
	}
	const lineCents = Math.round(unit * qty * 100);
	lines.push({
		id: String(lines.length + 1),
		name: String(source.name || "Item").slice(0, 200),
		quantity: formatQty(qty),
		unitCode: "C62",
		lineExtensionAmount: fromCents(lineCents),
		lineNetCents: lineCents,
		taxCategory: source.category,
		taxPercent: Number(source.percent || 0).toFixed(2),
		priceAmount: unit.toFixed(4),
		sellersItemId: source.sellersItemId || ""
	});
}

function buildTotals(lines, order) {
	const groups = new Map();
	lines.forEach(line => {
		const key = line.taxCategory + "|" + line.taxPercent;
		if (!groups.has(key)) {
			groups.set(key, {
				category: line.taxCategory,
				percent: line.taxPercent,
				taxableCents: 0
			});
		}
		groups.get(key).taxableCents += line.lineNetCents;
	});
	const taxSubtotals = Array.from(groups.values()).map(group => {
		const taxCents = Math.round(group.taxableCents * Number(group.percent) / 100);
		return {
			category: group.category,
			percent: group.percent,
			taxableAmount: fromCents(group.taxableCents),
			taxAmount: fromCents(taxCents),
			taxCents
		};
	});
	const lineCents = lines.reduce((sum, line) => sum + line.lineNetCents, 0);
	const taxCents = taxSubtotals.reduce((sum, group) => sum + group.taxCents, 0);
	const inclusiveCents = lineCents + taxCents;
	const paidCents = Math.min(
		Math.max(toCents(order?.data?.paymentData?.paidAmountTotal), 0),
		inclusiveCents
	);
	const payableCents = inclusiveCents - paidCents;
	return {
		lines: lines.map(line => {
			const copy = { ...line };
			delete copy.lineNetCents;
			return copy;
		}),
		taxSubtotals: taxSubtotals.map(group => ({
			category: group.category,
			percent: group.percent,
			taxableAmount: group.taxableAmount,
			taxAmount: group.taxAmount
		})),
		lineExtensionAmount: fromCents(lineCents),
		taxExclusiveAmount: fromCents(lineCents),
		taxAmount: fromCents(taxCents),
		taxInclusiveAmount: fromCents(inclusiveCents),
		prepaidAmount: fromCents(paidCents),
		payableAmount: fromCents(payableCents),
		hasPrepaid: paidCents > 0,
		paidInFull: paidCents > 0 && payableCents === 0
	};
}
