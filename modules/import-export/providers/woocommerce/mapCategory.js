"use strict";

const {
	toLocalized,
	fromLocalized,
	ensureExternalId,
	makeSlug,
	splitCategoryPath
} = require("../../helpers");

/**
 * Build Stretch categories from WooCommerce human path strings.
 * @param {string[]} pathTexts
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
			const externalId = ensureExternalId("woo-cat-" + pathSlug, "wcat");
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

function mapFromStretch(category, opts = {}) {
	const lang = opts.defaultLang || "en";
	const parents = Array.isArray(category.parentPath) ? category.parentPath : [];
	const name = fromLocalized(category.name, lang) || category.slug || "";
	return [...parents, name].filter(Boolean).join(" > ");
}

module.exports = {
	categoriesFromPaths,
	mapFromStretch
};
