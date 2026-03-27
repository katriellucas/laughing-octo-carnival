# svelte-adapter-fastly

A [SvelteKit](https://kit.svelte.dev/) adapter that compiles your app into a [Fastly Compute](https://www.fastly.com/products/edge-compute) WebAssembly binary, running your app at the edge.

## How it works

When you build your SvelteKit app with this adapter:

1. Static and prerendered assets are either **inlined into the Wasm binary** (small files) or **uploaded to a Fastly KV Store** (large files), depending on a configurable size threshold.
2. The SvelteKit server is **bundled and compiled to WebAssembly** using `@fastly/js-compute`.
3. The resulting `bin/main.wasm` is ready to deploy with `fastly compute deploy`.

Requests are handled at the edge: static assets are served directly from the binary or KV Store, and dynamic routes are handled by the SvelteKit SSR server.

---

## Requirements

- Node.js >= 20.12.0
- A [Fastly account](https://www.fastly.com/signup/) with a Compute service
- The [Fastly CLI](https://developer.fastly.com/learning/tools/cli/) installed
- A `fastly.toml` file in your project root

---

## Installation

```bash
npm install -D @katriel/svelte-adapter-fastly
```

---

## Setup

### 1. Configure the adapter in `svelte.config.js`

```js
import adapter from '@katriel/svelte-adapter-fastly';

export default {
  kit: {
    adapter: adapter()
  }
};
```

### 2. Create a `fastly.toml`

This file is required by the Fastly CLI. At minimum:

```toml
manifest_version = 3
name = "my-sveltekit-app"
language = "javascript"

[scripts]
  build = "npm run build"
```

Refer to the [Fastly TOML reference](https://developer.fastly.com/reference/compute/fastly-toml/) for all available options.

### 3. Set your API token (for KV Store uploads)

```bash
export FASTLY_API_TOKEN=your_token_here
```

Or add it to a `.env` file in your project root — the adapter will load it automatically during builds.

---

## Building

```bash
npm run build
```

This produces:

- `bin/main.wasm` — the compiled Wasm binary, ready to deploy
- `bin/kv-stores/` — local KV simulation data for dev server testing

---

## Deploying

```bash
fastly compute deploy
```

If you have KV assets, make sure your Fastly service has a KV Store linked with the name you configured (see [Options](#options) below).

---

## Local development

```bash
fastly compute serve
```

This runs the Wasm binary locally using the Fastly CLI's local simulator. KV assets are served from `bin/kv-stores/` automatically.

For the local simulator to find your KV Store, add the following to your `fastly.toml`, pointing at the JSON file the adapter generated during the build:

```toml
[local_server.kv_stores]
my-kv-store = { file = "./bin/kv-stores/my-kv-store.json", format = "json" }
```

Replace `my-kv-store` with the value you set for `kvStoreName`. The adapter writes this file automatically on every build, so you don't need to manage it manually.

---

## Options

All options are optional. Pass them to the adapter:

```js
adapter({
  publish: {
    kvStoreName: 'my-kv-store',
    kvPrefix: 'default',
    collectionName: 'live',
    wasmAssetLimit: 10240,
    kvChunkSize: 20971520,
  }
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `kvStoreName` | `string` | — | Name of the Fastly KV Store for large assets. If omitted, all assets are inlined into the Wasm binary. |
| `kvPrefix` | `string` | `"default"` | Prefix for all KV keys. Useful when sharing a KV Store between multiple apps. |
| `collectionName` | `string` | `"live"` | Asset collection name. Change this to stage multiple content sets in the same KV Store. |
| `wasmAssetLimit` | `number` | `10240` | Maximum file size in bytes to inline into the Wasm binary. Files larger than this go to KV. |
| `kvChunkSize` | `number` | `20971520` | Maximum chunk size in bytes for KV uploads. Fastly's default limit is 25 MB; this defaults to 20 MB to stay safely under it. |

### Asset inlining vs KV Store

- Files **at or below** `wasmAssetLimit` are embedded directly in the Wasm binary using `includeBytes`. This is fast to serve but increases binary size.
- Files **above** `wasmAssetLimit` are uploaded to your Fastly KV Store and fetched at request time.
- If `kvStoreName` is not set, or if `FASTLY_API_TOKEN` is missing at build time, **all assets are inlined** into the binary regardless of size.

---

## KV Store setup

1. Create a KV Store in your Fastly account with the same name as `kvStoreName`.
2. Link it to your Compute service in the Fastly dashboard or via the CLI.
3. Set `FASTLY_API_TOKEN` before building so the adapter can upload assets.

Assets are uploaded automatically during `npm run build`. Compressed variants (Brotli, Gzip) are uploaded separately when present and served based on the client's `Accept-Encoding` header.

---

## CLI commands

The adapter ships with a CLI for KV Store maintenance.

### `kv-clean`

Removes unreferenced assets from the KV Store (assets no longer referenced by any live collection).

```bash
npx svelte-adapter-fastly kv-clean
```

**Flags:**

| Flag | Description |
|---|---|
| `--dry-run` | Preview what would be deleted without actually deleting anything |
| `--verbose` | Print each key being evaluated |

Requires `bin/publish.config.json` (generated automatically on build) and `FASTLY_API_TOKEN` to be set.

---

## Platform object

In your SvelteKit server code, the Fastly platform object is available via `event.platform`:

```ts
export function load({ platform }) {
  // Read an environment variable from Fastly
  const version = platform.env('FASTLY_SERVICE_VERSION');

  // Open a KV Store by name
  const store = platform.kv('my-store');

  // Get client geolocation
  const country = platform.geo?.country_code;
}
```

| Property | Type | Description |
|---|---|---|
| `env` | `(key: string) => string` | Reads a Fastly environment variable |
| `geo` | `Geolocation \| null` | Client geolocation data |
| `kv` | `(name: string) => KVStore` | Opens a Fastly KV Store by name |
| `waitUntil` | `(promise: Promise<unknown>) => void` | Extends the event lifetime for background work |

---

## Limitations

- `read` and `instrumentation` SvelteKit features are not supported.
- The Fastly local dev server (`fastly compute serve`) does not support hot module reload — you need to rebuild on changes.
- `fastly:*` modules (KV Store, environment, geolocation, etc.) are only available at runtime inside the Fastly Compute environment. They cannot be used during the build step or in Node.js.
- The Fastly CLI must be installed and a valid `fastly.toml` must exist in the project root, or the build will fail.

---

## License

MIT