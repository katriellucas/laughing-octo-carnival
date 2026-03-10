import { adapt } from "./lib/adapter.js";
import { FastlyEmulator } from "./lib/emulate.js";

/** @param {import('./index.d.ts').AdapterOptions} [opts] */
export default function (opts = {}) {
	const { geo } = opts;

	/** @type {import('@sveltejs/kit').Adapter} */
	const adapter = {
		name: "@katriel/svelte-adapter-fastly",

		async adapt(builder) {
			await adapt(builder, opts);
		},

		async emulate() {
			return new FastlyEmulator({ geo });
		},

		supports: {
			read: () => false,
			instrumentation: () => false,
		},
	};

	return adapter;
}
