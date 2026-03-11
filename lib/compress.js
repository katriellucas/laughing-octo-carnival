import { hash } from "node:crypto";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

/**
 * Compute SHA-256 hash of a buffer, returned as hex string.
 * @param {Buffer} buffer
 * @returns {string}
 */
export function hashBuffer(buffer) {
	return hash("sha256", buffer, "hex");
}

/**
 * Attempt brotli compression. Returns compressed buffer only if smaller than input.
 * @param {Buffer} buffer
 * @returns {Buffer | null}
 */
export function compressBrotli(buffer) {
	const result = brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
	return result.length < buffer.length ? result : null;
}

/**
 * Attempt gzip compression. Returns compressed buffer only if smaller than input.
 * @param {Buffer} buffer
 * @returns {Buffer | null}
 */
export function compressGzip(buffer) {
	const result = gzipSync(buffer);
	return result.length < buffer.length ? result : null;
}
