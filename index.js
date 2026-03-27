import { adapt } from "./lib/adapter.js";

/**
 * SvelteKit adapter for Fastly Compute
 *
 * @param {import("./index.js").AdapterOptions} [options]
 * @returns {import("@sveltejs/kit").Adapter}
 */
export default function (options = {}) {
	return {
		name: `@katriel/svelte-adapter-fastly`,

		async adapt(builder) {
			await adapt(builder, options);
		},

		// @todo add emulate() in a future release
		// requires a proxy layer for fastly:* modules to support vite dev

		supports: {
			read: () => false,
			instrumentation: () => false,
		},
	};
}
