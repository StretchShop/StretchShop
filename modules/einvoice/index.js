"use strict";

const path = require("path");
const { ensureDir, writeFile } = require("fs-extra");
const { listFormats, getFormat, DEFAULT_FORMAT } = require("./registry");
const { render } = require("./render");
const { sendXml, clearAuthCache } = require("./send");

function log(logger, level, ...args) {
	if (logger && typeof logger[level] === "function") {
		logger[level](...args);
	}
}

/**
 * Render the e-invoice, store it next to the PDF, and submit it when
 * E_INVOICE_URL is configured. A failed submission still keeps the file.
 */
async function generateAndSend(options) {
	const rendered = render(options);
	if (!options.outputDir) {
		throw new Error("e-invoice output directory is missing");
	}
	await ensureDir(options.outputDir);
	const fileName = rendered.fileBase + ".xml";
	const absolutePath = path.join(options.outputDir, fileName);
	await writeFile(absolutePath, rendered.xml, "utf8");
	log(options.logger, "info", "einvoice.generateAndSend() - stored", absolutePath);

	const relativeDir = String(options.relativeDir || "").replace(/\\/g, "/").replace(/\/$/, "");
	const relativePath = relativeDir ? relativeDir + "/" + fileName : fileName;
	let delivery;
	try {
		delivery = await sendXml({
			xml: rendered.xml,
			logger: options.logger,
			request: options.request,
			env: options.env
		});
	} catch (error) {
		log(options.logger, "error", "einvoice.generateAndSend() - send failed:", error);
		delivery = {
			sent: false,
			status: null,
			error: error?.message || "send failed"
		};
	}
	return {
		format: rendered.formatId,
		lang: rendered.lang,
		path: relativePath,
		sent: delivery.sent,
		status: delivery.status,
		error: delivery.error
	};
}

module.exports = {
	DEFAULT_FORMAT,
	listFormats,
	getFormat,
	render,
	sendXml,
	generateAndSend,
	clearAuthCache
};
