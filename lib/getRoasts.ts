// lib/getRoasts.ts
import { getRoastIds } from "./getRoastIds";
import { logging } from "./logging";

function addMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  return new Date(d.getTime() + minutes * 60 * 1000).toISOString();
}

function addSeconds(iso: string, seconds: number): string {
  const d = new Date(iso);
  return new Date(d.getTime() + seconds * 1000).toISOString();
}

function messageFromEntry(entry: any): string {
  if (!entry) return "";
  if (entry.textPayload) return String(entry.textPayload);
  if (entry.data) return String(entry.data);
  const jp = entry.jsonPayload;
  if (jp) {
    if (typeof jp === "string") return jp;
    if (typeof jp.message === "string") return jp.message;
    try {
      return JSON.stringify(jp);
    } catch {
      // ignore
    }
  }
  return "";
}

function normalizeTs(ts: any): string | null {
  if (!ts) return null;
  if (typeof ts === "string") {
    const fixed = ts.replace(/\.(\d{3})\d+Z$/, ".$1Z");
    const d = new Date(fixed);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "object") {
    const seconds = Number(ts.seconds ?? ts._seconds ?? ts.value?.seconds ?? 0);
    const nanos = Number(ts.nanos ?? ts._nanos ?? ts.value?.nanos ?? 0);
    if (!Number.isFinite(seconds)) return null;
    return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
  }
  return null;
}

function extractAlarmName(text: string): string | null {
  // ActiveAlarms JSON array
  const activeMatch = text.match(/ActiveAlarms:\s*(\[[^\]]+\])/i);
  if (activeMatch && activeMatch[1]) {
    try {
      const arr = JSON.parse(activeMatch[1]);
      const names: string[] = [];
      for (const item of arr) {
        if (item?.Name) names.push(String(item.Name));
      }
      if (names.length) return names.join(", ");
    } catch {
      // fall through
    }
  }

  const alarmMatch = text.match(/ALARM[:\s-]*([^,;\n\r]+)/i);
  if (alarmMatch && alarmMatch[1]) {
    return alarmMatch[1].trim();
  }

  const nameFieldMatch = text.match(/"Name"\s*:\s*"([^"]+)"/i);
  if (nameFieldMatch && nameFieldMatch[1]) return nameFieldMatch[1].trim();

  const tagMatch = text.match(/Tag=([A-Za-z0-9_\-]+)/);
  if (tagMatch && tagMatch[1]) {
    return tagMatch[1].trim();
  }

  if (/ActiveAlarms:\s*\[\s*\]/i.test(text)) return null;
  return null;
}

function normalizeAlarmNames(raw: string | null): string[] {
  if (!raw) return [];
  const matches = raw.match(/[A-Za-z][A-Za-z0-9_.-]{2,}/g) || [];
  const reserved = new Set([
    "INFO",
    "ALARM",
    "ActiveAlarms",
    "Verb",
    "Level",
    "Severity",
    "DATA",
    "set",
    "setTag",
    "Tag",
  ]);
  const names: string[] = [];
  for (const m of matches) {
    if (reserved.has(m)) continue;
    if (/^x?[0-9a-fA-F]+$/.test(m)) continue; // hex-ish codes like x401
    if (/^set/i.test(m)) continue;
    if (m.toLowerCase().startsWith("s")) {
      // skip stray leading s / s_DATA tokens
      if (m === "s" || m.startsWith("s_DATA")) continue;
    }

    // normalize Main_Blower_RuntimeFail/MainBlowerRuntime_Fail variants to a single token
    const normalized = m.replace(/Runtime_Fail/i, "RuntimeFail").replace(/_/g, "_");
    names.push(normalized);
  }
  // Deduplicate while preserving order; prefer collapsing camel vs underscore duplicates
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of names) {
    const key = n.replace(/_/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(n);
  }
  return unique;
}

function parseCoolingDuration(text: string): { seconds: number; label: string } | null {
  // e.g., "LOG Cool , 3:22" or "Cool , 3:22"
  const coolMatch = text.match(/Cool\s*,\s*(\d+):(\d{2})/i);
  if (coolMatch) {
    const minutes = Number(coolMatch[1]);
    const seconds = Number(coolMatch[2]);
    const total = minutes * 60 + seconds;
    if (Number.isFinite(total)) return { seconds: total, label: `${minutes}:${coolMatch[2]}` };
  }

  // e.g., "Bean Cooler reached ... at 3:23, m:s"
  const reachedMatch = text.match(/reached[^0-9]*([0-9]+):([0-9]{2})/i);
  if (reachedMatch) {
    const minutes = Number(reachedMatch[1]);
    const seconds = Number(reachedMatch[2]);
    const total = minutes * 60 + seconds;
    if (Number.isFinite(total)) return { seconds: total, label: `${minutes}:${reachedMatch[2]}` };
  }

  return null;
}

async function fetchCoolingInfo(
  serial: string,
  startIso: string,
  endIso: string
) {
  const filter = `
logName="projects/bw-core/logs/roaster"
labels.serial="${serial}"
timestamp >= "${startIso}"
timestamp <= "${endIso}"
(textPayload:"Cool" OR textPayload:"COOL" OR textPayload:"Bean Cooler reached" OR jsonPayload.message:"Cool" OR jsonPayload.message:"COOL" OR jsonPayload.message:"Bean Cooler reached")
`.trim();

  const [entries] = await logging.getEntries({
    filter,
    orderBy: "timestamp asc",
    pageSize: 1200,
  });

  let coolingSeconds: number | null = null;

  for (const entry of entries) {
    const ts = normalizeTs((entry as any).timestamp || (entry as any).metadata?.timestamp);
    if (!ts) continue;
    const text = messageFromEntry(entry);
    if (!text) continue;

    const parsed = parseCoolingDuration(text);
    if (parsed) {
      coolingSeconds = parsed.seconds;
    }
  }

  return {
    coolingDurationSeconds: coolingSeconds,
  };
}

async function fetchRoastAlarms(
  serial: string,
  startIso: string,
  endIso: string,
  endBoundary?: string
) {
  const filter = `
logName="projects/bw-core/logs/roaster"
labels.serial="${serial}"
timestamp >= "${startIso}"
timestamp <= "${endIso}"
(textPayload:"ALARM" OR textPayload:"Alarm" OR textPayload:"ActiveAlarms" OR jsonPayload.message:"ALARM" OR jsonPayload.message:"Alarm" OR jsonPayload.message:"ActiveAlarms")
`.trim();

  const [entries] = await logging.getEntries({
    filter,
    orderBy: "timestamp asc",
    pageSize: 200,
  });

  const alarms = new Set<string>();
  let seenActive = false;

  for (const entry of entries) {
    if (seenActive) break;

    const ts = normalizeTs((entry as any).timestamp || (entry as any).metadata?.timestamp);
    if (!ts) continue;
    if (ts < startIso) continue;
    if (ts > endIso) break;

    const text = messageFromEntry(entry);
    if (!text) continue;

    // Skip empty ActiveAlarms sections
    const isActiveSection = /ActiveAlarms/i.test(text);
    if (/ActiveAlarms:\s*\[\s*\]/i.test(text)) {
      if (isActiveSection && (endBoundary ? ts >= endBoundary : true)) {
        seenActive = true;
      }
      continue;
    }

    const rawName = extractAlarmName(text);
    const names = normalizeAlarmNames(rawName);
    for (const n of names) {
      alarms.add(n);
    }

    const pastEnd = endBoundary ? ts >= endBoundary : true;
    if (isActiveSection && pastEnd) {
      seenActive = true;
    }
  }

  return Array.from(alarms);
}

export async function getRoasts(
  serial: string,
  from: string | undefined,
  to: string | undefined,
  page: number,
  pageSize: number
) {
  const roastIds = await getRoastIds(serial, from, to);
  // Collapse multiple log hits into a single roast row
  const grouped = new Map<
    string,
    {
      id: string;
      startTime: string;
      endTime: string;
      startRaw: string;
      endRaw: string;
      earliest: string;
    }
  >();

  for (const r of roastIds) {
    const existing = grouped.get(r.roastId) || {
      id: r.roastId,
      startTime: "",
      endTime: "",
      startRaw: "",
      endRaw: "",
      earliest: r.timestamp,
    };

    // Earliest overall timestamp for fallback
    if (r.timestamp < existing.earliest) {
      existing.earliest = r.timestamp;
    }

    // Explicit start/end classification
    if (r.eventType === "start") {
      if (!existing.startTime || r.timestamp < existing.startTime) {
        existing.startTime = r.timestamp;
        existing.startRaw = r.raw;
      }
    }

    if (r.eventType === "end") {
      if (!existing.endTime || r.timestamp > existing.endTime) {
        existing.endTime = r.timestamp;
        existing.endRaw = r.raw;
      }
    }

    // Fallback: if we never saw a start, use earliest as start so we at least show something
    if (!existing.startTime) {
      existing.startTime = existing.earliest;
      existing.startRaw = existing.startRaw || r.raw;
    }

    grouped.set(r.roastId, existing);
  }

  const groupedList = Array.from(grouped.values()).sort((a, b) =>
    b.startTime.localeCompare(a.startTime)
  );

  const total = groupedList.length;

  // Simple pagination over grouped roasts
  const start = Math.max(0, (page - 1) * pageSize);
  const end = start + pageSize;
  const slice = groupedList.slice(start, end);

  const roasts = await Promise.all(
    slice.map(async r => {
      const durationSeconds = r.startTime && r.endTime
        ? Math.max(0, (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 1000)
        : 0;

      // Filter to this roaster's serial and exclude roastctl by pinning logName to roaster.
      const query = encodeURIComponent(
        `labels.serial="${serial}" logName="projects/bw-core/logs/roaster"`
      );
      const startWindow = from || r.startTime;
      const computedEnd = r.endTime && r.endTime !== "" ? r.endTime : new Date(new Date(r.startTime).getTime() + 60 * 60 * 1000).toISOString();
      const endWindow = to || computedEnd;

      const startParam = startWindow ? `;startTime=${encodeURIComponent(startWindow)}` : "";
      const endParam = endWindow ? `;endTime=${encodeURIComponent(endWindow)}` : "";
      const cursorParam = r.startTime ? `;cursorTimestamp=${encodeURIComponent(r.startTime)}` : "";

      // Fetch alarms in the roast window
      let alarms: string[] = [];
      try {
        const alarmStart = r.startTime;
        const alarmEnd = r.endTime && r.endTime !== ""
          ? addSeconds(r.endTime, 5)
          : addMinutes(r.startTime, 60);
        alarms = await fetchRoastAlarms(serial, alarmStart, alarmEnd, r.endTime || undefined);
      } catch (err) {
        console.error("Error fetching alarms for", r.id, err);
      }

      // Cooling info (search from roast end to a reasonable window)
      let coolingDurationSeconds: number | null = null;
      try {
        const coolingStart = r.endTime && r.endTime !== "" ? r.endTime : r.startTime;
        const coolingEndWindow = addMinutes(coolingStart, 120);
        const cooling = await fetchCoolingInfo(serial, coolingStart, coolingEndWindow);
        if (Number.isFinite(cooling.coolingDurationSeconds as number)) {
          coolingDurationSeconds = cooling.coolingDurationSeconds as number;
        }
      } catch (err) {
        console.error("Error fetching cooling for", r.id, err);
      }

      return {
        id: r.id,
        startTime: r.startTime,
        endTime: r.endTime && r.endTime !== r.startTime ? r.endTime : "",
        durationSeconds,
        hasAlarms: alarms.length > 0,
        alarms,
        coolingDurationSeconds: coolingDurationSeconds ?? null,
        gcpLink: `https://console.cloud.google.com/logs/query;query=${query}${startParam}${endParam}${cursorParam}?project=bw-core`,
      };
    })
  );

  return {
    page,
    pageSize,
    total,
    roasts,
  };
}
