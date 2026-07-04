"use strict";

class JSDOM {
	constructor() {
		this.window = {
			document: {
				createElement: () => ({}),
			},
		};
	}
}

module.exports = { JSDOM };
module.exports.JSDOM = JSDOM;
