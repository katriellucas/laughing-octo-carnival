import type { Geolocation } from "fastly:geolocation";
import type { KVStore } from "fastly:kv-store";

declare global {
	namespace App {
		interface Platform {
			env: (key: string) => string;
			geo: Geolocation | null;
			kv: (storeName: string) => KVStore;
			waitUntil: (promise: Promise<unknown>) => void;
		}
	}
}