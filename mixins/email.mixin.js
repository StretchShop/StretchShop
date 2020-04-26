"use strict";

require("dotenv").config();
const fs = require("fs");
const pathResolve = require("path").resolve;
const handlebars = require("handlebars");
const sppf = require("../mixins/subprojpathfix");
let resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojpathfix(__dirname, "/../resources");

module.exports = function(emailTemplateName, inputData, requiredFormats){
	emailTemplateName = (typeof emailTemplateName !== "undefined") ?  emailTemplateName : "registration";
	inputData = (typeof inputData !== "undefined") ?  inputData : {};
	requiredFormats = (typeof requiredFormats !== "undefined") ?  requiredFormats : ["html","txt"];

	let promises = [];

	// loop products to import
	requiredFormats.forEach(function(format) {
		promises.push(
			new Promise(function(resolve, reject) {
				let filename = emailTemplateName+"."+format;
				let filepath = resourcesDirectory+"/emails/user/"+filename;
				filepath = pathResolve(filepath);
				fs.readFile(filepath, "utf8", (err, data) => {
					if (err) {
						reject(err);
					}
					resolve({
						format: format,
						data: data
					});
				});

			})
				.then( (result) => {
					if ( inputData && Object.keys(inputData).length>0 ) {
						// Object.keys(inputData).forEach((key) => {
						//   let re = new RegExp("<!-- "+key+" //-->", 'g');
						//   result.data = result.data.toString().replace(re, inputData[key]);
						// });
						console.log("\n\n mixins.email.inputData:", inputData);
						let template = handlebars.compile(result.data.toString());
						result.data = template(inputData);
					}

					return result;
				})); // push with findOne end
	});


	// return multiple promises results
	return Promise.all(promises).then((results) => {

		let newResults = {};
		if ( results && results.length>0 ) {
			results.forEach((item) => {
				newResults[item.format] = item.data;
			});
		}

		return newResults;
	});
};
