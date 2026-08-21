"use strict";

require("dotenv").config();
const fs = require("fs");
const pathResolve = require("path").resolve;
const handlebars = require("handlebars");
const sppf = require("../mixins/subproject.helper");

function getResourcesDirectory() {
	return process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../resources");
}

function getTemplateFilePath(emailTemplateName, format) {
	return pathResolve(getResourcesDirectory() + "/emails/user/" + emailTemplateName + "." + format);
}

function readTemplateFile(emailTemplateName, format) {
	const filepath = getTemplateFilePath(emailTemplateName, format);
	return new Promise(function(resolve, reject) {
		fs.readFile(filepath, "utf8", (err, data) => {
			if (err) {
				return reject(err);
			}
			resolve(data);
		});
	});
}

function compileTemplate(source, inputData) {
	if (inputData && Object.keys(inputData).length > 0) {
		const template = handlebars.compile(source.toString());
		return template(inputData);
	}
	return source.toString();
}

/**
 * Wrap compiled body in a language-specific layout (e.g. main-en.html).
 * Falls back to main-en, then to the unwrapped body if no layout exists.
 */
function wrapInLayout(layoutName, format, compiledBody, inputData) {
	if (!layoutName) {
		return Promise.resolve(compiledBody);
	}

	const fallbackLayoutName = (layoutName !== "main-en" && layoutName.startsWith("main-"))
		? "main-en"
		: null;

	return readTemplateFile(layoutName, format)
		.catch((error) => {
			if (fallbackLayoutName) {
				return readTemplateFile(fallbackLayoutName, format);
			}
			return Promise.reject(error);
		})
		.then((layoutSource) => {
			const layoutData = { ...inputData, body: compiledBody };
			return compileTemplate(layoutSource, layoutData);
		})
		.catch((error) => {
			console.error(
				"email.mixin - layout template missing or invalid (" + layoutName + "." + format + "):",
				error.message || error
			);
			return compiledBody;
		});
}

/**
 * Load email templates, compile with Handlebars, and optionally wrap in a layout.
 *
 * @param {String} emailTemplateName - relative name, e.g. "auth/registration-en"
 * @param {Object} inputData - Handlebars data
 * @param {String[]} requiredFormats - e.g. ["html","txt"]
 * @param {Object} [options]
 * @param {String} [options.layout] - layout name, e.g. "main-en"
 * @returns {Promise<Object>} map of format -> compiled string
 */
module.exports = function(emailTemplateName, inputData, requiredFormats, options) {
	emailTemplateName = (typeof emailTemplateName !== "undefined") ? emailTemplateName : "auth/registration";
	inputData = (typeof inputData !== "undefined") ? inputData : {};
	requiredFormats = (typeof requiredFormats !== "undefined") ? requiredFormats : ["html","txt"];
	options = options || {};
	const layoutName = options.layout || null;

	let promises = [];

	requiredFormats.forEach(function(format) {
		promises.push(
			readTemplateFile(emailTemplateName, format)
				.then((source) => {
					const compiled = compileTemplate(source, inputData);
					return wrapInLayout(layoutName, format, compiled, inputData)
						.then((wrapped) => ({
							format: format,
							data: wrapped
						}));
				})
				.catch(error => {
					console.error("email.mixin - email template ERROR:", error);
					return Promise.reject(error);
				})
		);
	});

	return Promise.all(promises).then((results) => {
		let newResults = {};
		if ( results && results.length>0 ) {
			results.forEach((item) => {
				if (item && item.format) {
					newResults[item.format] = item.data;
				}
			});
		}

		return newResults;
	});
};
