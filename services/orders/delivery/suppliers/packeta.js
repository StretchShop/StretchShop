"use strict";

const fetch = require("cross-fetch");
const { XMLBuilder, XMLParser } = require("fast-xml-parser");

const API_URL = "https://www.zasilkovna.cz/api/rest";
const DEFAULT_TRACKING_URL = "https://tracking.packeta.com/{lang}/{trackingId}";
const DESTINATION_LIMITS = {
	externalId: 32,
	name: 120,
	street: 160,
	city: 80,
	zip: 20,
	country: 8,
};

const xmlBuilder = new XMLBuilder({
	ignoreAttributes: true,
	suppressEmptyNode: true,
	format: false,
});

const xmlParser = new XMLParser({
	ignoreAttributes: true,
	isArray: (name) => name === "record",
});

/**
 * @param {object} method
 * @returns {object}
 */
function publicSettings(method) {
	const data = method?.data || {};
	const widget = data.widget && typeof data.widget === "object" ? data.widget : {};
	return {
		...method,
		data: {
			destinationSelectionPlugin: data.destinationSelectionPlugin === true,
			widgetApiKey: typeof data.widgetApiKey === "string" ? data.widgetApiKey : "",
			trackingUrl: typeof data.trackingUrl === "string" ? data.trackingUrl : "",
			widget: {
				language: typeof widget.language === "string" ? widget.language : "en",
				view: typeof widget.view === "string" ? widget.view : "modal",
				vendors: Array.isArray(widget.vendors) ? widget.vendors : [],
			},
		},
	};
}

/**
 * @param {*} destination
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateDestination(destination) {
	const errors = [];
	if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
		return { ok: false, errors: ["destination"] };
	}
	if (destination.supplier !== "packeta") {
		errors.push("supplier");
	}
	Object.keys(DESTINATION_LIMITS).forEach((key) => {
		const value = destination[key];
		if (typeof value !== "string" || value.trim() === "" || value.length > DESTINATION_LIMITS[key]) {
			errors.push(key);
		}
	});
	return { ok: errors.length === 0, errors };
}

/**
 * @param {object} destination
 * @returns {object}
 */
function sanitizeDestination(destination) {
	const clean = { supplier: "packeta" };
	Object.keys(DESTINATION_LIMITS).forEach((key) => {
		clean[key] = String(destination[key]).trim();
	});
	return clean;
}

/**
 * @param {string} template
 * @param {string} lang
 * @param {string} trackingId
 * @returns {string}
 */
function trackingUrl(template, lang, trackingId) {
	const pattern = template || DEFAULT_TRACKING_URL;
	return pattern
		.replaceAll("{lang}", lang || "en")
		.replaceAll("{trackingId}", trackingId || "")
		.replaceAll("{tracking_number}", trackingId || "");
}

/**
 * @param {object} record
 * @returns {string}
 */
function mapStatus(record) {
	const codeText = String(record?.codeText || "").toLowerCase();
	const code = Number(record?.statusCode);
	if (codeText === "delivered" || code === 7) {
		return "delivered";
	}
	if (codeText.includes("return") || code === 9 || code === 10) {
		return "returned";
	}
	if (codeText === "cancelled" || codeText === "canceled" || code === 11) {
		return "cancelled";
	}
	if (codeText === "ready for pickup" || code === 5) {
		return "ready_for_pickup";
	}
	if (codeText === "received data" || code === 1) {
		return "received";
	}
	if (codeText || Number.isFinite(code)) {
		return "in_transit";
	}
	return "unknown";
}

/**
 * @param {string} value
 * @returns {string}
 */
function asText(value) {
	return value == null ? "" : String(value).trim();
}

/**
 * @param {object} address
 * @returns {{ name: string, surname: string }}
 */
function personName(address) {
	const first = asText(address?.nameFirst);
	const last = asText(address?.nameLast);
	if (first || last) {
		return { name: first, surname: last };
	}
	const parts = asText(address?.name).split(/\s+/).filter(Boolean);
	return {
		name: parts[0] || "",
		surname: parts.slice(1).join(" "),
	};
}

/**
 * @param {object} order
 * @returns {string}
 */
function currencyCode(order) {
	const currency = order?.prices?.currency;
	if (typeof currency === "string" && currency.trim()) {
		return currency.trim().toUpperCase();
	}
	if (currency?.code) {
		return String(currency.code).trim().toUpperCase();
	}
	return "EUR";
}

/**
 * @param {object} order
 * @returns {string}
 */
function money(order) {
	const total = Number(order?.prices?.priceTotal);
	if (!Number.isFinite(total)) {
		return "0.00";
	}
	return total.toFixed(2);
}

/**
 * @param {object} method
 * @returns {string}
 */
function shipmentWeight(method) {
	const weight = Number(method?.data?.defaultWeightKg);
	if (!Number.isFinite(weight) || weight <= 0) {
		return "1";
	}
	return String(weight);
}

/**
 * @param {object} method
 * @returns {string}
 */
function eshopName(method) {
	const fromEnv = asText(process.env.PACKETA_ESHOP);
	if (fromEnv) {
		return fromEnv;
	}
	return asText(method?.data?.eshop);
}

/**
 * @returns {string}
 */
function apiPassword() {
	const password = asText(process.env.PACKETA_API_PASSWORD);
	if (!password) {
		throw new Error("Packeta API password is not configured");
	}
	return password;
}

/**
 * @param {*} parsed
 * @returns {string}
 */
function faultMessage(parsed) {
	const response = parsed?.response || parsed || {};
	const faults = response?.detail?.attributes?.fault;
	const list = Array.isArray(faults) ? faults : (faults ? [faults] : []);
	const details = list.map((fault) => {
		if (fault && typeof fault === "object" && fault.name && fault.fault) {
			return fault.name + ": " + fault.fault;
		}
		return asText(fault);
	}).filter(Boolean);
	const summary = asText(response.string) || asText(response.fault) || "Packeta request failed";
	return details.length ? summary + " " + details.join("; ") : summary;
}

/**
 * @param {string} xml
 * @returns {object}
 */
function parseXml(xml) {
	return xmlParser.parse(xml);
}

/**
 * @param {object} order
 * @param {object} method
 * @param {string} password
 * @returns {string}
 */
function buildCreatePacketXml(order, method, password) {
	const invoice = order?.addresses?.invoiceAddress || {};
	const delivery = order?.addresses?.deliveryAddress || {};
	const names = personName(invoice);
	if (!names.name || !names.surname) {
		const fallback = personName(delivery);
		names.name = names.name || fallback.name;
		names.surname = names.surname || fallback.surname;
	}
	const email = asText(invoice.email) || asText(order?.user?.email);
	const phone = asText(invoice.phone) || asText(delivery.phone);
	const addressId = asText(order?.data?.deliveryData?.destination?.externalId);
	const eshop = eshopName(method);
	if (!names.name || !names.surname) {
		throw new Error("Packeta shipment needs a customer name");
	}
	if (!email) {
		throw new Error("Packeta shipment needs a customer email");
	}
	if (!phone) {
		throw new Error("Packeta shipment needs a customer phone");
	}
	if (!addressId) {
		throw new Error("Packeta shipment needs a pickup point");
	}
	if (!eshop) {
		throw new Error("Packeta eshop is not configured");
	}
	const paymentCodename = order?.data?.paymentData?.codename;
	const cod = paymentCodename === "cod" ? money(order) : "0.00";
	return xmlBuilder.build({
		createPacket: {
			apiPassword: password,
			packetAttributes: {
				number: asText(order._id).slice(0, 36),
				name: names.name,
				surname: names.surname,
				email,
				phone,
				addressId,
				cod,
				value: money(order),
				currency: currencyCode(order),
				weight: shipmentWeight(method),
				eshop,
			},
		},
	});
}

/**
 * @param {string} xml
 * @returns {{ packetId: string, trackingId: string }}
 */
function parseCreatePacketResponse(xml) {
	const response = parseXml(xml)?.response;
	if (!response || response.status !== "ok") {
		throw new Error(faultMessage(parseXml(xml)));
	}
	const packetId = asText(response.result?.id);
	const trackingId = asText(response.result?.barcode) || packetId;
	if (!packetId || !trackingId) {
		throw new Error("Packeta did not return a packet barcode");
	}
	return { packetId, trackingId };
}

/**
 * @param {string} packetId
 * @param {string} password
 * @returns {string}
 */
function buildLabelXml(packetId, password) {
	return xmlBuilder.build({
		packetLabelPdf: {
			apiPassword: password,
			packetId,
			format: "A6 on A4",
			offset: 0,
		},
	});
}

/**
 * @param {string} xml
 * @returns {Buffer}
 */
function parseLabelResponse(xml) {
	const response = parseXml(xml)?.response;
	if (!response || response.status !== "ok") {
		throw new Error(faultMessage(parseXml(xml)));
	}
	const encoded = asText(response.result);
	if (!encoded) {
		throw new Error("Packeta did not return a label");
	}
	return Buffer.from(encoded, "base64");
}

/**
 * @param {string} packetId
 * @param {string} password
 * @returns {string}
 */
function buildTrackingXml(packetId, password) {
	return xmlBuilder.build({
		packetTracking: {
			apiPassword: password,
			packetId,
		},
	});
}

/**
 * @param {string} value
 * @returns {string|null}
 */
function toIso(value) {
	const text = asText(value);
	if (!text) {
		return null;
	}
	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime())) {
		return text;
	}
	return parsed.toISOString();
}

/**
 * @param {string} xml
 * @param {{ trackingId: string, packetId?: string, lang?: string, trackingUrlTemplate?: string }} context
 * @returns {object}
 */
function parseTrackingResponse(xml, context) {
	const response = parseXml(xml)?.response;
	if (!response || response.status !== "ok") {
		throw new Error(faultMessage(parseXml(xml)));
	}
	const records = response.result?.record || [];
	const latest = records.length ? records[records.length - 1] : null;
	const delivered = records.find((record) => mapStatus(record) === "delivered") || null;
	const status = latest ? mapStatus(latest) : "unknown";
	const trackingId = context.trackingId;
	return {
		supplier: "packeta",
		trackingId,
		packetId: context.packetId || null,
		status,
		statusText: asText(latest?.statusText) || null,
		trackingUrl: trackingUrl(context.trackingUrlTemplate, context.lang, trackingId),
		updatedAt: latest ? toIso(latest.dateTime) : null,
		deliveredAt: delivered ? toIso(delivered.dateTime) : null,
	};
}

/**
 * @param {string} xml
 * @param {Function} [fetchImpl]
 * @returns {Promise<string>}
 */
function postXml(xml, fetchImpl) {
	const doFetch = fetchImpl || fetch;
	return doFetch(API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/xml",
			Accept: "application/xml",
		},
		body: xml,
	}).then((res) => res.text().then((text) => {
		if (!res.ok) {
			throw new Error("Packeta request failed");
		}
		return text;
	}));
}

/**
 * @param {string} packetId
 * @param {{ fetch?: Function }} [options]
 * @returns {Promise<Buffer>}
 */
function fetchLabel(packetId, options = {}) {
	return Promise.resolve().then(() => {
		const password = apiPassword();
		const xml = buildLabelXml(packetId, password);
		return postXml(xml, options.fetch).then(parseLabelResponse);
	});
}

/**
 * @param {object} order
 * @param {object} method
 * @param {{ fetch?: Function }} [options]
 * @returns {Promise<object>}
 */
function createShipment(order, method, options = {}) {
	return Promise.resolve().then(() => {
		const password = apiPassword();
		const xml = buildCreatePacketXml(order, method, password);
		return postXml(xml, options.fetch)
			.then(parseCreatePacketResponse)
			.then((created) => {
				const lang = order?.lang?.code || "en";
				const shipment = {
					supplier: "packeta",
					trackingId: created.trackingId,
					packetId: created.packetId,
					status: null,
					statusText: null,
					trackingUrl: trackingUrl(method?.data?.trackingUrl, lang, created.trackingId),
					updatedAt: null,
					deliveredAt: null,
					labelPdf: null,
					labelError: null,
				};
				return fetchLabel(created.packetId, options)
					.then((pdf) => {
						shipment.labelPdf = pdf;
						return shipment;
					})
					.catch((error) => {
						shipment.labelError = error?.message || "Packeta label failed";
						return shipment;
					});
			});
	});
}

/**
 * @param {string} trackingId
 * @param {{ order?: object, method?: object, stored?: object, fetch?: Function }} context
 * @returns {Promise<object>}
 */
function track(trackingId, context = {}) {
	return Promise.resolve().then(() => {
		const password = apiPassword();
		const xml = buildTrackingXml(trackingId, password);
		const lang = context.order?.lang?.code || "en";
		return postXml(xml, context.fetch).then((body) => parseTrackingResponse(body, {
			trackingId,
			packetId: context.stored?.packetId || null,
			lang,
			trackingUrlTemplate: context.method?.data?.trackingUrl || context.stored?.trackingUrl,
		}));
	});
}

module.exports = {
	codename: "packeta",
	publicSettings,
	validateDestination,
	sanitizeDestination,
	createShipment,
	track,
	fetchLabel,
	mapStatus,
	trackingUrl,
	buildCreatePacketXml,
	parseCreatePacketResponse,
	parseTrackingResponse,
	parseLabelResponse,
};
