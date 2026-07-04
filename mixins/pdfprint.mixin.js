"use strict";

const pdfmake = require("pdfmake/js/index");
const pdfmakeFonts = require("../resources/pdftemplates/fonts/pdfmake-font-definition");
const htmlToPdfmake = require("html-to-pdfmake");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const { window } = new JSDOM("");

pdfmake.setFonts(pdfmakeFonts);
pdfmake.setLocalAccessPolicy(() => true);

module.exports = {
	/**
	 * @param {*} docDefinition
	 * @param {*} options
	 * @returns {import("pdfmake/js/OutputDocumentServer")}
	 */
	pdfDocGenerateFromDefinition(docDefinition, options) {
		options = (typeof options !== "undefined") ? options : {};
		return pdfmake.createPdf(docDefinition, options);
	},

	/**
	 * @param {*} html
	 * @param {*} options
	 * @returns {import("pdfmake/js/OutputDocumentServer")}
	 */
	generatePdfFromHtml(html, options) {
		options = (typeof options !== "undefined") ? options : {};

		const template = htmlToPdfmake(html, { window });

		const docDefinition = {
			content: [template],
			styles: {},
		};

		return this.pdfDocGenerateFromDefinition(docDefinition, options);
	},
};
