"use strict";

const stretchshop = require("./providers/stretchshop");
const shoptet = require("./providers/shoptet");
const woocommerce = require("./providers/woocommerce");

const PROVIDERS = [stretchshop, shoptet, woocommerce];

/**
 * List available import/export providers (safe for API responses).
 * @returns {Array<{id: string, label: string, entities: object, accept: string[]}>}
 */
function listProviders() {
	return PROVIDERS.map((p) => ({
		id: p.id,
		label: p.label,
		entities: { ...p.entities },
		accept: (p.import && p.import.accept) || []
	}));
}

/**
 * @param {string} id
 * @returns {object}
 */
function getProvider(id) {
	const wanted = String(id || "").trim().toLowerCase();
	const found = PROVIDERS.find((p) => p.id === wanted);
	if (!found) {
		throw new Error("Unknown import/export provider: " + id);
	}
	return found;
}

module.exports = {
	listProviders,
	getProvider,
	PROVIDERS
};
