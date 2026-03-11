// @ts-ignore — encoding-negotiator ships no types
import { negotiateEncoding } from "encoding-negotiator";

// https://httpwg.org/specs/rfc9110.html#rfc.section.15.4.5
// The server generating a 304 response MUST generate any of the following
// header fields that would have been sent in a 200 response:
const HEADERS_TO_PRESERVE_FOR_304 = [
	"Content-Location",
	"ETag",
	"Vary",
	"Cache-Control",
	"Expires",
];

/**
 * @param {Record<string, string>} headers
 * @param {readonly string[]} keys
 * @returns {Record<string, string>}
 */
function headersSubset(headers, keys) {
	/** @type {Record<string, string>} */
	const result = {};
	for (const key of keys) {
		if (key in headers) result[key] = headers[key];
	}
	return result;
}

/**
 * @typedef {{
 *   bytes: Uint8Array<ArrayBuffer>,
 *   br?: Uint8Array<ArrayBuffer>,
 *   gzip?: Uint8Array<ArrayBuffer>,
 *   contentType: string,
 *   hash: string,
 *   lastModifiedTime: number
 * }} InlinedAsset
 */

/**
 * Serve an asset, handling compression negotiation, ETags, and caching.
 *
 * @param {InlinedAsset} asset
 * @param {string} pathname
 * @param {string} immutablePrefix
 * @param {Request} req
 * @returns {Response}
 */
export function serveAsset(asset, pathname, immutablePrefix, req) {
	// Weak ETag — semantic identity, not byte identity (safe across encodings per RFC 9110)
	const etag = `W/"${asset.hash}"`;

	/** @type {Record<string, string>} */
	const headers = {
		"Content-Type": asset.contentType,
		ETag: etag,
	};

	// Last-Modified header from mtime stored at build time
	if (asset.lastModifiedTime !== 0) {
		headers["Last-Modified"] = new Date(asset.lastModifiedTime * 1000).toUTCString();
	}

	// Immutable cache control for hashed assets
	if (pathname.startsWith(immutablePrefix)) {
		headers["Cache-Control"] = "public, max-age=31536000, immutable";
	}

	// Vary header when compressed variants exist
	if (asset.br != null || asset.gzip != null) {
		headers["Vary"] = "Accept-Encoding";
	}

	// If-None-Match handles comma-separated list, wildcard "*", and weak comparison per RFC 9110 §13.2.2
	const ifNoneMatch = (req.headers.get("If-None-Match") ?? "")
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean);

	if (ifNoneMatch.length > 0) {
		// Weak comparison — strip W/ prefix from both sides
		const cleanEtag = etag.replace(/^W\//, "");
		const matched =
			ifNoneMatch.includes("*") || ifNoneMatch.some((e) => e.replace(/^W\//, "") === cleanEtag);
		if (matched)
			return new Response(null, {
				status: 304,
				headers: headersSubset(headers, HEADERS_TO_PRESERVE_FOR_304),
			});
	} else if (asset.lastModifiedTime !== 0) {
		// If-Modified-Since handling
		const ifModifiedSince = req.headers.get("If-Modified-Since");
		if (ifModifiedSince != null) {
			const sinceMs = Date.parse(ifModifiedSince);
			if (!Number.isNaN(sinceMs) && asset.lastModifiedTime <= Math.floor(sinceMs / 1000)) {
				return new Response(null, {
					status: 304,
					headers: headersSubset(headers, HEADERS_TO_PRESERVE_FOR_304),
				});
			}
		}
	}

	// Encoding negotiation — only advertise encodings the asset actually has
	const acceptHeader = req.headers.get("Accept-Encoding") ?? "";
	const supported = ["br", "gzip"].filter((e) =>
		e === "br" ? asset.br != null : asset.gzip != null
	);
	const encoding = supported.length > 0 ? negotiateEncoding(acceptHeader, supported) : null;

	/** @type {Uint8Array<ArrayBuffer>} */
	let bytes = asset.bytes;

	if (encoding) {
		/** @type {Uint8Array<ArrayBuffer> | undefined} */
		const compressed = encoding === "br" ? asset.br : encoding === "gzip" ? asset.gzip : undefined;

		if (compressed != null) {
			headers["Content-Encoding"] = encoding;
			bytes = compressed;
		}
	}

	return new Response(bytes, { status: 200, headers });
}
