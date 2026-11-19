"use strict";

const {
	toLocalized,
	fromLocalized,
	ensureExternalId,
	makeSlug,
	splitCategoryPath,
	asArray,
	xmlText
} = require("../../helpers");

/**
 * Build StretchShop category entities from unique Shoptet category path strings.
 * @param {string[]} pathTexts - human paths like "Fashion > Shirts"
 * @param {{ defaultLang?: string }} opts
 * @returns {object[]}
 */
function categoriesFromPaths(pathTexts, opts = {}) {
	const lang = opts.defaultLang || "en";
	const byExternalId = new Map();

	(pathTexts || []).forEach((pathText) => {
		const parts = splitCategoryPath(pathText);
		if (!parts.length) {
			return;
		}
		const parentPath = [];
		parts.forEach((part) => {
			const slugPart = makeSlug(part);
			const parentPathSlug = parentPath.length
				? parentPath.map((p) => makeSlug(p)).join("-")
				: "";
			const pathSlug = parentPathSlug ? parentPathSlug + "-" + slugPart : slugPart;
			const externalId = ensureExternalId("cat-" + pathSlug, "cat");
			if (!byExternalId.has(externalId)) {
				byExternalId.set(externalId, {
					externalId,
					type: "category",
					slug: slugPart,
					pathSlug,
					parentPath: parentPath.map((p) => makeSlug(p)),
					parentPathSlug: parentPathSlug || undefined,
					name: toLocalized(part, lang)
				});
			}
			parentPath.push(part);
		});
	});

	return Array.from(byExternalId.values());
}

/**
 * Map Stretch category → simple path label for Shoptet.
 * @param {object} category
 * @param {{ defaultLang?: string }} opts
 * @returns {string}
 */
function mapFromStretch(category, opts = {}) {
	const lang = opts.defaultLang || "en";
	const parents = Array.isArray(category.parentPath) ? category.parentPath : [];
	const name = fromLocalized(category.name, lang) || category.slug || "";
	const parts = [...parents, name].filter(Boolean);
	return parts.join(" > ");
}

/**
 * Collect human-readable category paths from Shoptet product items for category import.
 * @param {object[]} shopItems
 * @returns {string[]}
 */
function collectPathTextsFromItems(shopItems) {
	const paths = new Set();
	(shopItems || []).forEach((item) => {
		const cats = item.CATEGORIES && item.CATEGORIES.CATEGORY
			? asArray(item.CATEGORIES.CATEGORY)
			: [];
		cats.forEach((c) => {
			const text = xmlText(c);
			if (text) {
				paths.add(text);
			}
		});
		const singleText = xmlText(item.CATEGORY);
		if (singleText) {
			paths.add(singleText);
		}
		const categoryText = xmlText(item.CATEGORYTEXT) || xmlText(item.CATEGORY_TEXT);
		if (categoryText) {
			paths.add(categoryText);
		}
	});
	return Array.from(paths);
}

module.exports = {
	categoriesFromPaths,
	mapFromStretch,
	collectPathTextsFromItems
};
