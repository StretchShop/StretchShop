"use strict";

const { spawnSync } = require("child_process");

/**
 * Jest stand-in for the ESM-only `bysquare/pay` package.
 * Encoding still runs in plain Node, which can load that package.
 */
function callPay(fn, args) {
	const script = `
		const pay = require("bysquare/pay");
		const args = JSON.parse(process.env.BYSQUARE_INPUT);
		const result = pay[process.env.BYSQUARE_FN](...args);
		process.stdout.write(JSON.stringify(result));
	`;
	const result = spawnSync(process.execPath, ["-e", script], {
		encoding: "utf8",
		env: {
			...process.env,
			BYSQUARE_FN: fn,
			BYSQUARE_INPUT: JSON.stringify(args),
		},
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || "bysquare/pay " + fn + " failed");
	}
	return JSON.parse(result.stdout);
}

module.exports = {
	encode: (model, options) => callPay("encode", options ? [model, options] : [model]),
	decode: (value) => callPay("decode", [value]),
	PaymentOptions: { PaymentOrder: 1 },
	CurrencyCode: new Proxy({}, { get: (_target, key) => String(key) }),
};
