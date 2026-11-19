"use strict";

const {
	toLocalized,
	fromLocalized,
	ensureExternalId,
	makeSlug,
	splitCategoryPath
} = require("../../helpers");

/**
 * Editable WooCommerce CSV column → Stretch product mapping.
 * @param {object} row - CSV row
 * @param {{ defaultLang?: string }} opts
 * @returns {object}
 */
function mapToStretch(row, opts = {}) {
	const lang = opts.defaultLang || "en";
	const sku = (row.SKU || row.sku || "").trim();
	const id = (row.ID || row.Id || row.id || "").trim();
	const name = (row.Name || row.name || sku || id || "Product").trim();
	const shortDesc = (row["Short description"] || row.short_description || "").trim();
	const longDesc = (row.Description || row.description || "").trim();
	const priceRaw = row["Regular price"] || row.regular_price || row.Price || "0";
	const price = parseFloat(String(priceRaw).replace(",", ".")) || 0;
	const stockRaw = row.Stock || row.stock || row["Stock quantity"] || "";
	const stockAmount = stockRaw !== "" ? parseFloat(String(stockRaw).replace(",", ".")) : undefined;
	const categories = parseCategoriesColumn(row.Categories || row.categories || "");

	const images = String(row.Images || row.images || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	const externalId = ensureExternalId(sku || id, "woo");

	const product = {
		externalId,
		orderCode: sku && sku.length >= 3 ? sku : undefined,
		type: "product",
		subtype: mapSubtype(row.Type || row.type),
		slug: makeSlug(name),
		name: toLocalized(name, lang),
		descriptionShort: toLocalized(shortDesc, lang),
		descriptionLong: toLocalized(longDesc, lang),
		price,
		tax: 0,
		categories,
		stockAmount: Number.isFinite(stockAmount) ? stockAmount : undefined,
		data: images.length ? { gallery: images } : undefined,
		properties: {}
	};

	if (!product.descriptionShort) {
		delete product.descriptionShort;
	}
	if (!product.descriptionLong) {
		delete product.descriptionLong;
	}
	if (product.stockAmount === undefined) {
		delete product.stockAmount;
	}
	if (!product.data) {
		delete product.data;
	}
	if (!product.orderCode) {
		delete product.orderCode;
	}

	return product;
}

/**
 * Stretch product → WooCommerce CSV row.
 * @param {object} product
 * @param {{ defaultLang?: string }} opts
 * @returns {object}
 */
function mapFromStretch(product, opts = {}) {
	const lang = opts.defaultLang || "en";
	const cats = Array.isArray(product.categories) ? product.categories : [];
	const gallery = product.data && Array.isArray(product.data.gallery) ? product.data.gallery : [];
	return {
		ID: product.externalId || "",
		Type: product.subtype === "digital" ? "simple" : "simple",
		SKU: product.orderCode || product.externalId || "",
		Name: fromLocalized(product.name, lang),
		Published: "1",
		"Is featured?": "0",
		"Visibility in catalog": "visible",
		"Short description": fromLocalized(product.descriptionShort, lang),
		Description: fromLocalized(product.descriptionLong, lang),
		"Tax status": "taxable",
		"Tax class": "",
		"In stock?": product.stockAmount == null || product.stockAmount > 0 ? "1" : "0",
		Stock: product.stockAmount != null ? String(product.stockAmount) : "",
		"Regular price": product.price != null ? String(product.price) : "",
		Categories: cats.map((c) => String(c).replace(/-/g, " > ")).join(", "),
		Images: gallery.join(", "),
	};
}

function mapSubtype(type) {
	const t = String(type || "").toLowerCase();
	if (t === "virtual" || t === "downloadable") {
		return "digital";
	}
	return "physical";
}

/**
 * Parse Woo categories column: "Electronics, Home > Audio"
 * into Stretch pathSlug strings.
 * @param {string} text
 * @returns {string[]}
 */
function parseCategoriesColumn(text) {
	if (!text || !String(text).trim()) {
		return [];
	}
	// Split on commas that are not part of hierarchy — Woo uses comma between categories
	return String(text)
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((pathText) => {
			const parts = splitCategoryPath(pathText);
			return parts.map((p) => makeSlug(p)).join("-");
		})
		.filter(Boolean);
}

/**
 * Collect raw human category paths from CSV rows.
 * @param {object[]} rows
 * @returns {string[]}
 */
function collectPathTextsFromRows(rows) {
	const paths = new Set();
	(rows || []).forEach((row) => {
		const text = row.Categories || row.categories || "";
		String(text)
			.split(",")
			.map((p) => p.trim())
			.filter(Boolean)
			.forEach((p) => paths.add(p));
	});
	return Array.from(paths);
}

module.exports = {
	mapToStretch,
	mapFromStretch,
	parseCategoriesColumn,
	collectPathTextsFromRows,
	CSV_HEADERS: [
		"ID", "Type", "SKU", "Name", "Published", "Is featured?", "Visibility in catalog",
		"Short description", "Description", "Tax status", "Tax class", "In stock?", "Stock",
		"Regular price", "Categories", "Images"
	]
};
