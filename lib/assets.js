import {
	writeFileSync,
	readFileSync,
	readdirSync,
	statSync,
	existsSync,
	mkdirSync,
	unlinkSync,
} from "node:fs";
import { hash } from "node:crypto";
import { posix, resolve, join } from "node:path";
import { lookup } from "mrmime";
import { toPosixPath, formatByteSize } from "./utils.js";

/**
 * Metadata for an asset inlined into the WebAssembly binary
 *
 * @typedef {{
 *   route: string,
 *   size: number,
 *   br: boolean,
 *   gzip: boolean
 * }} InlinedAssetInfo
 */

/**
 * Metadata for an asset that exceeds the size limit and must be stored in KV
 *
 * @typedef {{
 *   route: string,
 *   absolute: string,
 *   contentType: string,
 *   hash: string,
 *   size: number,
 *   lastModifiedTime: number,
 *   variants: string[]
 * }} KVAssetInfo
 */

/**
 * Represents a raw file discovered during the scan of the publish directory
 *
 * @typedef {{
 *   absolute: string,
 *   route: string,
 *   lastModifiedTime: number
 * }} AssetSourceFile
 */

/**
 * The structure of the asset index stored in KV
 *
 * @typedef {Record<string, {
 *   key: string,
 *   size: number,
 *   contentType: string,
 *   lastModifiedTime: number,
 *   variants: string[]
 * }>} KVAssetIndex
 */

/**
 * Generates a JavaScript statement to register an inlined asset
 *
 * @param {{
 *   route: string,
 *   localPath: string,
 *   size: number,
 *   hash: string,
 *   lastModifiedTime: number,
 *   br: boolean,
 *   gzip: boolean
 * }} file
 * @returns {string}
 */
function generateAssetBinding(file) {
	const route = JSON.stringify(file.route);
	const mimeType = JSON.stringify(lookup(file.route) ?? "application/octet-stream");
	const getAssetPath = (suffix = "") => JSON.stringify(`./${file.localPath}${suffix}`);

	const properties = [
		`bytes: includeBytes(${getAssetPath()})`,
		`contentType: ${mimeType}`,
		`size: ${file.size}`,
		`hash: ${JSON.stringify(file.hash)}`,
		`lastModifiedTime: ${file.lastModifiedTime}`,
	];

	if (file.br) properties.push(`br: includeBytes(${getAssetPath(".br")})`);
	if (file.gzip) properties.push(`gzip: includeBytes(${getAssetPath(".gz")})`);

	return `inlinedAssets.set(${route}, { ${properties.join(", ")} });`;
}

/**
 * Recursively scans the publish directory to discover all source files
 *
 * @param {string} publishDir
 * @returns {AssetSourceFile[]}
 */
function enumerateSourceFiles(publishDir) {
	const rootPath = toPosixPath(publishDir);
	const entries = readdirSync(publishDir, { recursive: true, withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const name = entry.name;
		if (name.endsWith(".br") || name.endsWith(".gz")) continue;

		const absolutePath = resolve(entry.parentPath, name);
		const relativePath = posix.relative(rootPath, toPosixPath(absolutePath));
		const stats = statSync(absolutePath);

		files.push({
			absolute: absolutePath,
			route: `/${relativePath}`,
			lastModifiedTime: Math.floor(stats.mtimeMs / 1000),
		});
	}

	return files;
}

/**
 * Categorizes source files into inlined or KV-bound assets
 *
 * @param {AssetSourceFile[]} files
 * @param {number} wasmAssetLimit
 * @returns {{ inlined: InlinedAssetInfo[], lines: string[], kv: KVAssetInfo[] }}
 */
function classifyAssetSources(files, wasmAssetLimit) {
	/** @type {InlinedAssetInfo[]} */
	const inlined = [];
	/** @type {string[]} */
	const lines = [];
	/** @type {KVAssetInfo[]} */
	const kv = [];

	for (const file of files) {
		const buffer = readFileSync(file.absolute);
		const fileHash = hash("sha256", buffer, "hex");
		const hasBr = existsSync(`${file.absolute}.br`);
		const hasGzip = existsSync(`${file.absolute}.gz`);

		if (buffer.length <= wasmAssetLimit) {
			lines.push(
				generateAssetBinding({
					route: file.route,
					localPath: `publish${file.route}`,
					size: buffer.length,
					hash: fileHash,
					lastModifiedTime: file.lastModifiedTime,
					br: hasBr,
					gzip: hasGzip,
				})
			);

			inlined.push({ route: file.route, size: buffer.length, br: hasBr, gzip: hasGzip });
		} else {
			const variants = [];
			if (hasBr) variants.push("br");
			if (hasGzip) variants.push("gzip");

			kv.push({
				route: file.route,
				absolute: file.absolute,
				contentType: lookup(file.route) ?? "application/octet-stream",
				hash: fileHash,
				size: buffer.length,
				lastModifiedTime: file.lastModifiedTime,
				variants,
			});
		}
	}

	return { inlined, lines, kv };
}

/**
 * Physically writes KV asset blobs and their compressed variants
 *
 * @param {string} blobDir
 * @param {KVAssetInfo[]} kvAssets
 * @returns {Set<string>}
 */
function writeKVBlobs(blobDir, kvAssets) {
	const activeBlobs = new Set();

	for (const asset of kvAssets) {
		const definitions = [{ suffix: "", source: asset.absolute }];

		if (asset.variants.includes("br"))
			definitions.push({ suffix: "_br", source: `${asset.absolute}.br` });
		if (asset.variants.includes("gzip"))
			definitions.push({ suffix: "_gzip", source: `${asset.absolute}.gz` });

		for (const def of definitions) {
			const name = `${asset.hash}${def.suffix}`;
			const path = join(blobDir, name);
			activeBlobs.add(name);

			if (!existsSync(path)) writeFileSync(path, readFileSync(def.source));
		}
	}

	return activeBlobs;
}

/**
 * Synchronizes the local simulation data for the dev server
 *
 * @param {string} binDir
 * @param {string} storeName
 * @param {string} kvPrefix
 * @param {string} collectionName
 * @param {KVAssetInfo[]} kvAssets
 * @param {KVAssetIndex} kvIndex
 */
function syncLocalSimulation(binDir, storeName, kvPrefix, collectionName, kvAssets, kvIndex) {
	const kvDir = join(binDir, "kv-stores");
	const blobDir = join(kvDir, storeName);
	mkdirSync(blobDir, { recursive: true });

	const currentBlobs = writeKVBlobs(blobDir, kvAssets);

	/** @type {Record<string, { file?: string, data?: string, metadata?: string }>} */
	const localMap = {};

	for (const asset of kvAssets) {
		const variantSpecs = [{ suffix: "", encoding: null }];
		if (asset.variants.includes("br")) variantSpecs.push({ suffix: "_br", encoding: "br" });
		if (asset.variants.includes("gzip")) variantSpecs.push({ suffix: "_gzip", encoding: "gzip" });

		for (const spec of variantSpecs) {
			const blobName = `${asset.hash}${spec.suffix}`;
			const key = `${kvPrefix}_files_sha256:${blobName}`;
			const blobPath = join(blobDir, blobName);
			const blobStats = statSync(blobPath);

			/** @type {{ hash: string, size: number, contentEncoding?: string }} */
			const metadata = { hash: asset.hash, size: blobStats.size };
			if (spec.encoding) metadata.contentEncoding = spec.encoding;

			localMap[key] = {
				file: `./bin/kv-stores/${storeName}/${blobName}`,
				metadata: JSON.stringify(metadata),
			};
		}
	}

	for (const file of readdirSync(blobDir)) {
		if (!currentBlobs.has(file)) unlinkSync(join(blobDir, file));
	}

	localMap[`${kvPrefix}_index_${collectionName}`] = {
		data: JSON.stringify(kvIndex),
		metadata: JSON.stringify({ publishedTime: Math.floor(Date.now() / 1000) }),
	};

	// Sentinel key used to identify live collections
	localMap[`${kvPrefix}_metadata_${collectionName}`] = { data: "{}" };

	writeFileSync(join(kvDir, `${storeName}.json`), `${JSON.stringify(localMap, null, 2)}\n`);
}

/**
 * Writes the virtual modules needed for the runtime request handler
 *
 * @param {string} tempDir
 * @param {string[]} inlinedLines
 * @param {string} kvStoreName
 * @param {string} kvPrefix
 * @param {string} collectionName
 */
function emitVirtualModules(tempDir, inlinedLines, kvStoreName, kvPrefix, collectionName) {
	writeFileSync(
		join(tempDir, "inlined-assets.js"),
		[
			`import { includeBytes } from "fastly:experimental";`,
			`export const inlinedAssets = new Map();`,
			...inlinedLines,
		].join("\n") + "\n"
	);

	writeFileSync(
		join(tempDir, "kv-assets.js"),
		[
			`export const kvStoreName = ${JSON.stringify(kvStoreName)};`,
			`export const kvPrefix = ${JSON.stringify(kvPrefix)};`,
			`export const collectionName = ${JSON.stringify(collectionName)};`,
		].join("\n") + "\n"
	);
}

/**
 * Orchestrates the full asset processing pipeline
 *
 * @param {import('@sveltejs/kit').Builder} builder
 * @param {{
 *   temp: string,
 *   publishDir: string,
 *   binDir: string,
 *   wasmAssetLimit: number,
 *   kvStoreName: string,
 *   kvPrefix: string,
 *   collectionName: string
 * }} options
 * @returns {Promise<{ inlined: InlinedAssetInfo[], kv: KVAssetInfo[], kvIndex: KVAssetIndex }>}
 */
export async function processAssets(builder, options) {
	const { temp, publishDir, binDir, wasmAssetLimit, kvStoreName, kvPrefix, collectionName } =
		options;

	if (!existsSync(publishDir)) {
		emitVirtualModules(temp, [], kvStoreName, kvPrefix, collectionName);
		return { inlined: [], kv: [], kvIndex: {} };
	}

	builder.log.minor("Compressing assets...");
	await builder.compress(publishDir);

	const sourceFiles = enumerateSourceFiles(publishDir);
	const { inlined, lines, kv } = classifyAssetSources(sourceFiles, wasmAssetLimit);

	/** @type {KVAssetIndex} */
	const kvIndex = {};
	for (const asset of kv) {
		kvIndex[asset.route] = {
			key: `sha256:${asset.hash}`,
			size: asset.size,
			contentType: asset.contentType,
			lastModifiedTime: asset.lastModifiedTime,
			variants: asset.variants,
		};
	}

	syncLocalSimulation(binDir, kvStoreName, kvPrefix, collectionName, kv, kvIndex);
	emitVirtualModules(temp, lines, kvStoreName, kvPrefix, collectionName);

	return { inlined, kv, kvIndex };
}

/**
 * Logs a summary of processed assets to the console
 *
 * @param {InlinedAssetInfo[]} inlined
 * @param {KVAssetInfo[]} kv
 * @param {import('@sveltejs/kit').Builder} builder
 */
export function logAssets(inlined, kv, builder) {
	if (inlined.length === 0 && kv.length === 0) return;
	const padding = Math.max(...[...inlined, ...kv].map((asset) => asset.route.length));

	if (inlined.length > 0) {
		builder.log.minor(`Inlined ${inlined.length} assets (Wasm):`);
		for (const asset of inlined) {
			const variants = [];
			if (asset.br) variants.push("br");
			if (asset.gzip) variants.push("gzip");

			const encodingLabel = variants.length > 0 ? `  (${variants.join(", ")})` : "";
			const sizeLabel = formatByteSize(asset.size).padStart(8);
			const label = asset.route.padEnd(padding);

			builder.log.minor(`  ${label}  ${sizeLabel}${encodingLabel}`);
		}
	}

	if (kv.length > 0) {
		builder.log.minor(`KV Store ${kv.length} assets:`);
		for (const asset of kv) {
			const variants = asset.variants;
			const encodingLabel = variants.length > 0 ? `  (${variants.join(", ")})` : "";
			const sizeLabel = formatByteSize(asset.size).padStart(8);
			const label = asset.route.padEnd(padding);

			builder.log.minor(`  ${label}  ${sizeLabel}${encodingLabel}`);
		}
	}
}