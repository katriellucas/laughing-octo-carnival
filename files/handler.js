/// <reference types="@fastly/js-compute" />

import { KVStore } from "fastly:kv-store";
import { Server } from "SERVER";
import { manifest, prerendered, basePath } from "MANIFEST";
import { env } from "fastly:env";
import { inlinedAssets } from "INLINED_ASSETS";
import { kvStoreName, kvPrefix, collectionName } from "KV_ASSETS";
import { serveInlined, serveKV } from "./serve.js";
import { isPlainObj, getErrorMsg } from "./utils.js";

/**
 * @typedef {import('./serve.js').KVAsset} KVAssetEntry
 */

const server = new Server(manifest);

const kvIndexKey = `${kvPrefix}_index_${collectionName}`;
const assetPrefix = `${basePath}/`;
const appPath = `${basePath}/${manifest.appPath}`;
const immutablePrefix = `${appPath}/immutable/`;
const versionFile = `${appPath}/version.json`;

await server.init({
	env: { FASTLY_SERVICE_VERSION: env("FASTLY_SERVICE_VERSION") || "local" },
});

/**
 * Internal KV state container
 *
 * @type {{
 *   store: KVStore | null,
 *   promise: Promise<Record<string, KVAssetEntry>> | null
 * }}
 */
const kvState = {
	store: null,
	promise: null,
};

/**
 * Fetches and validates the KV asset index
 *
 * @returns {Promise<Record<string, KVAssetEntry>>}
 */
async function fetchAssetIndex() {
	try {
		kvState.store ??= new KVStore(kvStoreName);

		const data = await kvState.store.get(kvIndexKey).then((entry) => entry?.json());

		if (!isPlainObj(data)) {
			throw new Error(
				`KV index at "${kvIndexKey}" is missing or invalid in store "${kvStoreName}"`
			);
		}

		return data;
	} catch (err) {
		kvState.promise = null;
		throw err;
	}
}

/**
 * Determines if a route should be treated as a static asset
 *
 * @param {string} pathname
 * @param {string} filename
 * @returns {boolean}
 */
function isStaticRoute(pathname, filename) {
	if (prerendered.has(pathname)) return true;
	if (pathname === versionFile) return true;
	if (pathname.startsWith(immutablePrefix)) return true;
	if (filename && manifest.assets.has(filename)) return true;
	if (filename && manifest.assets.has(`${filename}/index.html`)) return true;
	return false;
}

/**
 * Generates potential file paths for a given request path
 *
 * @param {string} pathname
 * @param {string} cleanPath
 * @param {string | undefined} file
 * @returns {string[]}
 */
function getAssetCandidates(pathname, cleanPath, file) {
	const candidates = [pathname];

	if (file) candidates.push(file.startsWith("/") ? file : `/${file}`);

	candidates.push(`${pathname === "/" ? "" : cleanPath}/index.html`);

	return candidates;
}

/**
 * Main entry point for the Fastly Compute worker
 *
 * @param {FetchEvent} event
 */
export async function handler(event) {
	const { request, client } = event;
	const url = new URL(request.url);

	/** @type {string} */
	let pathname;
	try {
		pathname = decodeURIComponent(url.pathname);
	} catch {
		pathname = url.pathname;
	}

	const isTrailing = pathname.length > 1 && pathname.endsWith("/");
	const cleanPath = isTrailing ? pathname.slice(0, -1) : pathname;
	const filename = cleanPath.startsWith(assetPrefix) ? cleanPath.slice(assetPrefix.length) : "";

	if (isStaticRoute(pathname, filename)) {
		const candidates = getAssetCandidates(pathname, cleanPath, prerendered.get(pathname)?.file);

		// Try Inlined
		for (const key of candidates) {
			const inlined = inlinedAssets.get(key);
			if (inlined) return serveInlined(inlined, pathname, immutablePrefix, request);
		}

		// Try KV Store
		try {
			const index = await (kvState.promise ??= fetchAssetIndex());
			for (const key of candidates) {
				const kv = index[key];
				if (kv) return serveKV(kv, pathname, immutablePrefix, request, kvStoreName, kvPrefix);
			}
		} catch (err) {
			console.error(`Asset lookup error: ${getErrorMsg(err)}`);
		}
	}

	const redirectPath = isTrailing ? cleanPath : `${pathname}/`;
	if (prerendered.has(redirectPath)) {
		return new Response(null, {
			status: 308,
			headers: { location: `${redirectPath}${url.search}` },
		});
	}

	return server.respond(request, {
		platform: {
			env,
			geo: client.geo,
			kv: (name) => new KVStore(name),
			waitUntil: event.waitUntil.bind(event),
		},
		getClientAddress: () => client.address,
	});
}
