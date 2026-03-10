// CHANGED: removed createHash import — replaced by hash() one-liner (Node 20.12.0+)
import { hash } from "node:crypto";
import { brotliCompressSync, gzipSync } from "node:zlib";

/**
 * Compute SHA-256 hash of a buffer, returned as hex string.
 * Ported from v6 src/cli/util/hash.ts
 * CHANGED: was createHash("sha256") / hash.update() / hash.digest("hex") — now one-liner (Node 20.12.0+)
 * @param {Buffer} buffer
 * @returns {{ hash: string, size: number }}
 */
export function hashBuffer(buffer) {
	return { hash: hash("sha256", buffer, "hex"), size: buffer.length };
}

/**
 * Attempt brotli compression. Returns compressed buffer only if smaller than input.
 * Ported from v6 src/cli/compression/brotli.ts
 * @param {Buffer} buffer
 * @returns {Buffer | null}
 */
export function compressBrotli(buffer) {
	const result = brotliCompressSync(buffer);
	return result.length < buffer.length ? result : null;
}

/**
 * Attempt gzip compression. Returns compressed buffer only if smaller than input.
 * Ported from v6 src/cli/compression/gzip.ts
 * @param {Buffer} buffer
 * @returns {Buffer | null}
 */
export function compressGzip(buffer) {
	const result = gzipSync(buffer);
	return result.length < buffer.length ? result : null;
}
