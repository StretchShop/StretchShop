"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");

function request({ url, method, headers, body, tls }) {
	return new Promise((resolve, reject) => {
		let target;
		try {
			target = new URL(url);
		} catch (error) {
			reject(error);
			return;
		}
		const transport = target.protocol === "http:" ? http : https;
		const req = transport.request({
			protocol: target.protocol,
			hostname: target.hostname,
			port: target.port || undefined,
			path: target.pathname + target.search,
			method: method || "POST",
			headers: headers || {},
			cert: tls?.cert,
			key: tls?.key,
			passphrase: tls?.passphrase,
			ca: tls?.ca
		}, (res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => {
				resolve({
					status: res.statusCode,
					body: Buffer.concat(chunks).toString("utf8")
				});
			});
		});
		req.setTimeout(20000, () => {
			req.destroy(new Error("e-invoice request timed out"));
		});
		req.on("error", reject);
		if (body) {
			req.write(body);
		}
		req.end();
	});
}

module.exports = { request };
