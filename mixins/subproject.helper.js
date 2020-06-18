"use strict";

const fs = require("fs");

module.exports = {
	/**
	 * Load subproject file, if exists
	 * @param {*} pathBase 
	 * @param {*} path 
	 */
	subprojectPathFix: function(pathBase, path){
		let resultPath = pathBase + path;
		try {
			if (fs.existsSync(pathBase +"/../../"+ path)) {
				resultPath = pathBase +"/../../"+ path;
			}
		} catch(err) {
			console.error("subprojectPathFix:", err);
		}
		return resultPath;
	}, 

	/**
	 * Merge routes in protective way, where base is always protected, 
	 * base route is never overwritten.
	 * Other base properties are overwriten by the update object.
	 * @param {*} base 
	 * @param {*} updatePathBase 
	 * @param {*} updatePath 
	 */
	subprojectMergeRoutes: function(base, updatePath) {
		// if updatePath exists
		if (fs.existsSync(updatePath+".js")) {
			// read its value
			const update = require(updatePath);
			// loop all parameters
			for (let prop in update) {
				if (Object.prototype.hasOwnProperty.call(update, prop)) {
					if ( prop=="aliases" ) {
						base.aliases = this.mergePropertiesProtective(
							base.aliases, 
							update.aliases
						);
					} else {
						base[prop] = update[prop];
					}
				}
			}
		}

		return base;
	},

	/**
	 * Protective 
	 * @param {*} base 
	 * @param {*} update 
	 */
	mergePropertiesProtective: function(base, update) {
		for (let prop in update) {
			if (Object.prototype.hasOwnProperty.call(update, prop)) {
				if ( typeof base[prop] === "undefined" ) {
					base[prop] = update[prop];
				}
			}
		}
		return base;
	}

};
