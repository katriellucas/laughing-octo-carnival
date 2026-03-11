import { writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { posix, resolve, join } from "node:path";
import { lookup } from "mrmime";
import { hashBuffer, compressBrotli, compressGzip } from "./compress.js";

/**
 * @param {string} p
 * @returns {string}
 */
function slash(p) {
	return p.replaceAll("\\", "/");
}

/**
 * @param {{ route: string, localPath: string, size: number, hash: string, lastModifiedTime: number, br: boolean, gzip: boolean }} file
 * @returns {string}
 */
function toAssetLine(file) {
	const route = JSON.stringify(file.route);
	const contentType = JSON.stringify(lookup(file.route) ?? "application/octet-stream");
	const relPath = (suffix = "") => JSON.stringify("./" + file.localPath + suffix);

	const fields = [
		`bytes: includeBytes(${relPath()})`,
		`contentType: ${contentType}`,
		`size: ${file.size}`,
		`hash: ${JSON.stringify(file.hash)}`,
		`lastModifiedTime: ${file.lastModifiedTime}`,
		...(file.br   ? [`br: includeBytes(${relPath(".br")})`]   : []),
		...(file.gzip ? [`gzip: includeBytes(${relPath(".gz")})`] : []),
	];

	return `inlinedAssets.set(${route}, { ${fields.join(", ")} });`;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * @typedef {{ route: string, size: number, br: number | null, gzip: number | null }} InlinedAssetInfo
 */

/**
 * @param {string} temp
 * @param {string} publishDir
 * @param {number} inlineLimit
 * @returns {InlinedAssetInfo[]}
 */
export function writeInlinedAssets(temp, publishDir, inlineLimit) {
	if (!existsSync(publishDir)) {
		writeFileSync(join(temp, "inlined-assets.js"), `export const inlinedAssets = new Map();\n`);
		return [];
	}

	const publishDirSlashed = slash(publishDir);
	const files = readdirSync(publishDir, { recursive: true, withFileTypes: true })
		.filter((dirent) => dirent.isFile() && !dirent.name.endsWith(".br") && !dirent.name.endsWith(".gz"))
		.map((dirent) => {
			const absolute = resolve(dirent.parentPath, dirent.name);
			const route = "/" + posix.relative(publishDirSlashed, slash(absolute));
			const { mtimeMs } = statSync(absolute);
			return { absolute, route, lastModifiedTime: Math.floor(mtimeMs / 1000) };
		});

	const assetLines = [];
	/** @type {InlinedAssetInfo[]} */
	const inlined = [];

	for (const file of files) {
		const buffer = readFileSync(file.absolute);

		if (buffer.length > inlineLimit) continue;

		const hash = hashBuffer(buffer);
		const size = buffer.length;
		const localPath = "publish" + file.route;

		const br = compressBrotli(buffer);
		const gzip = compressGzip(buffer);

		if (br)   writeFileSync(file.absolute + ".br", br);
		if (gzip) writeFileSync(file.absolute + ".gz", gzip);

		assetLines.push(toAssetLine({
			route: file.route,
			localPath,
			size,
			hash,
			lastModifiedTime: file.lastModifiedTime,
			br: br !== null,
			gzip: gzip !== null,
		}));

		inlined.push({
			route: file.route,
			size,
			br: br ? br.length : null,
			gzip: gzip ? gzip.length : null,
		});
	}

	writeFileSync(
		join(temp, "inlined-assets.js"),
		[
			`import { includeBytes } from "fastly:experimental";`,
			`export const inlinedAssets = new Map();`,
			...assetLines,
		].join("\n") + "\n"
	);

	return inlined;
}

/**
 * @param {InlinedAssetInfo[]} assets
 * @param {import('@sveltejs/kit').Builder} builder
 */
export function logInlinedAssets(assets, builder) {
	if (assets.length === 0) {
		builder.log.minor("Inlined 0 assets");
		return;
	}

	const routeCol = Math.max(...assets.map((a) => a.route.length));

	builder.log.minor(`Inlined ${assets.length} assets:`);
	for (const asset of assets) {
		const route = asset.route.padEnd(routeCol);
		const size = formatSize(asset.size).padStart(8);
		const comprParts = [];
		if (asset.br   !== null) comprParts.push(`br: ${formatSize(asset.br)}`);
		if (asset.gzip !== null) comprParts.push(`gzip: ${formatSize(asset.gzip)}`);
		const compr = comprParts.length > 0 ? `  (${comprParts.join(", ")})` : "";
		builder.log.minor(`  ${route}  ${size}${compr}`);
	}
}
