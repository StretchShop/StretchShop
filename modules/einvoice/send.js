"use strict";

const fs = require("fs");
const path = require("path");
const { URLSearchParams } = require("url");
const { request: defaultRequest } = require("./http");

const tokenCache = new Map();

function clearAuthCache() {
	tokenCache.clear();
}

function headerValue(value) {
	return String(value ?? "").replace(/[\r\n]/g, "");
}

function log(logger, level, ...args) {
	if (logger && typeof logger[level] === "function") {
		logger[level](...args);
	}
}

function readTls(env) {
	const certPath = String(env.E_INVOICE_CLIENT_CERT || "").trim();
	const keyPath = String(env.E_INVOICE_CLIENT_KEY || "").trim();
	if (!certPath && !keyPath) {
		return null;
	}
	if (!certPath || !keyPath) {
		throw new Error("e-invoice mTLS needs both E_INVOICE_CLIENT_CERT and E_INVOICE_CLIENT_KEY");
	}
	const tls = {
		cert: fs.readFileSync(path.resolve(certPath)),
		key: fs.readFileSync(path.resolve(keyPath))
	};
	const passphrase = String(env.E_INVOICE_CLIENT_KEY_PASSPHRASE || "");
	if (passphrase) {
		tls.passphrase = passphrase;
	}
	const caPath = String(env.E_INVOICE_CLIENT_CA || "").trim();
	if (caPath) {
		tls.ca = fs.readFileSync(path.resolve(caPath));
	}
	return tls;
}

async function fetchAccessToken(env, request, tls) {
	const cacheKey = [
		env.E_INVOICE_OAUTH_TOKEN_URL,
		env.E_INVOICE_CLIENT_ID,
		env.E_INVOICE_OAUTH_SCOPE || ""
	].join("\n");
	const cached = tokenCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now() + 5000) {
		return cached.token;
	}
	const params = new URLSearchParams();
	params.set("grant_type", "client_credentials");
	const headers = {
		"Content-Type": "application/x-www-form-urlencoded",
		Accept: "application/json"
	};
	if (String(env.E_INVOICE_OAUTH_CLIENT_AUTH || "").toLowerCase() === "basic") {
		const raw = env.E_INVOICE_CLIENT_ID + ":" + env.E_INVOICE_CLIENT_SECRET;
		headers.Authorization = "Basic " + Buffer.from(raw).toString("base64");
	} else {
		params.set("client_id", env.E_INVOICE_CLIENT_ID);
		params.set("client_secret", env.E_INVOICE_CLIENT_SECRET);
	}
	if (env.E_INVOICE_OAUTH_SCOPE) {
		params.set("scope", env.E_INVOICE_OAUTH_SCOPE);
	}
	const response = await request({
		url: env.E_INVOICE_OAUTH_TOKEN_URL,
		method: "POST",
		headers,
		body: params.toString(),
		tls
	});
	if (response.status < 200 || response.status >= 300) {
		throw new Error("e-invoice OAuth token request failed: HTTP " + response.status);
	}
	let parsed;
	try {
		parsed = JSON.parse(response.body || "{}");
	} catch {
		throw new Error("e-invoice OAuth token response was not JSON");
	}
	if (!parsed.access_token) {
		throw new Error("e-invoice OAuth token response has no access_token");
	}
	const expiresIn = Number(parsed.expires_in) || 300;
	tokenCache.set(cacheKey, {
		token: parsed.access_token,
		expiresAt: Date.now() + (expiresIn * 1000)
	});
	return parsed.access_token;
}

/**
 * Auth used by e-invoice HTTP APIs, in priority order:
 * 1. OAuth 2.0 client credentials (access token, then Bearer)
 * 2. Static bearer token
 * 3. API key header
 * 4. HTTP Basic user/password
 * mTLS client certificates are applied on the connection when set,
 * including the token request. That is how Peppol access points authenticate.
 */
async function authHeaders(env, request, tls) {
	const headers = {};
	if (env.E_INVOICE_OAUTH_TOKEN_URL && env.E_INVOICE_CLIENT_ID && env.E_INVOICE_CLIENT_SECRET) {
		const token = await fetchAccessToken(env, request, tls);
		headers.Authorization = "Bearer " + headerValue(token);
		return headers;
	}
	if (env.E_INVOICE_TOKEN) {
		headers.Authorization = "Bearer " + headerValue(env.E_INVOICE_TOKEN);
		return headers;
	}
	if (env.E_INVOICE_API_KEY) {
		const name = String(env.E_INVOICE_API_KEY_HEADER || "X-API-Key").trim();
		if (!/^[A-Za-z0-9-]+$/.test(name)) {
			throw new Error("E_INVOICE_API_KEY_HEADER is not a valid header name");
		}
		headers[name] = headerValue(env.E_INVOICE_API_KEY);
		return headers;
	}
	if (env.E_INVOICE_USER && env.E_INVOICE_PASSWORD) {
		const raw = headerValue(env.E_INVOICE_USER) + ":" + headerValue(env.E_INVOICE_PASSWORD);
		headers.Authorization = "Basic " + Buffer.from(raw).toString("base64");
	}
	return headers;
}

async function sendXml(options) {
	const env = options.env || process.env;
	const url = String(env.E_INVOICE_URL || "").trim();
	const logger = options.logger;
	if (!url) {
		log(logger, "info", "einvoice.send() - skipped, E_INVOICE_URL is not set");
		return { sent: false, status: null, error: null };
	}
	const request = options.request || defaultRequest;
	const tls = readTls(env);
	const headers = await authHeaders(env, request, tls);
	const body = options.xml || "";
	headers["Content-Type"] = "application/xml; charset=utf-8";
	headers.Accept = "application/xml, application/json, text/plain";
	headers["Content-Length"] = Buffer.byteLength(body);
	const method = String(env.E_INVOICE_METHOD || "POST").toUpperCase();
	log(logger, "info", "einvoice.send() - POST", url);
	const response = await request({
		url,
		method,
		headers,
		body,
		tls
	});
	const sent = response.status >= 200 && response.status < 300;
	if (!sent) {
		log(logger, "error", "einvoice.send() - endpoint rejected the invoice", {
			status: response.status
		});
	} else {
		log(logger, "info", "einvoice.send() - accepted", { status: response.status });
	}
	return {
		sent,
		status: response.status,
		error: sent ? null : "HTTP " + response.status
	};
}

module.exports = {
	sendXml,
	authHeaders,
	clearAuthCache,
	readTls
};
