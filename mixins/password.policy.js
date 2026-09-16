"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

const MIN_LENGTH = 8;
const MAX_BYTES = 72;

const DENYLIST = new Set([
	"password",
	"password1",
	"password12",
	"password123",
	"12345678",
	"123456789",
	"qwerty123",
	"letmein",
	"welcome",
	"admin123",
	"iloveyou",
	"monkey12",
	"abc12345",
	"passw0rd",
]);

/**
 * @param {*} password
 * @returns {{ field: string, message: string } | null}
 */
function getPasswordPolicyError(password) {
	if (typeof password !== "string") {
		return { field: "password", message: "invalid" };
	}
	if (password.length < MIN_LENGTH) {
		return { field: "password", message: "too short" };
	}
	if (Buffer.byteLength(password, "utf8") > MAX_BYTES) {
		return { field: "password", message: "too long" };
	}
	if (DENYLIST.has(password.toLowerCase())) {
		return { field: "password", message: "too common" };
	}
	return null;
}

function assertPasswordPolicy(password) {
	const err = getPasswordPolicyError(password);
	if (err) {
		throw new MoleculerClientError("Invalid password", 422, "", [err]);
	}
}

module.exports = {
	MIN_LENGTH,
	MAX_BYTES,
	DENYLIST,
	getPasswordPolicyError,
	assertPasswordPolicy,
};
