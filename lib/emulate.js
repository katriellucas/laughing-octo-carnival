export class FastlyEmulator {
	/** @param {import('../index.d.ts').AdapterOptions} [opts] */
	constructor(opts) {
		/** @type {Partial<import("fastly:geolocation").Geolocation>} */
		this.geo = opts?.geo ?? {};
	}

	/** @returns {App.Platform} */
	platform() {
		return {
			env: (key) => process.env[key] ?? "",
			geo: {
				area_code: 0,
				as_name: null,
				as_number: 0,
				city: null,
				conn_speed: null,
				conn_type: null,
				continent: null,
				country_code: null,
				country_code3: null,
				country_name: null,
				latitude: null,
				longitude: null,
				metro_code: 0,
				postal_code: null,
				proxy_description: null,
				proxy_type: null,
				region: null,
				utc_offset: 0,
				gmt_offset: null,
				...this.geo,
			},
			// CHANGED: was silently swallowing async errors — now re-throws after logging
			waitUntil: (promise) =>
				promise.catch((e) => {
					console.error(e);
					throw e;
				}),
		};
	}
}
