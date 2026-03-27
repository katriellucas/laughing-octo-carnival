/**
 * Verifies if a value is a plain object
 *
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
export function isPlainObj(value) {
	if (value === null) return false;
	if (typeof value !== "object") return false;
	if (Array.isArray(value)) return false;
	return true;
}

/**
 * Safely extracts a string message from an unknown error type
 *
 * @param {unknown} err
 * @returns {string}
 */
export function getErrorMsg(err) {
	if (err instanceof Error) return err.message;
	return String(err);
}

/**
 * Normalizes a file path to use POSIX-style forward slashes
 *
 * @param {string} path
 * @returns {string}
 */
export function toPosixPath(path) {
	return path.replaceAll("\\", "/");
}

/**
 * Formats a byte count into a human-readable string
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatByteSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}