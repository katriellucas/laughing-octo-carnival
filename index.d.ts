/// <reference path="./ambient.d.ts" />

import type { Adapter } from "@sveltejs/kit";
import type { Geolocation } from "fastly:geolocation";

export interface AdapterOptions {
	inlineLimit?: number;
	geo?: Partial<Geolocation>;
}

export default function (opts?: AdapterOptions): Adapter;
