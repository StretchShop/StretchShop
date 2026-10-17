"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_FORMAT = "en16931-peppolBisBilling30";

/**
 * Each file in ./formats that exports { id, templateBase, buildModel }
 * is an e-invoice format. Drop a file there to add another syntax.
 */
function loadFormats() {
	const dir = path.join(__dirname, "formats");
	return fs.readdirSync(dir)
		.filter(name => name.endsWith(".js"))
		.map(name => require(path.join(dir, name)))
		.filter(format => format && format.id && format.templateBase && typeof format.buildModel === "function");
}

let cached = null;

function formats() {
	if (!cached) {
		cached = loadFormats();
	}
	return cached;
}

function listFormats() {
	return formats().map(format => ({
		id: format.id,
		syntax: format.syntax || "",
		templateBase: format.templateBase
	}));
}

function getFormat(id) {
	const requested = String(id || process.env.E_INVOICE_FORMAT || "").trim();
	const wanted = requested || DEFAULT_FORMAT;
	const found = formats().find(format => format.id === wanted);
	if (!found) {
		throw new Error("Unknown e-invoice format: " + wanted);
	}
	return found;
}

module.exports = {
	DEFAULT_FORMAT,
	listFormats,
	getFormat
};
