import { existsSync } from "node:fs";

/**
 * Verifies the presence of the Fastly service configuration file
 *
 * @throws {Error}
 */
export function validateFastlyConfig() {
	if (!existsSync("fastly.toml")) {
		const url = "https://github.com/katriellucas/svelte-adapter-fastly#configuration";
		throw new Error(`Missing a fastly.toml file. Consult ${url}`);
	}
}
