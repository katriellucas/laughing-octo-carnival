import {
	writeFileSync,
	readFileSync,
	readdirSync,
	statSync,
	existsSync,
	mkdirSync,
	copyFileSync,
} from "node:fs";
import { posix, resolve, join, dirname } from "node:path";
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
		...(file.br ? [`br: includeBytes(${relPath(".br")})`] : []),
		...(file.gzip ? [`gzip: includeBytes(${relPath(".gz")})`] : []),
	];

	return `inlinedAssets.set(${route}, { ${fields.join(", ")} });`;
}

/**
 * @param {string} temp
 * @param {string} buildDir
 * @param {number} inlineLimit
 * @returns {number}
 */
export function writeInlinedAssets(temp, buildDir, inlineLimit) {
	if (!existsSync(buildDir)) {
		writeFileSync(join(temp, "inlined-assets.js"), `export const inlinedAssets = new Map();\n`);
		return 0;
	}

	const staticDir = join(temp, "static");

	const files = readdirSync(buildDir, { recursive: true, withFileTypes: true })
		.filter((dirent) => {
			if (!dirent.isFile()) return false;
			return !slash(dirent.parentPath)
				.split("/")
				.some((s) => s.startsWith("."));
		})
		.map((dirent) => {
			const absolute = resolve(dirent.parentPath, dirent.name);
			const route = "/" + posix.relative(slash(buildDir), slash(absolute));
			const stat = statSync(absolute);
			return {
				absolute,
				route,
				size: stat.size,
				lastModifiedTime: Math.floor(stat.mtimeMs / 1000),
			};
		})
		.filter((file) => file.size <= inlineLimit);

	const assetLines = files.map((file) => {
		const buffer = readFileSync(file.absolute);
		const { hash } = hashBuffer(buffer);

		const localPath = "static" + file.route;
		const dest = join(staticDir, file.route);
		mkdirSync(dirname(dest), { recursive: true });
		copyFileSync(file.absolute, dest);

		// Attempt compression — only write if smaller than original
		const br = compressBrotli(buffer);
		const gzip = compressGzip(buffer);

		if (br) writeFileSync(dest + ".br", br);
		if (gzip) writeFileSync(dest + ".gz", gzip);

		return toAssetLine({
			route: file.route,
			localPath,
			size: file.size,
			hash,
			lastModifiedTime: file.lastModifiedTime,
			br: br !== null,
			gzip: gzip !== null,
		});
	});

	writeFileSync(
		join(temp, "inlined-assets.js"),
		[
			`import { includeBytes } from "fastly:experimental";`,
			`export const inlinedAssets = new Map();`,
			...assetLines,
		].join("\n") + "\n"
	);

	return assetLines.length;
}
