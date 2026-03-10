// CHANGED: removed "fileURLToPath" from "node:url" and "dirname" — replaced by import.meta.dirname (Node 20.11.0+)
import { join, normalize, resolve } from "node:path";
import { build } from "esbuild";

import { validateConfig } from "./validate.js";
import { writeInlinedAssets } from "./assets.js";
import { writeManifest } from "./manifest.js";
import { compileToWasm } from "./compiler.js";

// CHANGED: was normalize(dirname(fileURLToPath(import.meta.url))) — now uses import.meta.dirname (Node 20.11.0+)
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
export async function adapt(builder, opts) {
	const { inlineLimit = Infinity } = opts;
	const out = resolve("bin");
	const buildDir = resolve("build");

	validateConfig();

	const temp = normalize(builder.getBuildDirectory("fastly-temp"));
	builder.rimraf(temp);
	builder.rimraf(out);
	builder.rimraf(buildDir);
	builder.mkdirp(temp);
	builder.mkdirp(buildDir);

	builder.log.minor("Copying assets...");
	builder.writeClient(buildDir);
	builder.writePrerendered(buildDir);
	builder.writeServer(temp);

	const inlinedCount = writeInlinedAssets(temp, buildDir, inlineLimit);
	builder.log.minor(`Inlined ${inlinedCount} assets`);

	writeManifest(temp, builder);

	builder.log("Bundling worker...");
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

	builder.log("Compiling to Wasm...");
	try {
		builder.mkdirp(out);
		compileToWasm(outputJs, join(out, "main.wasm"), temp);
	} catch (err) {
		builder.log.error("Failed to compile");
		throw err;
	}
}
