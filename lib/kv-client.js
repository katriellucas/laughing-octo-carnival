import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getErrorMsg } from "./utils.js";

const CHUNK_SIZE_DEFAULT = 1024 * 1024 * 20;

/**
 * Fastly KV Store REST API client
 */
export class FastlyKVClient {
	/**
	 * @param {string} token
	 * @param {string} storeName
	 * @param {number} [chunkSize]
	 */
	constructor(token, storeName, chunkSize = CHUNK_SIZE_DEFAULT) {
		this.token = token;
		this.storeName = storeName;
		this.chunkSize = chunkSize;

		/** @type {string | null} */
		this.storeId = null;
	}

	/**
	 * @param {string} path
	 * @param {RequestInit} [options]
	 * @returns {Promise<Response>}
	 */
	async api(path, options = {}) {
		const response = await fetch(`https://api.fastly.com${path}`, {
			...options,
			headers: {
				"Fastly-Key": this.token,
				Accept: "application/json",
				...options.headers,
			},
		});

		if (!response.ok && response.status !== 404) {
			const body = await response.text();
			throw new Error(`Fastly API error ${response.status}: ${body}`);
		}

		return response;
	}

	/**
	 * @returns {Promise<string>}
	 */
	async resolveStoreId() {
		if (this.storeId !== null) return this.storeId;

		const response = await this.api("/resources/stores/kv");
		const { data } = await response.json();

		const store = data.find((/** @type {{ name: string }} */ s) => s.name === this.storeName);

		if (!store) {
			throw new Error(`KV Store "${this.storeName}" not found in your Fastly account`);
		}

		return (this.storeId = store.id);
	}

	/**
	 * @param {string} prefix
	 * @returns {Promise<string[]>}
	 */
	async listKeys(prefix) {
		const storeId = await this.resolveStoreId();

		/** @type {string[]} */
		const keys = [];
		let cursor = "";

		while (true) {
			const params = new URLSearchParams({ prefix });
			if (cursor) params.set("cursor", cursor);

			const response = await this.api(`/resources/stores/kv/${storeId}/keys?${params}`);
			if (response.status === 404) break;

			const { data, meta } = await response.json();
			keys.push(...data);

			if (!meta?.next_cursor) break;
			cursor = meta.next_cursor;
		}

		return keys;
	}

	/**
	 * @param {string} key
	 * @returns {Promise<boolean>}
	 */
	async keyExists(key) {
		const storeId = await this.resolveStoreId();

		const response = await this.api(
			`/resources/stores/kv/${storeId}/keys/${encodeURIComponent(key)}`,
			{ method: "HEAD" }
		);

		return response.status === 200;
	}

	/**
	 * @param {string} key
	 * @param {Buffer | Uint8Array} buffer
	 * @param {Record<string, unknown>} metadata
	 */
	async uploadBuffer(key, buffer, metadata) {
		const storeId = await this.resolveStoreId();
		const numChunks = Math.ceil(buffer.length / this.chunkSize);

		for (let i = 0; i < numChunks; i++) {
			const chunkKey = i === 0 ? key : `${key}_${i}`;
			const chunk = buffer.subarray(i * this.chunkSize, (i + 1) * this.chunkSize);

			const chunkMetadata =
				i === 0 ? { ...metadata, ...(numChunks > 1 ? { numChunks } : {}) } : { chunkIndex: i };

			await this.api(`/resources/stores/kv/${storeId}/keys/${encodeURIComponent(chunkKey)}`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/octet-stream",
					metadata: JSON.stringify(chunkMetadata),
				},
				body: new Uint8Array(chunk),
			});
		}
	}

	/**
	 * @param {string} key
	 */
	async deleteKey(key) {
		const storeId = await this.resolveStoreId();

		await this.api(`/resources/stores/kv/${storeId}/keys/${encodeURIComponent(key)}`, {
			method: "DELETE",
		});
	}

	/**
	 * @param {import('./assets.js').KVAssetInfo[]} assets
	 * @param {import('./assets.js').KVAssetIndex} kvIndex
	 * @param {string} storeContentDir
	 * @param {string} kvPrefix
	 * @param {string} collectionName
	 * @param {import('@sveltejs/kit').Builder} builder
	 */
	async syncAssets(assets, kvIndex, storeContentDir, kvPrefix, collectionName, builder) {
		builder.log.minor(`Syncing assets to Fastly KV Store "${this.storeName}"...`);

		for (const asset of assets) {
			const variants = [
				{ key: `${kvPrefix}_files_sha256:${asset.hash}`, suffix: "", encoding: null },
				...asset.variants.map((encoding) => ({
					key: `${kvPrefix}_files_sha256:${asset.hash}_${encoding}`,
					suffix: `_${encoding}`,
					encoding,
				})),
			];

			for (const variant of variants) {
				try {
					if (await this.keyExists(variant.key)) continue;

					const blobPath = join(storeContentDir, `${asset.hash}${variant.suffix}`);
					const buffer = readFileSync(blobPath);

					await this.uploadBuffer(variant.key, buffer, {
						hash: asset.hash,
						size: buffer.length,
						...(variant.encoding ? { contentEncoding: variant.encoding } : {}),
					});
				} catch (err) {
					builder.log.warn(`Failed to sync asset ${variant.key}: ${getErrorMsg(err)}`);
				}
			}
		}

		const indexKey = `${kvPrefix}_index_${collectionName}`;
		await this.uploadBuffer(indexKey, Buffer.from(JSON.stringify(kvIndex)), {
			publishedTime: Math.floor(Date.now() / 1000),
		});

		// Sentinel key used to identify live collections
		const metadataKey = `${kvPrefix}_metadata_${collectionName}`;
		await this.uploadBuffer(metadataKey, Buffer.from("{}"), {});
	}
}