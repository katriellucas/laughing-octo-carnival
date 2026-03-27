import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FastlyKVClient } from "../../lib/kv-client.js";

/**
 * Removes unreferenced assets from the Fastly KV Store.
 *
 * @param {string[]} args
 */
export async function action(args) {
	const dryRun = args.includes("--dry-run");
	const verbose = args.includes("--verbose");

	const token = process.env.FASTLY_API_TOKEN;
	if (!token) {
		console.error("FASTLY_API_TOKEN is not set.");
		process.exitCode = 1;
		return;
	}

	let config;
	try {
		config = JSON.parse(readFileSync(resolve("bin/publish.config.json"), "utf-8"));
	} catch {
		console.error("Could not read bin/publish.config.json.");
		process.exitCode = 1;
		return;
	}

	const { storeName, publishId } = config;

	console.log(
		`Cleaning KV store "${storeName}" (publish: ${publishId})${dryRun ? " [dry run]" : ""}...`
	);

	const client = new FastlyKVClient(token, storeName);
	const keysToDelete = new Set();

	const indexPrefix = `${publishId}_index_`;
	const indexKeys = await client.listKeys(indexPrefix);

	if (indexKeys.length === 0) {
		console.log("No index keys found, nothing to clean.");
		return;
	}

	const liveCollections = new Set();
	const assetsInUse = new Set();
	const storeId = await client.resolveStoreId();

	for (const indexKey of indexKeys) {
		const collectionName = indexKey.slice(indexPrefix.length);
		if (verbose) console.log(`  index: ${collectionName}`);

		const res = await client.api(
			`/resources/stores/kv/${storeId}/keys/${encodeURIComponent(indexKey)}`
		);

		if (res.status === 404) continue;

		let index;
		try {
			index = await res.json();
		} catch {
			console.warn(`  warn: could not parse index for "${collectionName}", skipping.`);
			continue;
		}

		liveCollections.add(collectionName);

		for (const entry of Object.values(index)) {
			if (entry.key?.startsWith("sha256:")) {
				assetsInUse.add(entry.key.slice("sha256:".length));
			}
		}
	}

	console.log(`  ${liveCollections.size} live collection(s): ${[...liveCollections].join(", ")}`);

	const settingsPrefix = `${publishId}_metadata_`;
	for (const key of await client.listKeys(settingsPrefix)) {
		const name = key.slice(settingsPrefix.length);
		if (!liveCollections.has(name)) {
			if (verbose) console.log(`  delete: ${key} (no live index)`);
			keysToDelete.add(key);
		}
	}

	const assetPrefix = `${publishId}_files_sha256:`;
	for (const key of await client.listKeys(assetPrefix)) {
		const hash = key.slice(assetPrefix.length, assetPrefix.length + 64);
		if (!assetsInUse.has(hash)) {
			if (verbose) console.log(`  delete: ${key} (unreferenced)`);
			keysToDelete.add(key);
		}
	}

	if (keysToDelete.size === 0) {
		console.log("Nothing to clean.");
		return;
	}

	if (dryRun) {
		console.log(`Would delete ${keysToDelete.size} key(s):`);
		for (const key of keysToDelete) console.log(`  ${key}`);
		return;
	}

	console.log(`Deleting ${keysToDelete.size} key(s)...`);
	await Promise.all([...keysToDelete].map((k) => client.deleteKey(k)));
	console.log("Done.");
}
