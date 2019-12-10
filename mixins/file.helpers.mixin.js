"use strict";

const fs = require('fs');
const fspath = require('path');
const pathResolve = require('path').resolve;

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
			console.log("\n\nPO:", po);

			let noLangPath = po.dir +po.sep+ po.name +"."+ po.ext;

			if ( po.lang!=null ) { // if lang is set in name
				return this.fileExists(path) // check with LANG file exists
				.then( exists => {
					if (exists) { // exists WITH LANG
						return self.readFile(path).then(data => {
							return data;
						});
					}
				})
				.catch(err => {
					console.log("file.helpers.getCorrectFile - LANG version NOT FOUND");
					return this.fileExists(noLangPath); // return false;
				})
				.then( exists => {
					if (typeof exists === "boolean" && exists) { // exists without lang
						return self.readFile(noLangPath).then(data => {
							return data;
						});
					} else if ( typeof exists === "string" ) { // if result string returned
						return exists;
					}
					return null; // does NOT exist
				});
			} else {
				return this.fileExists(noLangPath) // check if NO lang file exists
				.then( exists => {
					if (exists) { // exists without lang
						return self.readFile(noLangPath).then(data => {
							return data;
						});
					}
					return null; // does NOT exist
				});
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
			}

			let sep = (typeof fspath != "undefined" && typeof fspath.sep != "undefined") ? fspath.sep : "\/";
			let separator = (["\/","\\"].indexOf(sep)) ? sep : "\/";
			pathObject.sep = separator;

			let pathArray = path.split(/[\\/]/); // split path into array - with any path separator
			let fullName = pathArray.pop(); // pop last item from path array, to get file name
			pathObject.dir = pathArray.join(separator); // get directory path by 
			let nameArray = fullName.split(/[\.]/); // split name into extension
			pathObject.ext = nameArray.pop(); // get extension
			let nameWithLang = (nameArray.constructor === Array && nameArray.length>0) ? nameArray.join(".") : nameArray;
			let nameWithLangArray = nameWithLang.split(/[\-]/);
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
		getExtension(path) {
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
						console.log("file.helpers.fileExists ("+path+") ERROR:", err);
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
				fs.readFile(filepath, 'utf8', (err, data) => {
						if (err) { 
							console.log("file.helpers.readFile ("+path+") ERROR:", err);
							reject(err)
						}
						resolve(data);
				});
			})
			.then(data => {
				return data;
			});
		}

  }
};
