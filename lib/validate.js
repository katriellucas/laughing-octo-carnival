import { existsSync } from "node:fs";

export function validateConfig() {
	if (!existsSync("fastly.toml")) {
		throw new Error(
			"Missing a fastly.toml file. Consult https://github.com/katriellucas/svelte-adapter-fastly#configuration"
		);
	}
}
