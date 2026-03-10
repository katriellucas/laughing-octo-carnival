// Virtual module declarations for esbuild alias resolution.
// These modules don't exist on disk — they are resolved at build time
// by the fastly-adapter esbuild plugin in adapter.js.

declare module "MANIFEST" {
	import { SSRManifest } from "@sveltejs/kit";
	export const manifest: SSRManifest;
	export const prerendered: Map<string, { file: string }>;
	export const basePath: string;
}

declare module "SERVER" {
	export { Server } from "@sveltejs/kit";
}

declare module "INLINED_ASSETS" {
	export const inlinedAssets: Map<string, {
		bytes: Uint8Array<ArrayBuffer>;
		br?: Uint8Array<ArrayBuffer>;
		gzip?: Uint8Array<ArrayBuffer>;
		contentType: string;
		size: number;
		hash: string;
		lastModifiedTime: number;
	}>;
}

// CHANGED: removed STATIC_PUBLISH_CONFIG module declaration — no longer used (dropped compute-js-static-publish)

// Shared types used across lib/
export interface FileEntry {
	absolute: string;
	route: string;
	size: number;
}
