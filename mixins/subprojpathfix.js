"use strict";

const fs = require("fs");

module.exports = {
	subprojpathfix: function(pathBase, path){
		let resultPath = pathBase + path;
		try {
			if (fs.existsSync(pathBase +"/../../"+ path)) {
				resultPath = pathBase +"/../../"+ path;
			}
		} catch(err) {
			console.error("subprojpathfix:", err);
		}
		return resultPath;
	}
};
