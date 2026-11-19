"use strict";

const {
	toLocalized,
	fromLocalized,
	ensureExternalId,
	makeSlug,
	asArray,
	xmlText
} = require("../../helpers");

/**
 * Map a WordPress WXR item (post_type=page) to StretchShop page.
 * @param {object} item
 * @param {{ defaultLang?: string }} opts
 * @returns {object|null}
 */
function mapToStretch(item, opts = {}) {
	const lang = opts.defaultLang || "en";
	const postType = xmlText(item["wp:post_type"]) || xmlText(item.post_type) || "";
	if (postType && postType !== "page") {
		return null;
	}
	const title = xmlText(item.title) || "Page";
	const content = xmlText(item["content:encoded"]) || xmlText(item.description) || "";
	const postId = xmlText(item["wp:post_id"]) || xmlText(item.guid) || title;
	const postName = xmlText(item["wp:post_name"]) || makeSlug(title);

	return {
		externalId: ensureExternalId("woo-page-" + postId, "wpage"),
		type: "page",
		subtype: "default",
		slug: makeSlug(postName || title),
		name: toLocalized(title, lang),
		descriptionLong: toLocalized(content, lang),
		data: {
			blocks: content ? [{ type: "html", content }] : []
		}
	};
}

/**
 * Stretch page → WXR item fields.
 * @param {object} page
 * @param {{ defaultLang?: string }} opts
 * @returns {object}
 */
function mapFromStretch(page, opts = {}) {
	const lang = opts.defaultLang || "en";
	const title = fromLocalized(page.name, lang);
	const content = fromLocalized(page.descriptionLong, lang)
		|| (page.data && Array.isArray(page.data.blocks)
			? page.data.blocks.map((b) => b.content || "").join("\n")
			: "");
	return {
		title,
		link: "",
		guid: page.externalId || page.slug || "",
		"content:encoded": content,
		"wp:post_id": page.externalId || "",
		"wp:post_name": page.slug || makeSlug(title),
		"wp:post_type": "page",
		"wp:status": "publish"
	};
}

/**
 * Extract page items from parsed WXR / RSS object.
 * @param {object} parsed
 * @returns {object[]}
 */
function extractItems(parsed) {
	const channel = (parsed.rss && parsed.rss.channel)
		|| (parsed.channel)
		|| parsed;
	return asArray(channel.item || []);
}

module.exports = {
	mapToStretch,
	mapFromStretch,
	extractItems
};
