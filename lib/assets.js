import { writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { hash } from "node:crypto";
import { posix, resolve, join } from "node:path";
import { lookup } from "mrmime";

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
		...(file.br ? [`br: includeBytes(${relPath(".br")})`] : []),
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
 * @typedef {{ route: string, size: number, br: boolean, gzip: boolean }} InlinedAssetInfo
 */

/**
 * @param {string} temp
 * @param {string} publishDir
 * @param {number} inlineLimit
 * @param {import('@sveltejs/kit').Builder} builder
 * @returns {Promise<InlinedAssetInfo[]>}
 */
export async function writeInlinedAssets(temp, publishDir, inlineLimit, builder) {
	if (!existsSync(publishDir)) {
		writeFileSync(join(temp, "inlined-assets.js"), `export const inlinedAssets = new Map();\n`);
		return [];
	}

	builder.log.minor("Compressing assets...");
	await builder.compress(publishDir);

	const publishDirSlashed = slash(publishDir);
	const files = readdirSync(publishDir, { recursive: true, withFileTypes: true })
		.filter(
			(dirent) => dirent.isFile() && !dirent.name.endsWith(".br") && !dirent.name.endsWith(".gz")
		)
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

		const fileHash = hash("sha256", buffer, "hex");
		const size = buffer.length;
		const localPath = "publish" + file.route;

		const hasBr = existsSync(file.absolute + ".br");
		const hasGzip = existsSync(file.absolute + ".gz");

		assetLines.push(
			toAssetLine({
				route: file.route,
				localPath,
				size,
				hash: fileHash,
				lastModifiedTime: file.lastModifiedTime,
				br: hasBr,
				gzip: hasGzip,
			})
		);

		inlined.push({ route: file.route, size, br: hasBr, gzip: hasGzip });
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
		if (asset.br) comprParts.push("br");
		if (asset.gzip) comprParts.push("gzip");
		const compr = comprParts.length > 0 ? `  (${comprParts.join(", ")})` : "";
		builder.log.minor(`  ${route}  ${size}${compr}`);
	}
}
