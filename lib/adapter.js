import { join, resolve, relative } from "node:path";
import { writeFileSync, existsSync } from "node:fs";
import { build } from "esbuild";
import { validateFastlyConfig } from "./validate.js";
import { processAssets, logAssets } from "./assets.js";
import { writeManifest } from "./manifest.js";
import { compileToWasm } from "./compiler.js";
import { FastlyKVClient } from "./kv-client.js";
import { getErrorMsg, toPosixPath } from "./utils.js";

const FILES_DIR = join(import.meta.dirname, "../files");

/**
 * Determines if the requirements for remote synchronization are met
 *
 * @param {string | undefined} storeName
 * @param {string | undefined} token
 * @param {number} kvAssetCount
 * @param {import('@sveltejs/kit').Builder} builder
 * @returns {storeName is string}
 */
function canSyncRemote(storeName, token, kvAssetCount, builder) {
	if (!storeName || kvAssetCount === 0) return false;

	if (!token) {
		builder.log.warn(`FASTLY_API_TOKEN not set, skipping KV upload`);
		return false;
	}

	return true;
}

/**
 * Synchronizes build assets with the remote Fastly KV Store
 *
 * @param {import('./assets.js').KVAssetInfo[]} assets
 * @param {import('./assets.js').KVAssetIndex} kvIndex
 * @param {string} binDir
 * @param {string} storeName
 * @param {string} kvPrefix
 * @param {string} collectionName
 * @param {number} chunkSize
 * @param {import('@sveltejs/kit').Builder} builder
 */
async function syncRemoteKV(assets, kvIndex, binDir, storeName, kvPrefix, collectionName, chunkSize, builder) {
	const token = process.env.FASTLY_API_TOKEN;
	if (!token) return;

	const contentDir = join(binDir, "kv-stores", storeName);
	const client = new FastlyKVClient(token, storeName, chunkSize);

	try {
		await client.syncAssets(assets, kvIndex, contentDir, kvPrefix, collectionName, builder);
	} catch (err) {
		builder.log.error(`KV synchronization failed: ${getErrorMsg(err)}`);
		throw err;
	}

	writeFileSync(
		join(binDir, "publish.config.json"),
		`${JSON.stringify({ storeName, kvPrefix, collectionName }, null, 2)}\n`
	);
}

/**
 * Main adapt function called by SvelteKit during the build process
 *
 * @param {import('@sveltejs/kit').Builder} builder
 * @param {import('../index.d.ts').AdapterOptions} options
 */
export async function adapt(builder, options = {}) {
	const envPath = resolve(".env");
	if (existsSync(envPath)) process.loadEnvFile?.(envPath);

	const {
		wasmAssetLimit = 10 * 1024,
		kvStoreName,
		kvPrefix = "default",
		collectionName = "live",
		kvChunkSize = 1024 * 1024 * 20,
	} = options.publish ?? {};

	const token = process.env.FASTLY_API_TOKEN;

	let effectiveLimit = wasmAssetLimit;
	if (!kvStoreName) {
		effectiveLimit = Infinity;
	} else if (!token) {
		builder.log.warn(`FASTLY_API_TOKEN not set, inlining all assets into WebAssembly binary`);
		effectiveLimit = Infinity;
	}

	const binDir = resolve("bin");
	const tempDir = builder.getBuildDirectory("fastly-temp");

	validateFastlyConfig();

	builder.rimraf(tempDir);
	builder.mkdirp(tempDir);
	builder.mkdirp(binDir);

	builder.log.minor("Copying assets...");

	const publishDir = join(tempDir, "publish");

	builder.writeClient(publishDir);
	builder.writePrerendered(publishDir);
	builder.writeServer(tempDir);

	const assets = await processAssets(builder, {
		temp: tempDir,
		publishDir,
		binDir,
		wasmAssetLimit: effectiveLimit,
		kvStoreName: kvStoreName ?? "assets",
		kvPrefix,
		collectionName,
	});

	logAssets(assets.inlined, assets.kv, builder);

	const canSync = canSyncRemote(kvStoreName, token, assets.kv.length, builder);

	if (canSync) {
		await syncRemoteKV(
			assets.kv,
			assets.kvIndex,
			binDir,
			kvStoreName,
			kvPrefix,
			collectionName,
			kvChunkSize,
			builder
		);
	}

	writeManifest(tempDir, builder);

	const serverRelative = toPosixPath(relative(tempDir, builder.getServerDirectory()));
	const serverPath = `./${serverRelative}/index.js`;

	builder.copy(FILES_DIR, tempDir, {
		replace: {
			SERVER: serverPath,
			MANIFEST: "./manifest.js",
			INLINED_ASSETS: "./inlined-assets.js",
			KV_ASSETS: "./kv-assets.js",
		},
	});

	builder.log.minor("Bundling JavaScript...");

	const bundledJs = join(tempDir, "entry.js");

	await build({
		bundle: true,
		minify: true,
		format: "esm",
		target: "es2022",
		platform: "browser",
		conditions: ["fastly"],
		entryPoints: [bundledJs],
		outfile: join(tempDir, "bundle.js"),
		external: ["fastly:*"],
	});

	builder.log.minor("Compiling to WebAssembly...");

	try {
		compileToWasm(join(tempDir, "bundle.js"), join(binDir, "main.wasm"), tempDir);
		builder.log.minor("Wasm build complete.");
	} catch (err) {
		builder.log.error(`WebAssembly build failed: ${getErrorMsg(err)}`);
		throw err;
	}
}