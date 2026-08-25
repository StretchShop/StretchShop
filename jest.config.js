"use strict";

/** @type {import("jest").Config} */
module.exports = {
	testEnvironment: "node",
	setupFilesAfterEnv: ["<rootDir>/test/setup/jest.setup.js"],
	testMatch: ["<rootDir>/test/unit/**/*.spec.js"],
	moduleNameMapper: {
		"^jsdom$": "<rootDir>/test/mocks/jsdom.js",
		// ESM-only packages — Jest's CJS loader cannot parse their `export` syntax
		"^slug$": "<rootDir>/test/mocks/slug.js",
		"^cookie$": "<rootDir>/test/mocks/cookie.js",
	},
	collectCoverageFrom: [
		"services/**/*.js",
		"mixins/**/*.js",
		"!services/coverage/**",
	],
	coveragePathIgnorePatterns: [
		"/node_modules/",
		"/coverage/",
	],
	coverageDirectory: "coverage",
	coverageThreshold: {
		global: {
			statements: 60,
			lines: 60,
		},
	},
	forceExit: true,
	testTimeout: 30000,
};
