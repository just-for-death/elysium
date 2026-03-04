/**
 * deviceName.ts — generates a stable, memorable musical name for a device
 * based on its permanent deviceCode so the same device always gets the same name.
 */

const ADJECTIVES = [
  "Cosmic", "Velvet", "Crystal", "Neon", "Golden", "Silver", "Electric",
  "Midnight", "Solar", "Lunar", "Amber", "Crimson", "Indigo", "Jade",
  "Onyx", "Sapphire", "Scarlet", "Ivory", "Obsidian", "Aurora",
  "Stellar", "Phantom", "Radiant", "Serene", "Vivid", "Echo",
  "Sonic", "Rhythm", "Mellow", "Funky", "Groovy", "Jazzy",
];

const NOUNS = [
  "Bassline", "Melody", "Cadence", "Harmony", "Riff", "Chord",
  "Tempo", "Groove", "Resonance", "Frequency", "Overtone", "Downbeat",
  "Arpeggio", "Coda", "Tremolo", "Vibrato", "Falsetto", "Refrain",
  "Crescendo", "Interlude", "Prelude", "Serenade", "Nocturne", "Sonata",
  "Rhapsody", "Opus", "Ballad", "Overture", "Reprise", "Motif",
  "Anthem", "Vibe",
];

/** Stable hash — same code always produces same name */
const stableHash = (str: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
};

export const getMusicalDeviceName = (code: string): string => {
  const clean = code.replace(/-/g, "");
  const h1 = stableHash(clean);
  const h2 = stableHash(clean + "salt");
  const adj  = ADJECTIVES[h1 % ADJECTIVES.length];
  const noun = NOUNS[h2 % NOUNS.length];
  return `${adj} ${noun}`;
};

const GENERIC_PATTERNS = [
  /^Unknown Device$/i,
  /^Device \([A-Z0-9]{4}-[A-Z0-9]{4}\)$/i,
  /^My Device \([A-Z0-9]{4}-[A-Z0-9]{4}\)$/i,
  /^Device$/i,
];

/** Returns true if the name is a placeholder that should be replaced */
export const isGenericDeviceName = (name: string | null | undefined): boolean => {
  if (!name || !name.trim()) return true;
  return GENERIC_PATTERNS.some((re) => re.test(name.trim()));
};

/**
 * Returns a clean display name: uses the given name if it's non-generic,
 * otherwise falls back to the musical name for this device code.
 */
export const resolveDeviceName = (name: string | null | undefined, code: string): string => {
  if (isGenericDeviceName(name)) return getMusicalDeviceName(code);
  return name!.trim();
};
