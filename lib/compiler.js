import { readFileSync } from "node:fs";
import { join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// CHANGED: removed createRequire from "node:module" — replaced by import.meta.resolve (Node 20.11.0+)
// NOTE: import.meta.resolve returns a file:// URL string, so fileURLToPath is still needed here

/**
 * Walk up from the package entry point to find its package.json.
 * @param {string} startDir
 * @returns {{ root: string, pkg: { name?: string, bin?: string | Record<string, string> } }}
 */
function readPackageJson(startDir) {
	let dir = startDir;

	while (dir !== dirname(dir)) {
		try {
			const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
			if (pkg.name === "@fastly/js-compute") return { root: dir, pkg };
		} catch {
			// no package.json here, keep walking up
		}
		dir = dirname(dir);
	}

	throw new Error("@fastly/js-compute package.json not found.");
}

/**
 * @param {string | Record<string, string>} bin
 * @returns {string | undefined}
 */
function resolveBinEntry(bin) {
	if (typeof bin === "string") return bin;
	return bin["js-compute-runtime"] ?? bin["js-compute"] ?? Object.values(bin)[0];
}

/** @returns {string} */
function resolveCompilerBin() {
	// CHANGED: was require.resolve("@fastly/js-compute") via createRequire — now uses import.meta.resolve (Node 20.11.0+)
	const entryPoint = fileURLToPath(import.meta.resolve("@fastly/js-compute"));
	const { root, pkg } = readPackageJson(dirname(entryPoint));

	if (!pkg.bin) throw new Error("@fastly/js-compute binary not found.");
	const binEntry = resolveBinEntry(pkg.bin);
	if (!binEntry) throw new Error("@fastly/js-compute binary not found.");

	return normalize(join(root, binEntry));
}

/**
 * @param {string} inputJs
 * @param {string} outputWasm
 * @param {string} temp
 */
export function compileToWasm(inputJs, outputWasm, temp) {
	const binPath = resolveCompilerBin();
	const args = [binPath, "--enable-experimental-top-level-await", inputJs, outputWasm];

	try {
		execFileSync(process.execPath, args, { cwd: temp, stdio: "inherit" });
	} catch {
		throw new Error(`Wasm compilation failed. Command: node ${args.join(" ")}`);
	}
}
