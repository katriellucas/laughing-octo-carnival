import { join, resolve } from "node:path";
import { build } from "esbuild";

import { validateConfig } from "./validate.js";
import { writeInlinedAssets, logInlinedAssets } from "./assets.js";
import { writeManifest } from "./manifest.js";
import { compileToWasm } from "./compiler.js";

const filesDir = join(import.meta.dirname, "../files");

/**
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Maps virtual module imports at build time.
 * @param {string} temp
 * @param {string} serverDir
 * @returns {import('esbuild').Plugin}
 */
function buildAliasPlugin(temp, serverDir) {
	const aliases = {
		INLINED_ASSETS: join(temp, "inlined-assets.js"),
		MANIFEST: join(temp, "manifest.js"),
		SERVER: join(serverDir, "index.js"),
	};

	return {
		name: "fastly-adapter",
		setup(build) {
			for (const [filter, path] of Object.entries(aliases)) {
				build.onResolve({ filter: new RegExp(`^${escapeRegex(filter)}$`) }, () => ({ path }));
			}
		},
	};
}

/**
 * @param {import('@sveltejs/kit').Builder} builder
 * @param {import('../index.d.ts').AdapterOptions} opts
 */
export async function adapt(builder, opts = {}) {
	const { inlineLimit = Infinity } = opts;
	const out = resolve("bin");

	validateConfig();

	const temp = builder.getBuildDirectory("fastly-temp");
	builder.rimraf(temp);
	builder.rimraf(out);
	builder.mkdirp(temp);

	builder.log.minor("Copying assets...");
	const publishDir = join(temp, "publish");
	builder.writeClient(publishDir);
	builder.writePrerendered(publishDir);
	builder.writeServer(temp);

	const inlined = await writeInlinedAssets(temp, publishDir, inlineLimit, builder);
	logInlinedAssets(inlined, builder);

	writeManifest(temp, builder);

	builder.log.minor("Bundling worker...");
	const outputJs = join(temp, "src", "entry.js");

	try {
		await build({
			conditions: ["fastly"],
			target: "es2022",
			entryPoints: [join(filesDir, "entry.js")],
			bundle: true,
			outfile: outputJs,
			write: true,
			external: ["fastly:*"],
			allowOverwrite: true,
			format: "esm",
			minify: true,
			plugins: [buildAliasPlugin(temp, builder.getServerDirectory())],
		});
	} catch (err) {
		builder.log.error("Failed to bundle worker");
		throw err;
	}

	builder.log.minor("Compiling to Wasm...");
	
	try {
		builder.mkdirp(out);
		compileToWasm(outputJs, join(out, "main.wasm"), temp);
	} catch (err) {
		builder.log.error("Failed to compile");
		throw err;
	}
}