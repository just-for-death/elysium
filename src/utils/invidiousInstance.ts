import type { Instance } from "../types/interfaces/Instance";

/** Default Invidious instance - music/audio focused, per user preference */
export const DEFAULT_INVIDIOUS_URI = "https://inv.nadeko.net";

/** Fallback instance when API returns no usable instances */
export const getDefaultInstance = (): Instance => ({
  domain: "inv.nadeko.net",
  api: true,
  cors: true,
  flag: "🌐",
  monitor: {} as Instance["monitor"],
  region: "US",
  stats: {} as Instance["stats"],
  type: "https",
  uri: DEFAULT_INVIDIOUS_URI,
  custom: false,
});

/**
 * Normalize instance URI to prevent malformed URLs (double protocol, missing colon, etc).
 * Fixes: "https//host" -> "https://host", "https://https://host" -> "https://host"
 */
export const normalizeInstanceUri = (uri: string | null | undefined): string => {
  if (!uri || typeof uri !== "string") return "";
  let s = uri.trim().replace(/\/+$/, "");
  // Fix "https//" or "http//" (missing colon)
  s = s.replace(/^(https?)\/\/(?!\/)/i, "$1://");
  // Fix double protocol: "https://https://x" or "https://https//x"
  s = s.replace(/^(https?):\/\/(https?)\/\/?/i, "$1://");
  // Ensure protocol exists
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s.replace(/^\/+/, "")}`;
  }
  return s;
};
