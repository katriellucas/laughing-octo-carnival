/// <reference path="./ambient.d.ts" />

import type { Adapter } from "@sveltejs/kit";
import type { Geolocation } from "fastly:geolocation";

// CHANGED: removed strategy, kvStore, collection — inline-only adapter, no KV
export interface AdapterOptions {
	inlineLimit?: number;
	geo?: Partial<Geolocation>;
}

export default function (opts?: AdapterOptions): Adapter;
