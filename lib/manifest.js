import { writeFileSync } from "node:fs";
import { join, relative, posix } from "node:path";

/**
 * @param {string} temp
 * @param {import('@sveltejs/kit').Builder} builder
 */
export function writeManifest(temp, builder) {
	const base = builder.config.kit.paths.base;
	const pages = builder.prerendered.pages;

	const serverPath = relative(temp, builder.getServerDirectory()).replaceAll("\\", "/");
	const relativePath = serverPath.startsWith(".") ? serverPath : `./${serverPath}`;

	const prerendered = Array.from(pages, ([path, { file }]) => {
		const filePath = base ? posix.join(base, file) : file;
		return [path, { file: filePath }];
	});

	const manifest = builder.generateManifest({ relativePath });

	writeFileSync(
		join(temp, "manifest.js"),
		[
			`export const manifest = ${manifest};`,
			`export const prerendered = new Map(${JSON.stringify(prerendered)});`,
			`export const basePath = ${JSON.stringify(base)};`,
		].join("\n") + "\n"
	);
}
