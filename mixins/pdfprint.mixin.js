"use strict";

let PdfPrinterModule = require("pdfmake/js/Printer");
let PdfPrinter = PdfPrinterModule.default || PdfPrinterModule;
let pdfmakeFonts = require("./../resources/pdftemplates/fonts/pdfmake-font-definition");
var printer = new PdfPrinter(pdfmakeFonts);

let htmlToPdfmake = require("html-to-pdfmake");

let jsdom = require("jsdom");
let { JSDOM } = jsdom;
let { window } = new JSDOM("");

module.exports = {
	/**
	 * Check if user is valid according to ./resources/settings/business.js
	 * compare to its array priceLevels.validTypes.userTypes
	 * @param {*} docDefinition
	 * @param {*} options 
	 * 
	 * @returns {Object} pdfDoc
	 */
	pdfDocGenerateFromDefinition(docDefinition, options) {
		options = (typeof options !== "undefined") ?  options : {};

		return printer.createPdfKitDocument(docDefinition, options);
	},

	/**
	 * 
	 * @param {*} html 
	 * @param {*} options 
	 */
	generatePdfFromHtml(html, options) {
		options = (typeof options !== "undefined") ?  options : {};

		let template = htmlToPdfmake(html, {window:window});

		let docDefinition = {
			content: [
				template
			],
			styles:{
			}
		};

		return this.pdfDocGenerateFromDefinition(docDefinition, options);
	}
};