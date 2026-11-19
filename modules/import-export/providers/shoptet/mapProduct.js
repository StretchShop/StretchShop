"use strict";

const {
	toLocalized,
	fromLocalized,
	ensureExternalId,
	makeSlug,
	asArray,
	xmlText,
	splitCategoryPath
} = require("../../helpers");

/**
 * Map a Shoptet SHOPITEM (parsed object) to a StretchShop product.
 * Edit this file when Shoptet field names change.
 *
 * @param {object} item
 * @param {{ defaultLang?: string }} opts
 * @returns {object}
 */
function mapToStretch(item, opts = {}) {
	const lang = opts.defaultLang || "en";
	const code = xmlText(item.CODE) || xmlText(item.GUID) || xmlText(item.ITEM_ID);
	const name = xmlText(item.NAME) || xmlText(item.PRODUCTNAME) || code || "Product";
	const shortDesc = xmlText(item.SHORT_DESCRIPTION) || xmlText(item.SHORTDESCRIPTION);
	const longDesc = xmlText(item.DESCRIPTION) || xmlText(item.LONG_DESCRIPTION);
	const priceRaw = xmlText(item.PRICE_VAT) || xmlText(item.PRICE) || xmlText(item.PRICE_WITH_VAT) || "0";
	const price = parseFloat(String(priceRaw).replace(",", ".")) || 0;
	const vatRaw = xmlText(item.VAT) || xmlText(item.VAT_RATE) || "0";
	let tax = parseFloat(String(vatRaw).replace(",", ".").replace("%", "")) || 0;
	if (tax > 1) {
		tax = tax / 100;
	}
	const stockRaw = xmlText(item.STOCK) || xmlText(item.STOCK_AMOUNT) || xmlText(item.AMOUNT);
	const stockAmount = stockRaw !== "" ? parseFloat(String(stockRaw).replace(",", ".")) : undefined;

	const categories = collectCategoryPaths(item);

	const images = [];
	asArray(item.IMAGES && item.IMAGES.IMAGE ? item.IMAGES.IMAGE : item.IMAGE).forEach((img) => {
		const url = xmlText(img) || xmlText(img && img.IMAGE_REF);
		if (url) {
			images.push(url);
		}
	});
	asArray(item.IMAGE_REF).forEach((img) => {
		const url = xmlText(img);
		if (url) {
			images.push(url);
		}
	});

	const product = {
		externalId: ensureExternalId(code, "shoptet"),
		orderCode: code && String(code).length >= 3 ? String(code) : undefined,
		type: "product",
		subtype: "physical",
		slug: makeSlug(name),
		name: toLocalized(name, lang),
		descriptionShort: toLocalized(shortDesc, lang),
		descriptionLong: toLocalized(longDesc, lang),
		price,
		tax,
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
 * Map StretchShop product → Shoptet SHOPITEM fields (plain object for XML builder).
 * @param {object} product
 * @param {{ defaultLang?: string }} opts
 * @returns {object}
 */
function mapFromStretch(product, opts = {}) {
	const lang = opts.defaultLang || "en";
	const code = product.orderCode || product.externalId || product._id || product.id;
	const cats = Array.isArray(product.categories) ? product.categories : [];
	const item = {
		CODE: String(code || ""),
		NAME: fromLocalized(product.name, lang),
		SHORT_DESCRIPTION: fromLocalized(product.descriptionShort, lang),
		DESCRIPTION: fromLocalized(product.descriptionLong, lang),
		PRICE_VAT: product.price != null ? String(product.price) : "0",
		VAT: product.tax != null ? String(product.tax <= 1 ? product.tax * 100 : product.tax) : "0",
		STOCK: product.stockAmount != null ? String(product.stockAmount) : "",
		CATEGORIES: {
			CATEGORY: cats.map((c) => String(c).replace(/-/g, " > "))
		}
	};
	const gallery = product.data && Array.isArray(product.data.gallery) ? product.data.gallery : [];
	if (gallery.length) {
		item.IMAGES = { IMAGE: gallery };
	}
	return item;
}

function collectCategoryPaths(item) {
	const paths = [];
	const fromCategories = item.CATEGORIES && item.CATEGORIES.CATEGORY
		? asArray(item.CATEGORIES.CATEGORY)
		: [];
	fromCategories.forEach((c) => {
		const text = xmlText(c);
		if (text) {
			paths.push(pathToStretchSlug(text));
		}
	});
	asArray(item.CATEGORY).forEach((c) => {
		const text = xmlText(c);
		if (text) {
			paths.push(pathToStretchSlug(text));
		}
	});
	const categoryText = xmlText(item.CATEGORYTEXT) || xmlText(item.CATEGORY_TEXT);
	if (categoryText) {
		paths.push(pathToStretchSlug(categoryText));
	}
	return [...new Set(paths.filter(Boolean))];
}

function pathToStretchSlug(pathText) {
	const parts = splitCategoryPath(pathText);
	if (!parts.length) {
		return "";
	}
	return parts.map((p) => makeSlug(p)).join("-");
}

module.exports = {
	mapToStretch,
	mapFromStretch,
	pathToStretchSlug,
	collectCategoryPaths
};
