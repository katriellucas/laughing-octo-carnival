import { writeFileSync } from "node:fs";
import { join, relative, posix } from "node:path";
import { toPosixPath } from "./utils.js";

/**
 * Generates the runtime manifest module
 *
 * @param {string} tempDir
 * @param {import('@sveltejs/kit').Builder} builder
 */
export function writeManifest(tempDir, builder) {
	const basePath = builder.config.kit.paths.base;
	const pages = builder.prerendered.pages;

	const serverRelative = toPosixPath(relative(tempDir, builder.getServerDirectory()));
	const relativePath = serverRelative.startsWith(".") ? serverRelative : `./${serverRelative}`;

	const entries = Array.from(pages, ([path, { file }]) => {
		const filePath = basePath ? posix.join(basePath, file) : file;
		return [path, { file: filePath }];
	});

	const manifest = builder.generateManifest({ relativePath });

	const content = [
		`export const manifest = ${manifest};`,
		`export const prerendered = new Map(${JSON.stringify(entries)});`,
		`export const basePath = ${JSON.stringify(basePath)};`,
	].join("\n");

	writeFileSync(join(tempDir, "manifest.js"), `${content}\n`);
}
