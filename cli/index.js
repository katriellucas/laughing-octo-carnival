#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const [, , command, ...args] = process.argv;

if (!existsSync(resolve("bin/publish.config.json"))) {
	console.error("bin/publish.config.json not found. Run a production build first.");
	process.exit(1);
}

switch (command) {
	case "kv-clean": {
		const { action } = await import("./commands/clean.js");
		await action(args);
		break;
	}
	default: {
		console.error(`Unknown command: "${command ?? "(none)"}"`);
		console.error("Available commands: kv-clean");
		process.exit(1);
	}
}
