"use strict";

const path = require("path");
const { MoleculerClientError } = require("moleculer").Errors;

const SAFE_SEGMENT = /^[\w.\-]+$/;

/**
 * Allow only a single filesystem path segment (no traversal, separators, or "..").
 * @param {string} value
 * @returns {string}
 */
function sanitizePathSegment(value) {
	const s = String(value ?? "");
	if (!s || s.includes("/") || s.includes("\\") || s.includes("\0") || s.includes("..") || !SAFE_SEGMENT.test(s)) {
		throw new MoleculerClientError("Invalid path", 400);
	}
	return s;
}

/**
 * After path.resolve, require the file to stay under rootDir.
 * @param {string} rootDir
 * @param {string} resolvedPath
 * @returns {string} absolute path
 */
function assertResolvedUnderRoot(rootDir, resolvedPath) {
	const root = path.resolve(rootDir);
	const filePath = path.resolve(resolvedPath);
	const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
	if (filePath !== root && !filePath.startsWith(rootWithSep)) {
		throw new MoleculerClientError("Invalid file path", 400);
	}
	return filePath;
}

/**
 * Resolve a file under rootDir; reject path traversal and unsafe basenames.
 * @param {string} rootDir
 * @param {string} fileName
 * @returns {string} absolute safe path
 */
function resolveSafePath(rootDir, fileName) {
	const base = sanitizePathSegment(path.basename(String(fileName || "")));
	return assertResolvedUnderRoot(rootDir, path.resolve(rootDir, base));
}

/**
 * Sanitize an upload original filename to a safe basename + allowlisted extension.
 * @param {string} originalFilename
 * @param {string[]} allowedExts e.g. ["jpg","jpeg","png","webp","gif"]
 * @returns {{ base: string, ext: string }}
 */
function sanitizeUploadFilename(originalFilename, allowedExts = ["jpg", "jpeg", "png", "webp", "gif", "pdf", "zip"]) {
	const base = path.basename(String(originalFilename || "")).replace(/[^\w.\-]/g, "_");
	const re = /(?:\.([^.]+))?$/;
	const match = re.exec(base);
	const ext = (match && match[1] ? match[1] : "").toLowerCase();
	if (!ext || !allowedExts.includes(ext)) {
		throw new MoleculerClientError("Invalid file type", 400);
	}
	const nameWithoutExt = base.slice(0, base.length - ext.length - 1) || "file";
	const safeName = nameWithoutExt.replace(/[^\w\-]/g, "_").slice(0, 80) || "file";
	return { base: `${safeName}.${ext}`, ext };
}

module.exports = {
	resolveSafePath,
	sanitizePathSegment,
	assertResolvedUnderRoot,
	sanitizeUploadFilename,
};
