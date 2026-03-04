/**
 * Migration: rename generic device names to stable musical names.
 */
import { db } from ".";
import { resolveDeviceName } from "../utils/deviceName";

export default () => {
  const row = db.queryAll("settings", { query: { ID: 1 } })[0];
  if (!row) return;

  const linkedDevices: any[] = row.linkedDevices ?? [];
  if (!linkedDevices.length) return;

  const updated = linkedDevices.map((d: any) => ({
    ...d,
    name: resolveDeviceName(d.name, d.code),
  }));

  db.update("settings", { ID: 1 }, (r: any) => ({ ...r, linkedDevices: updated }));
  db.commit();
};
