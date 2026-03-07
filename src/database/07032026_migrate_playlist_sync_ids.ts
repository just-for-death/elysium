/**
 * Migration: backfill syncId on every existing playlist that doesn't have one.
 * syncId is a permanent UUID used for cross-device deduplication in sync merge
 * logic. It never changes after creation and is never shown to the user.
 */
import { db } from ".";

export default () => {
  const playlists = db.queryAll("playlists") as any[];
  let patched = 0;
  for (const pl of playlists) {
    if (!pl.syncId) {
      db.update("playlists", { title: pl.title }, (row: any) => ({
        ...row,
        syncId: crypto.randomUUID(),
      }));
      patched++;
    }
  }
  if (patched > 0) db.commit();
};
