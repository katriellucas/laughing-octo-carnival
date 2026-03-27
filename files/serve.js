/// <reference types="@fastly/js-compute" />

import { KVStore } from "fastly:kv-store";
import { getErrorMsg } from "./utils.js";

/** @type {readonly string[]} */
const HEADERS_304 = ["content-location", "etag", "vary", "cache-control", "expires"];

/**
 * @typedef {{
 *   bytes: Uint8Array,
 *   br?: Uint8Array,
 *   gzip?: Uint8Array,
 *   contentType: string,
 *   hash: string,
 *   lastModifiedTime: number
 * }} InlinedAsset
 */

/**
 * @typedef {{
 *   key: string,
 *   contentType: string,
 *   size: number,
 *   lastModifiedTime: number,
 *   variants: string[]
 * }} KVAsset
 */

/**
 * Filters headers for 304 Not Modified responses
 *
 * @param {Headers} headers
 * @param {readonly string[]} keys
 * @returns {Headers}
 */
function filterHeaders(headers, keys) {
	const result = new Headers();
	for (const key of keys) {
		const value = headers.get(key);
		if (value) result.set(key, value);
	}
	return result;
}

/**
 * Parses Accept-Encoding and returns the best supported encoding
 *
 * @param {string | null} value
 * @param {string[]} supported
 * @returns {string | null}
 */
function getEncoding(value, supported) {
	if (!value || supported.length === 0) return null;

	/** @type {Map<number, string[]>} */
	const priorityMap = new Map();

	for (const part of value.split(",")) {
		const [encoding, qualityPart] = part.trim().split(";");
		const normalized = encoding.trim();

		if (!supported.includes(normalized)) continue;

		let quality = 1000;
		const qValue = qualityPart?.trim();
		if (qValue?.startsWith("q=")) {
			const parsed = parseFloat(qValue.slice(2));
			quality = Number.isNaN(parsed) ? 1000 : Math.floor(Math.min(Math.max(parsed, 0), 1) * 1000);
		}

		if (!priorityMap.has(quality)) priorityMap.set(quality, []);
		priorityMap.get(quality)?.push(normalized);
	}

	const sorted = [...priorityMap.keys()].sort((a, b) => b - a);
	for (const quality of sorted) {
		const encodings = priorityMap.get(quality);
		if (encodings && encodings.length > 0) return encodings[0];
	}

	return null;
}

/**
 * Validates ETag match
 *
 * @param {string | null} etag
 * @param {string | null} ifNoneMatch
 * @returns {boolean}
 */
function etagMatches(etag, ifNoneMatch) {
	if (!etag || !ifNoneMatch) return false;
	const clean = etag.replace(/^W\//, "");
	return ifNoneMatch
		.split(",")
		.map((val) => val.trim().replace(/^W\//, ""))
		.some((val) => val === "*" || val === clean);
}

/**
 * Validates Last-Modified date match
 *
 * @param {number} lastModifiedTime
 * @param {string | null} ifModifiedSince
 * @returns {boolean}
 */
function dateMatches(lastModifiedTime, ifModifiedSince) {
	if (!ifModifiedSince || lastModifiedTime === 0) return false;
	const modifiedSince = Date.parse(ifModifiedSince);
	return !Number.isNaN(modifiedSince) && lastModifiedTime <= Math.floor(modifiedSince / 1000);
}

/**
 * Determines if an asset is not modified based on request headers
 *
 * @param {Request} request
 * @param {string | null} etag
 * @param {number} lastModifiedTime
 * @returns {boolean}
 */
function isNotModified(request, etag, lastModifiedTime) {
	if (etagMatches(etag, request.headers.get("if-none-match"))) return true;
	if (dateMatches(lastModifiedTime, request.headers.get("if-modified-since"))) return true;
	return false;
}

/**
 * Extracts JSON metadata from a KV entry
 *
 * @param {import("fastly:kv-store").KVStoreEntry} entry
 * @returns {Record<string, any> | null}
 */
function getMetadata(entry) {
	const text = entry.metadataText();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Creates a stream that merges multiple KV chunks into a single response body
 *
 * @param {KVStore} store
 * @param {string} baseKey
 * @param {number} numChunks
 * @param {import("fastly:kv-store").KVStoreEntry} first
 * @returns {ReadableStream}
 */
function mergeChunks(store, baseKey, numChunks, first) {
	let index = 0;
	/** @type {import("fastly:kv-store").KVStoreEntry | null} */
	let current = first;

	return new ReadableStream({
		async pull(controller) {
			if (current === null) {
				controller.error(new Error(`Missing chunk ${index} for ${baseKey}`));
				return;
			}
			const reader = current.body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				controller.enqueue(value);
			}
			index++;
			if (index >= numChunks) {
				controller.close();
				return;
			}
			current = await store.get(`${baseKey}_${index}`);
		},
	});
}

/**
 * Serves an asset inlined into the WebAssembly binary
 *
 * @param {InlinedAsset} asset
 * @param {string} pathname
 * @param {string} immutablePrefix
 * @param {Request} request
 * @returns {Response}
 */
export function serveInlined(asset, pathname, immutablePrefix, request) {
	const etag = `W/"${asset.hash}"`;
	const headers = new Headers({ "content-type": asset.contentType, etag });

	if (asset.lastModifiedTime !== 0) {
		headers.set("last-modified", new Date(asset.lastModifiedTime * 1000).toUTCString());
	}
	if (pathname.startsWith(immutablePrefix)) {
		headers.set("cache-control", "public, max-age=31536000, immutable");
	}
	if (asset.br || asset.gzip) headers.set("vary", "accept-encoding");

	if (isNotModified(request, etag, asset.lastModifiedTime)) {
		return new Response(null, { status: 304, headers: filterHeaders(headers, HEADERS_304) });
	}

	const supported = [];
	if (asset.br) supported.push("br");
	if (asset.gzip) supported.push("gzip");

	const encoding = getEncoding(request.headers.get("accept-encoding"), supported);
	let body = asset.bytes;

	if (encoding === "br" && asset.br) {
		body = asset.br;
		headers.set("content-encoding", "br");
	} else if (encoding === "gzip" && asset.gzip) {
		body = asset.gzip;
		headers.set("content-encoding", "gzip");
	}

	headers.set("content-length", `${body.length}`);
	return new Response(body, { status: 200, headers });
}

/**
 * Serves an asset stored in the Fastly KV Store
 *
 * @param {KVAsset} asset
 * @param {string} pathname
 * @param {string} immutablePrefix
 * @param {Request} request
 * @param {string} kvStoreName
 * @param {string} kvPrefix
 * @returns {Promise<Response>}
 */
export async function serveKV(asset, pathname, immutablePrefix, request, kvStoreName, kvPrefix) {
	const hash = asset.key.startsWith("sha256:") ? asset.key.slice(7) : asset.key;
	const baseKey = `${kvPrefix}_files_sha256:${hash}`;
	const etag = `W/"${hash}"`;

	const headers = new Headers({ "content-type": asset.contentType, etag });

	if (asset.lastModifiedTime !== 0) {
		headers.set("last-modified", new Date(asset.lastModifiedTime * 1000).toUTCString());
	}
	if (pathname.startsWith(immutablePrefix)) {
		headers.set("cache-control", "public, max-age=31536000, immutable");
	}
	if (asset.variants.length > 0) headers.set("vary", "accept-encoding");

	if (isNotModified(request, etag, asset.lastModifiedTime)) {
		return new Response(null, { status: 304, headers: filterHeaders(headers, HEADERS_304) });
	}

	const encoding = getEncoding(request.headers.get("accept-encoding"), asset.variants);
	const variantKey = encoding ? `${baseKey}_${encoding}` : baseKey;
	if (encoding) headers.set("content-encoding", encoding);

	const store = new KVStore(kvStoreName);
	/** @type {import("fastly:kv-store").KVStoreEntry | null} */
	let entry = null;

	try {
		entry = await store.get(variantKey);
	} catch (err) {
		console.warn(`Failed to fetch variant ${variantKey}: ${getErrorMsg(err)}`);
	}

	if (entry === null && variantKey !== baseKey) {
		try {
			entry = await store.get(baseKey);
			headers.delete("content-encoding");
		} catch (err) {
			console.error(`Failed to fetch fallback asset ${baseKey}: ${getErrorMsg(err)}`);
		}
	}

	if (entry === null) return new Response("Asset not found", { status: 404 });

	const metadata = getMetadata(entry);
	const numChunks = metadata?.numChunks ?? 1;

	const body = numChunks <= 1 ? entry.body : mergeChunks(store, variantKey, numChunks, entry);

	return new Response(body, { status: 200, headers });
}
