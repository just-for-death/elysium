/**
 * Diagnostic logger for Elysium. Enable via localStorage:
 *   localStorage.setItem("elysium_debug", "1")
 * Disable: localStorage.removeItem("elysium_debug")
 */
const isDebug = () =>
  typeof localStorage !== "undefined" &&
  localStorage.getItem("elysium_debug") === "1";

export const log = {
  debug: (msg: string, data?: unknown) => {
    if (isDebug()) {
      console.log(`[elysium] ${msg}`, data ?? "");
    }
  },
  warn: (msg: string, data?: unknown) => {
    console.warn(`[elysium] ${msg}`, data ?? "");
  },
  error: (msg: string, err?: unknown) => {
    console.error(`[elysium] ${msg}`, err ?? "");
  },
  /** Log fetch/JSON errors with response context for diagnosis */
  fetchError: (
    context: string,
    url: string,
    response: Response,
    bodyPreview?: string,
    parseError?: unknown,
  ) => {
    const detail = {
      context,
      url,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      bodyPreview: bodyPreview?.slice(0, 300),
      parseError: parseError instanceof Error ? parseError.message : parseError,
    };
    log.error(`${context}: non-JSON or failed response`, detail);
    if (isDebug()) console.table?.(detail);
  },
};
