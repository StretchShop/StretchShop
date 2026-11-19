"use strict";

const { XMLParser, XMLBuilder } = require("fast-xml-parser");
const { parseCsv, serializeCsv } = require("../../helpers");
const { createZip, extractZip } = require("../../zip");
const mapProduct = require("./mapProduct");
const mapCategory = require("./mapCategory");
const mapPage = require("./mapPage");

const wxrParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	cdataPropName: "__cdata",
	trimValues: true,
	isArray: (name) => ["item"].includes(name)
});

const wxrBuilder = new XMLBuilder({
	ignoreAttributes: false,
	cdataPropName: "__cdata",
	format: true,
	suppressEmptyNode: true
});

function parse(buffer, opts = {}) {
	const entities = opts.entities || ["products", "categories", "pages"];
	const filename = (opts.filename || "").toLowerCase();
	const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");

	if (filename.endsWith(".zip") || isZip(buf)) {
		return parseZip(buf, opts, entities);
	}
	if (filename.endsWith(".xml") || looksLikeXml(buf)) {
		return parseWxr(buf, opts, entities);
	}
	if (filename.endsWith(".json") || looksLikeJson(buf)) {
		return parseJsonBundle(buf, opts, entities);
	}
	return parseProductsCsv(buf, opts, entities);
}

function parseZip(buf, opts, entities) {
	const files = extractZip(buf);
	const result = { products: [], categories: [], pages: [] };
	Object.keys(files).forEach((name) => {
		const lower = name.toLowerCase();
		const content = files[name];
		if (lower.endsWith(".csv")) {
			const part = parseProductsCsv(content, opts, entities);
			result.products.push(...part.products);
			result.categories.push(...part.categories);
		} else if (lower.endsWith(".xml")) {
			const part = parseWxr(content, opts, entities);
			result.pages.push(...part.pages);
		} else if (lower.endsWith(".json")) {
			const part = parseJsonBundle(content, opts, entities);
			result.products.push(...part.products);
			result.categories.push(...part.categories);
			result.pages.push(...part.pages);
		}
	});
	result.categories = dedupeByExternalId(result.categories);
	return result;
}

function parseProductsCsv(buf, opts, entities) {
	const text = buf.toString("utf8");
	const rows = parseCsv(text);
	const products = entities.includes("products")
		? rows
			.filter((row) => {
				const type = String(row.Type || row.type || "simple").toLowerCase();
				return type !== "variation" && (row.Name || row.SKU || row.ID);
			})
			.map((row) => mapProduct.mapToStretch(row, opts))
		: [];

	let categories = [];
	if (entities.includes("categories")) {
		const pathTexts = mapProduct.collectPathTextsFromRows(rows);
		categories = mapCategory.categoriesFromPaths(pathTexts, opts);
	}

	return { products, categories, pages: [] };
}

function parseWxr(buf, opts, entities) {
	if (!entities.includes("pages")) {
		return { products: [], categories: [], pages: [] };
	}
	let parsed;
	try {
		parsed = wxrParser.parse(buf.toString("utf8"));
	} catch (err) {
		throw new Error("Invalid WooCommerce/WordPress WXR: " + err.message, { cause: err });
	}
	const items = mapPage.extractItems(parsed);
	const pages = items
		.map((item) => mapPage.mapToStretch(item, opts))
		.filter(Boolean);
	return { products: [], categories: [], pages };
}

function parseJsonBundle(buf, opts, entities) {
	let data;
	try {
		data = JSON.parse(buf.toString("utf8"));
	} catch (err) {
		throw new Error("Invalid WooCommerce JSON bundle: " + err.message, { cause: err });
	}
	const result = { products: [], categories: [], pages: [] };
	if (data.productsCsv && (entities.includes("products") || entities.includes("categories"))) {
		const part = parseProductsCsv(Buffer.from(String(data.productsCsv), "utf8"), opts, entities);
		result.products = part.products;
		result.categories = part.categories;
	}
	if (data.pagesXml && entities.includes("pages")) {
		const part = parseWxr(Buffer.from(String(data.pagesXml), "utf8"), opts, entities);
		result.pages = part.pages;
	}
	if (Array.isArray(data.products) && entities.includes("products")) {
		result.products = data.products;
	}
	if (Array.isArray(data.categories) && entities.includes("categories")) {
		result.categories = data.categories;
	}
	if (Array.isArray(data.pages) && entities.includes("pages")) {
		result.pages = data.pages;
	}
	return result;
}

function serialize({ products = [], categories = [], pages = [] } = {}, opts = {}) {
	const entities = opts.entities || ["products", "categories", "pages"];
	const wantProducts = entities.includes("products") || entities.includes("categories");
	const wantPages = entities.includes("pages");

	const csv = wantProducts
		? serializeCsv(
			mapProduct.CSV_HEADERS,
			(products || []).map((p) => mapProduct.mapFromStretch(p, opts))
		)
		: "";
	const wxr = wantPages ? buildWxr(pages, opts) : "";

	if (wantProducts && wantPages) {
		const zipBuf = createZip({
			"products.csv": Buffer.from(csv, "utf8"),
			"pages.xml": Buffer.from(wxr, "utf8")
		});
		return {
			filename: "woocommerce-export.zip",
			contentType: "application/zip",
			buffer: zipBuf
		};
	}
	if (wantPages) {
		return {
			filename: "woocommerce-pages.xml",
			contentType: "application/xml",
			buffer: Buffer.from(wxr, "utf8")
		};
	}
	void categories;
	return {
		filename: "woocommerce-products.csv",
		contentType: "text/csv",
		buffer: Buffer.from(csv, "utf8")
	};
}

function buildWxr(pages, opts) {
	const items = (pages || []).map((p) => {
		const mapped = mapPage.mapFromStretch(p, opts);
		return {
			title: mapped.title,
			link: mapped.link,
			guid: mapped.guid,
			"content:encoded": mapped["content:encoded"],
			"wp:post_id": mapped["wp:post_id"],
			"wp:post_name": mapped["wp:post_name"],
			"wp:post_type": "page",
			"wp:status": "publish"
		};
	});
	const xml = wxrBuilder.build({
		rss: {
			"@_version": "2.0",
			"@_xmlns:content": "http://purl.org/rss/1.0/modules/content/",
			"@_xmlns:wp": "http://wordpress.org/export/1.2/",
			channel: {
				title: "StretchShop WooCommerce pages export",
				item: items
			}
		}
	});
	return xml.startsWith("<?xml") ? xml : "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + xml;
}

function isZip(buf) {
	return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function looksLikeXml(buf) {
	const head = buf.slice(0, 200).toString("utf8").trim();
	return head.startsWith("<");
}

function looksLikeJson(buf) {
	const head = buf.slice(0, 200).toString("utf8").trim();
	return head.startsWith("{") || head.startsWith("[");
}

function dedupeByExternalId(list) {
	const map = new Map();
	(list || []).forEach((item) => {
		if (item && item.externalId) {
			map.set(item.externalId, item);
		}
	});
	return Array.from(map.values());
}

module.exports = {
	id: "woocommerce",
	label: "WooCommerce",
	entities: {
		products: true,
		categories: true,
		pages: true
	},
	import: {
		accept: [".csv", ".xml", ".zip", ".json"],
		parse
	},
	export: {
		serialize
	},
	mapToStretch: {
		product: mapProduct.mapToStretch,
		category: (pathText, opts) => mapCategory.categoriesFromPaths([pathText], opts)[0],
		page: mapPage.mapToStretch
	},
	mapFromStretch: {
		product: mapProduct.mapFromStretch,
		category: mapCategory.mapFromStretch,
		page: mapPage.mapFromStretch
	}
};
