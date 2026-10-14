"use strict";

const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");
const { getFormat } = require("./registry");
const { orderLanguage } = require("./model-helpers");

const compiled = new Map();

function resourcesRoot(options) {
	if (options.resourcesPath) {
		return options.resourcesPath;
	}
	if (process.env.PATH_RESOURCES) {
		return process.env.PATH_RESOURCES;
	}
	return path.resolve(__dirname, "../../resources");
}

function loadCountries(root) {
	const file = path.join(root, "settings", "locals.json");
	try {
		const locals = JSON.parse(fs.readFileSync(file, "utf8"));
		return Array.isArray(locals.countries) ? locals.countries : [];
	} catch {
		return [];
	}
}

function compileTemplate(file) {
	const stat = fs.statSync(file);
	const cached = compiled.get(file);
	if (cached && cached.mtimeMs === stat.mtimeMs) {
		return cached.template;
	}
	const template = handlebars.compile(fs.readFileSync(file, "utf8"), { noEscape: false });
	compiled.set(file, { mtimeMs: stat.mtimeMs, template });
	return template;
}

function resolveTemplate(dir, base, lang) {
	const names = [base + "-" + lang + ".xml"];
	if (lang !== "en") {
		names.push(base + "-en.xml");
	}
	names.push(base + ".xml");
	for (const name of names) {
		const file = path.join(dir, name);
		if (fs.existsSync(file)) {
			return file;
		}
	}
	return null;
}

function safeFileBase(invoiceId) {
	const raw = String(invoiceId || "").trim();
	if (!raw || raw.includes("..") || raw.includes("/") || raw.includes("\\")) {
		throw new Error("e-invoice invoice id is not a safe file name");
	}
	return raw;
}

/**
 * Fill the Handlebars XML template for the selected format and language.
 * Same data bag as the PDF invoice, plus an `einvoice` view model of
 * normalized EN 16931 values.
 */
function render(options) {
	const order = options.order || {};
	if (!order.invoice?.id) {
		throw new Error("e-invoice requires order.invoice.id");
	}
	const root = resourcesRoot(options);
	const business = options.business || {};
	const format = getFormat(options.formatId || business.invoiceData?.einvoice?.format);
	const lang = orderLanguage(order);
	const templateDir = path.join(root, "e-invtemplates");
	const templateFile = resolveTemplate(templateDir, format.templateBase, lang);
	if (!templateFile) {
		throw new Error("e-invoice template not found for " + format.id + " (" + lang + ")");
	}
	const einvoice = format.buildModel({
		order,
		business,
		countries: options.countries || loadCountries(root),
		lang
	});
	const xml = compileTemplate(templateFile)({
		order,
		business,
		einvoice
	});
	return {
		xml,
		formatId: format.id,
		lang,
		fileBase: safeFileBase(order.invoice.id),
		templateFile
	};
}

module.exports = {
	render,
	resourcesRoot
};
