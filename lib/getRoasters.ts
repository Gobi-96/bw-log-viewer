// lib/getRoasters.ts
import { logging, projectId } from "./logging";

export interface RoasterSummary {
  serial: string;
  machineName?: string;
  model?: string;
  firmware?: string;
  lastSeen?: string;
}

export async function getRoasters(): Promise<RoasterSummary[]> {
  // Grab recent entries that have labels.serial
  const filter = `
    logName=("projects/${projectId}/logs/roaster" OR "projects/${projectId}/logs/roastctl")
    labels.serial!=""
  `;

  const [entries] = await logging.getEntries({
    filter,
    orderBy: "timestamp desc",
    pageSize: 500,
  });

  const bySerial = new Map<string, RoasterSummary>();

  for (const entry of entries as any[]) {
    const labels = entry.labels || {};
    const serial: string | undefined = labels.serial;
    if (!serial) continue;

    const machineName: string | undefined =
      labels.machine_name || labels.machineName;
    const model: string | undefined = labels.model;
    const firmware: string | undefined = labels.version;

    let isoTime = "";
    if (entry.timestamp?.seconds) {
      isoTime = new Date(
        Number(entry.timestamp.seconds) * 1000 +
          Math.floor(Number(entry.timestamp.nanos || 0) / 1e6)
      ).toISOString();
    }

    if (!bySerial.has(serial)) {
      bySerial.set(serial, {
        serial,
        machineName,
        model,
        firmware,
        lastSeen: isoTime,
      });
    }
  }

  return Array.from(bySerial.values()).sort((a, b) =>
    a.serial.localeCompare(b.serial)
  );
}
