"use strict";

const zlib = require("zlib");

/**
 * Minimal ZIP helpers (store + deflate) for WooCommerce multi-file bundles.
 * Not a full ZIP implementation — enough for our import/export fixtures.
 */

/**
 * Create an uncompressed (store) ZIP buffer from name→Buffer map.
 * @param {Record<string, Buffer|string>} files
 * @returns {Buffer}
 */
function createZip(files) {
	const localParts = [];
	const centralParts = [];
	let offset = 0;

	Object.keys(files || {}).forEach((name) => {
		const data = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(String(files[name]), "utf8");
		const nameBuf = Buffer.from(name, "utf8");
		const crc = crc32(data);
		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034b50, 0);
		localHeader.writeUInt16LE(20, 4); // version needed
		localHeader.writeUInt16LE(0, 6); // flags
		localHeader.writeUInt16LE(0, 8); // method store
		localHeader.writeUInt16LE(0, 10); // time
		localHeader.writeUInt16LE(0, 12); // date
		localHeader.writeUInt32LE(crc >>> 0, 14);
		localHeader.writeUInt32LE(data.length, 18);
		localHeader.writeUInt32LE(data.length, 22);
		localHeader.writeUInt16LE(nameBuf.length, 26);
		localHeader.writeUInt16LE(0, 28);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt16LE(0, 12);
		central.writeUInt16LE(0, 14);
		central.writeUInt32LE(crc >>> 0, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(offset, 42);

		localParts.push(localHeader, nameBuf, data);
		centralParts.push(central, nameBuf);
		offset += localHeader.length + nameBuf.length + data.length;
	});

	const centralDir = Buffer.concat(centralParts);
	const end = Buffer.alloc(22);
	const fileCount = Object.keys(files || {}).length;
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(fileCount, 8);
	end.writeUInt16LE(fileCount, 10);
	end.writeUInt32LE(centralDir.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20);

	return Buffer.concat([...localParts, centralDir, end]);
}

/**
 * Extract files from a ZIP buffer (store or deflate).
 * @param {Buffer} buffer
 * @returns {Record<string, Buffer>}
 */
function extractZip(buffer) {
	const out = {};
	let i = 0;
	const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

	while (i + 4 <= buf.length) {
		const sig = buf.readUInt32LE(i);
		if (sig !== 0x04034b50) {
			break;
		}
		const method = buf.readUInt16LE(i + 8);
		const compSize = buf.readUInt32LE(i + 18);
		const nameLen = buf.readUInt16LE(i + 26);
		const extraLen = buf.readUInt16LE(i + 28);
		const name = buf.slice(i + 30, i + 30 + nameLen).toString("utf8");
		const dataStart = i + 30 + nameLen + extraLen;
		const compressed = buf.slice(dataStart, dataStart + compSize);
		let data;
		if (method === 0) {
			data = compressed;
		} else if (method === 8) {
			data = zlib.inflateRawSync(compressed);
		} else {
			throw new Error("Unsupported ZIP compression method: " + method);
		}
		out[name] = data;
		i = dataStart + compSize;
	}
	return out;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

module.exports = {
	createZip,
	extractZip
};
