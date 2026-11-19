"use strict";

/**
 * StretchShop native JSON provider — round-trip { products, categories, pages }.
 */

function parse(buffer) {
	const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
	let data;
	try {
		data = JSON.parse(text);
	} catch (err) {
		throw new Error("Invalid StretchShop JSON: " + err.message, { cause: err });
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new Error("StretchShop export must be a JSON object");
	}
	return {
		products: Array.isArray(data.products) ? data.products : [],
		categories: Array.isArray(data.categories) ? data.categories : [],
		pages: Array.isArray(data.pages) ? data.pages : []
	};
}

function serialize({ products = [], categories = [], pages = [] } = {}, opts = {}) {
	const entities = opts.entities || ["products", "categories", "pages"];
	const payload = {};
	if (entities.includes("products")) {
		payload.products = products;
	}
	if (entities.includes("categories")) {
		payload.categories = categories;
	}
	if (entities.includes("pages")) {
		payload.pages = pages;
	}
	const json = JSON.stringify(payload, null, 2);
	return {
		filename: "stretchshop-export.json",
		contentType: "application/json",
		buffer: Buffer.from(json, "utf8")
	};
}

module.exports = {
	id: "stretchshop",
	label: "StretchShop",
	entities: {
		products: true,
		categories: true,
		pages: true
	},
	import: {
		accept: [".json"],
		parse
	},
	export: {
		serialize
	},
	mapToStretch: {
		product: (p) => p,
		category: (c) => c,
		page: (p) => p
	},
	mapFromStretch: {
		product: (p) => p,
		category: (c) => c,
		page: (p) => p
	}
};
