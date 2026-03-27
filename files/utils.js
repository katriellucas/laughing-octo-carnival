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
