"use strict";

const slugModule = require("slug");
const slug = typeof slugModule === "function" ? slugModule : slugModule.default;

/**
 * Wrap a plain string as a localized StretchShop object.
 * @param {string|object|null|undefined} value
 * @param {string} lang
 * @returns {object|undefined}
 */
function toLocalized(value, lang = "en") {
	if (value == null) {
		return undefined;
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		return value;
	}
	const text = String(value).trim();
	if (!text) {
		return undefined;
	}
	return { [lang]: text };
}

/**
 * Pick a string from a localized object for the preferred language.
 * @param {string|object|null|undefined} value
 * @param {string} lang
 * @returns {string}
 */
function fromLocalized(value, lang = "en") {
	if (value == null) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "object") {
		if (value[lang]) {
			return String(value[lang]);
		}
		const first = Object.values(value).find((v) => v != null && String(v).trim() !== "");
		return first != null ? String(first) : "";
	}
	return String(value);
}

/**
 * Ensure a non-empty externalId (min length 3 for Stretch validators).
 * @param {string|number|null|undefined} value
 * @param {string} fallbackPrefix
 * @returns {string}
 */
function ensureExternalId(value, fallbackPrefix = "imp") {
	const raw = value != null ? String(value).trim() : "";
	if (raw.length >= 3) {
		return raw;
	}
	if (raw.length > 0) {
		return (fallbackPrefix + "-" + raw).padEnd(3, "0");
	}
	return fallbackPrefix + "-" + Date.now().toString(36);
}

/**
 * Build a URL-safe slug from a name.
 * @param {string} name
 * @returns {string}
 */
function makeSlug(name) {
	const s = slug(String(name || "item"), { lower: true });
	return s || "item";
}

/**
 * Normalize category path "A > B > C" or "A/B/C" into segments.
 * @param {string} pathText
 * @returns {string[]}
 */
function splitCategoryPath(pathText) {
	if (!pathText || typeof pathText !== "string") {
		return [];
	}
	return pathText
		.split(/>|\//)
		.map((part) => part.trim())
		.filter(Boolean);
}

/**
 * Parse a simple CSV string into rows of objects (header → values).
 * Supports quoted fields and commas inside quotes.
 * @param {string} text
 * @returns {object[]}
 */
function parseCsv(text) {
	const rows = [];
	const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
	if (!lines.length) {
		return rows;
	}

	const header = splitCsvLine(lines[0]).map((h) => h.trim());
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line || !line.trim()) {
			continue;
		}
		const cells = splitCsvLine(line);
		const row = {};
		header.forEach((key, idx) => {
			row[key] = cells[idx] != null ? cells[idx] : "";
		});
		rows.push(row);
	}
	return rows;
}

/**
 * Split one CSV line respecting quotes.
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
	const result = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "\"") {
			if (inQuotes && line[i + 1] === "\"") {
				current += "\"";
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === "," && !inQuotes) {
			result.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	result.push(current);
	return result;
}

/**
 * Serialize rows to CSV text.
 * @param {string[]} headers
 * @param {object[]} rows
 * @returns {string}
 */
function serializeCsv(headers, rows) {
	const lines = [headers.map(csvEscape).join(",")];
	(rows || []).forEach((row) => {
		lines.push(headers.map((h) => csvEscape(row[h] != null ? row[h] : "")).join(","));
	});
	return lines.join("\n") + "\n";
}

/**
 * @param {string|number|boolean} value
 * @returns {string}
 */
function csvEscape(value) {
	const s = String(value);
	if (/[",\n\r]/.test(s)) {
		return "\"" + s.replace(/"/g, "\"\"") + "\"";
	}
	return s;
}

/**
 * Coerce XML parser value to array.
 * @param {*} value
 * @returns {Array}
 */
function asArray(value) {
	if (value == null) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

/**
 * Read text from XML node that may be string or { "#text": ... }.
 * @param {*} node
 * @returns {string}
 */
function xmlText(node) {
	if (node == null) {
		return "";
	}
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}
	if (typeof node === "object") {
		if (node["#text"] != null) {
			return String(node["#text"]);
		}
		if (node.__cdata != null) {
			return String(node.__cdata);
		}
	}
	return "";
}

module.exports = {
	toLocalized,
	fromLocalized,
	ensureExternalId,
	makeSlug,
	splitCategoryPath,
	parseCsv,
	serializeCsv,
	asArray,
	xmlText
};
