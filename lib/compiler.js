import { readFileSync } from "node:fs";
import { join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getErrorMsg } from "./utils.js";

/**
 * Searches for the Fastly compute package to identify the compiler root
 *
 * @param {string} startDir
 * @returns {{
 *   root: string,
 *   packageJson: {
 *     name?: string,
 *     bin?: string | Record<string, string>
 *   }
 * }}
 */
function findFastlyPackage(startDir) {
	let current = startDir;

	while (current !== dirname(current)) {
		try {
			const packagePath = join(current, "package.json");
			const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));

			if (packageJson.name === "@fastly/js-compute") return { root: current, packageJson };
		} catch {
			// skip
		}
		current = dirname(current);
	}

	throw new Error(`@fastly/js-compute package.json not found`);
}

/**
 * Resolves the absolute path to the Fastly js-compute-runtime binary
 *
 * @returns {string}
 */
function resolveCompilerPath() {
	const entryUrl = import.meta.resolve("@fastly/js-compute");
	const entryPath = fileURLToPath(entryUrl);
	const { root, packageJson } = findFastlyPackage(dirname(entryPath));

	let binary = packageJson.bin;
	if (!binary) throw new Error(`@fastly/js-compute binary not defined in package.json`);

	if (typeof binary !== "string") {
		binary = binary["js-compute-runtime"] ?? binary["js-compute"] ?? Object.values(binary)[0];
	}

	if (!binary) throw new Error(`Could not locate binary entry in @fastly/js-compute`);

	return normalize(join(root, binary));
}

/** @type {string | undefined} */
let cachedCompilerPath;

/**
 * Invokes the Fastly compiler to produce the final WebAssembly binary
 *
 * @param {string} inputJs
 * @param {string} outputWasm
 * @param {string} tempDir
 */
export function compileToWasm(inputJs, outputWasm, tempDir) {
	cachedCompilerPath ??= resolveCompilerPath();

	const argumentsList = [
		cachedCompilerPath,
		"--enable-experimental-top-level-await",
		inputJs,
		outputWasm,
	];

	try {
		execFileSync(process.execPath, argumentsList, { cwd: tempDir, stdio: "inherit" });
	} catch (error) {
		throw new Error(`Wasm compilation failed: ${getErrorMsg(error)}`);
	}
}
