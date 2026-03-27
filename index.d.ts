/// <reference path="./ambient.d.ts" />

import type { Adapter } from "@sveltejs/kit";

export interface AdapterOptions {
	publish?: {
		/**
		 * Name of the Fastly KV Store to use for large assets
		 */
		kvStoreName: string;

		/**
		 * Prefix for all KV keys
		 * Only needed when sharing a KV Store between multiple apps
		 *
		 * @default "default"
		 */
		kvPrefix?: string;

		/**
		 * Asset collection name
		 * Change this to stage multiple content sets in the same KV Store
		 *
		 * @default "live"
		 */
		collectionName?: string;

		/**
		 * Maximum asset size in bytes to inline into the WebAssembly binary
		 *
		 * @default 10240
		 */
		wasmAssetLimit?: number;

		/**
		 * The size in bytes for each KV Store chunk
		 * Fastly limit is 25MB by default, can be raised up to 100MB on request
		 *
		 * @default 20971520
		 */
		kvChunkSize?: number;
	};
}

/**
 * SvelteKit adapter for Fastly Compute
 * Compiles your app into a WebAssembly binary for Fastly's edge network
 * `fastly:*` modules are only available at runtime via `fastly compute serve`
 */
export default function (options?: AdapterOptions): Adapter;