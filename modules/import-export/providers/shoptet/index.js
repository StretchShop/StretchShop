"use strict";

const { XMLParser, XMLBuilder } = require("fast-xml-parser");
const { asArray } = require("../../helpers");
const mapProduct = require("./mapProduct");
const mapCategory = require("./mapCategory");

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	cdataPropName: "__cdata",
	trimValues: true,
	isArray: (name) => ["SHOPITEM", "CATEGORY", "IMAGE", "IMAGE_REF"].includes(name)
});

const builder = new XMLBuilder({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	cdataPropName: "__cdata",
	format: true,
	suppressEmptyNode: true
});

/**
 * Parse Shoptet complete products XML into Stretch entities.
 * Pages are not supported for Shoptet in v1.
 */
function parse(buffer, opts = {}) {
	const entities = opts.entities || ["products", "categories"];
	if (entities.includes("pages")) {
		throw new Error("Pages are not supported for Shoptet import");
	}

	const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
	let parsed;
	try {
		parsed = parser.parse(text);
	} catch (err) {
		throw new Error("Invalid Shoptet XML: " + err.message, { cause: err });
	}

	const shop = parsed.SHOP || parsed.shop || parsed;
	const items = asArray(shop.SHOPITEM || shop.shopitem || []);
	const products = entities.includes("products")
		? items.map((item) => mapProduct.mapToStretch(item, opts))
		: [];

	let categories = [];
	if (entities.includes("categories")) {
		const pathTexts = mapCategory.collectPathTextsFromItems(items);
		categories = mapCategory.categoriesFromPaths(pathTexts, opts);
	}

	return { products, categories, pages: [] };
}

/**
 * Serialize Stretch products (+ categories embedded on products) to Shoptet XML.
 */
function serialize({ products = [] } = {}, opts = {}) {
	const entities = opts.entities || ["products", "categories"];
	if (entities.includes("pages")) {
		throw new Error("Pages are not supported for Shoptet export");
	}

	const shopItems = (products || []).map((p) => mapProduct.mapFromStretch(p, opts));
	let xml = builder.build({ SHOP: { SHOPITEM: shopItems } });
	if (!xml.startsWith("<?xml")) {
		xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + xml;
	}
	return {
		filename: "shoptet-products.xml",
		contentType: "application/xml",
		buffer: Buffer.from(xml, "utf8")
	};
}

module.exports = {
	id: "shoptet",
	label: "Shoptet",
	entities: {
		products: true,
		categories: true,
		pages: false
	},
	import: {
		accept: [".xml"],
		parse
	},
	export: {
		serialize
	},
	mapToStretch: {
		product: mapProduct.mapToStretch,
		category: (pathText, opts) => mapCategory.categoriesFromPaths([pathText], opts)[0],
		page: null
	},
	mapFromStretch: {
		product: mapProduct.mapFromStretch,
		category: mapCategory.mapFromStretch,
		page: null
	}
};
