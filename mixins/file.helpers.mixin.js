"use strict";

const fs = require("fs");
const fspath = require("path");
const pathResolve = require("path").resolve;

module.exports = {
	methods: {

		/**
		 * 1. check if file with lang suffix exists
		 * 2. if not, check if file without lang suffix exists
		 * 3. reads content of file if any found
		 * @param {String} path - path with language suffix
		 * 
		 * @returns {Promise} promise of file content reader
		 */
		getCorrectFile(path) {
			let self = this;
			let po = this.splitPath(path); // get path object
			this.logger.info("mixins file.helpers - splited path: ", po);

			let noLangPath = po.dir +po.sep+ po.name +"."+ po.ext;

			if ( po.lang!=null ) { // if lang is set in name
				if ( fs.existsSync(path) ) { // LANG file exists
					return self.readFile(path).then(data => {
						return data;
					});
				} else {
					if ( fs.existsSync(noLangPath) ) { // exists without lang
						return self.readFile(noLangPath).then(data => {
							return data;
						});
					}
					return null; // does NOT exist
				}
			} else {
				if ( fs.existsSync(noLangPath) ) { // check if NO lang file exists
					return self.readFile(noLangPath).then(data => {
						return data;
					});
				}
				return null; // does NOT exist
			}
		},

		/**
		 * Split path into path object with parent directory, name, language code and extension
		 * @param {String} path 
		 */
		splitPath(path) {
			let pathObject = {
				dir: null,
				name: null, 
				lang: null,
				ext: null,
				sep: null
			};

			let sep = (typeof fspath != "undefined" && typeof fspath.sep != "undefined") ? fspath.sep : "/";
			let separator = (["/","\\"].indexOf(sep)) ? sep : "/";
			pathObject.sep = separator;

			let pathArray = path.split(/[\\/]/); // split path into array - with any path separator
			let fullName = pathArray.pop(); // pop last item from path array, to get file name
			pathObject.dir = pathArray.join(separator); // get directory path by 
			let nameArray = fullName.split(/[.]/); // split name into extension
			pathObject.ext = nameArray.pop(); // get extension
			let nameWithLang = (nameArray.constructor === Array && nameArray.length>0) ? nameArray.join(".") : nameArray;
			let nameWithLangArray = nameWithLang.split(/[-]/);
			if ( nameWithLangArray.constructor === Array && nameWithLangArray.length>1 ) {
				pathObject.lang = nameWithLangArray.pop();
				pathObject.name = nameWithLangArray.join("-");
			} else {
				pathObject.name = nameWithLangArray[nameWithLangArray.length-1];
			}

			return pathObject;
		},

		/**
		 * Simple function to get only file extension
		 * @param {String} path 
		 */
		getExtension(fname) {
			return fname.slice((Math.max(0, fname.lastIndexOf(".")) || Infinity) + 1);
		},
		
		/**
		 * Check if file exists and is readable
		 * @param {Boolean} path 
		 */
		fileExists(path) {
			return new Promise(function(resolve, reject) {
				fs.access(path, fs.constants.F_OK | fs.constants.R_OK, (err) => {
					if (err) {
						this.logger.error("mixins file.helpers - fileExists ("+path+") error:", err);
						reject(false);
					}
					resolve(true);
				});
			});
		},
	
		/**
		 * Read contents of the file
		 * @param {String} path 
		 */
		readFile(path) {
			return new Promise(function(resolve, reject) {
				let filepath = pathResolve(path);
				fs.readFile(filepath, "utf8", (err, data) => {
					if (err) { 
						this.logger.error("mixins file.helpers - readFile ("+path+") error:", err);
						reject(err);
					}
					resolve(data);
				});
			})
				.then(data => {
					return data;
				});
		},

		/**
		 * Removing any parent traversing from resources path.
		 * Note: When runing from library, path to load resources requires parent traversing,
		 * but application itself don't want it
		 * @param {String} path 
		*/
		removeParentTraversing(path) {
			path = path.replace(/^(\.\.(\/|\\|$))+/g,"");
			return path;
		}

	}
};
