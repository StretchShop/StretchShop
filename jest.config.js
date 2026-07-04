"use strict";

/** @type {import("jest").Config} */
module.exports = {
	testEnvironment: "node",
	setupFilesAfterEnv: ["<rootDir>/test/setup/jest.setup.js"],
	testMatch: ["<rootDir>/test/unit/**/*.spec.js"],
	moduleNameMapper: {
		"^jsdom$": "<rootDir>/test/mocks/jsdom.js",
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
	forceExit: true,
	testTimeout: 30000,
};
