/**
 * invidiousMappings — reliable localStorage storage for Invidious playlist mappings.
 *
 * Why not use localstoragedb?
 * localstoragedb is designed for primitive column values (strings, numbers, bools).
 * It explicitly warns that object/array column values have caveats. In practice,
 * storing a nested object like { "5": "IVPLxxx" } as a column value is unreliable —
 * the value can silently fail to persist across sessions.
 *
 * Instead we write a plain JSON string directly to localStorage under a fixed key.
 * This is 100% reliable for nested objects.
 */

const LS_KEY = "elysium_inv_playlist_mappings";

export type InvidiousPlaylistMappings = Record<string, string>;

export function getMappings(): InvidiousPlaylistMappings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as InvidiousPlaylistMappings;
  } catch {
    return {};
  }
}

export function setMappings(mappings: InvidiousPlaylistMappings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(mappings));
  } catch (e) {
    console.error("[elysium] Failed to save Invidious playlist mappings:", e);
  }
}

export function getMapping(localId: number | string): string | undefined {
  return getMappings()[String(localId)];
}

export function setMapping(localId: number | string, invidiousPlaylistId: string): void {
  const mappings = getMappings();
  mappings[String(localId)] = invidiousPlaylistId;
  setMappings(mappings);
}

export function deleteMapping(localId: number | string): void {
  const mappings = getMappings();
  delete mappings[String(localId)];
  setMappings(mappings);
}
