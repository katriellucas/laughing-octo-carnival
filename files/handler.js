/// <reference types="@fastly/js-compute" />

import { Server } from "SERVER";
import { manifest, prerendered, basePath } from "MANIFEST";
import { env } from "fastly:env";
import { inlinedAssets } from "INLINED_ASSETS";
// CHANGED: all asset serving logic moved to serve.js — handler only does routing
import { serveAsset } from "./serve.js";

/* Setup */

const server = new Server(manifest);

await server.init({
	env: { FASTLY_SERVICE_VERSION: env("FASTLY_SERVICE_VERSION") || "local" },
});

const appPath = basePath ? `${basePath}/${manifest.appPath}` : `/${manifest.appPath}`;
const immutablePrefix = `${appPath}/immutable/`;
const versionFile = `${appPath}/version.json`;

/** @param {string} pathname */
function decodePathname(pathname) {
	try {
		return decodeURIComponent(pathname);
	} catch {
		console.warn(`WARN: Failed to decode URI: ${pathname}`);
		return pathname;
	}
}

/** @param {FetchEvent} event */
export async function handler(event) {
	const req = event.request;
	const url = new URL(req.url);
	const pathname = decodePathname(url.pathname);

	const strippedPathname =
		pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

	let filename = "";
	if (basePath === "" && strippedPathname.startsWith("/")) {
		filename = strippedPathname.slice(1);
	} else if (basePath && strippedPathname.startsWith(basePath + "/")) {
		filename = strippedPathname.slice(basePath.length + 1);
	}

	const altPathname = pathname.endsWith("/") ? strippedPathname : pathname + "/";

	const isStaticAsset = Boolean(
		filename && (manifest.assets.has(filename) || manifest.assets.has(filename + "/index.html"))
	);
	const isStaticRoute =
		isStaticAsset ||
		prerendered.has(pathname) ||
		pathname === versionFile ||
		pathname.startsWith(immutablePrefix);

	if (isStaticRoute) {
		const prerenderedFile = prerendered.get(pathname)?.file;
		const asset =
			inlinedAssets.get(pathname) ??
			(prerenderedFile ? inlinedAssets.get(prerenderedFile) : undefined) ??
			inlinedAssets.get(pathname + "/index.html");
		// CHANGED: was serveInlinedAsset() defined inline — now delegates to serveAsset() in serve.js
		if (asset) return serveAsset(asset, pathname, immutablePrefix, req);
	}

	if (altPathname && prerendered.has(altPathname)) {
		return new Response("", { status: 308, headers: { location: altPathname + url.search } });
	}

	/** @type {App.Platform} */
	const platform = {
		env,
		geo: event.client.geo,
		waitUntil: (promise) => event.waitUntil(promise),
	};

	return server.respond(req, {
		platform,
		getClientAddress: () => event.client.address,
	});
}
