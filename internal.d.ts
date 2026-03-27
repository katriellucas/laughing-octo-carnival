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
		bytes: Uint8Array;
		br?: Uint8Array;
		gzip?: Uint8Array;
		contentType: string;
		size: number;
		hash: string;
		lastModifiedTime: number;
	}>;
}

declare module "KV_ASSETS" {
	export const kvStoreName: string;
	export const kvPrefix: string;
	export const collectionName: string;
}