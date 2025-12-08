// app/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";

interface RoasterSummary {
  serial: string;
  machineName?: string;
  model?: string;
  firmware?: string;
  lastSeen?: string;
}

interface RoastSummary {
  id: string;
  roastProfileId?: string;
  roastSeq?: number | null;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  hasAlarms: boolean;
  alarms: { name: string; timestamp?: string }[];
  gcpLink: string;
  coolingDurationSeconds?: number | null;
  status?: "success" | "in_progress" | "failed";
}

interface RoastPage {
  page: number;
  pageSize: number;
  total: number;
  roasts: RoastSummary[];
}

function formatDateTime(iso: string, timeZone?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, timeZone ? { timeZone } : undefined);
}

function formatTime(iso: string, timeZone?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) {
    return `${h}h ${m}m ${ss}s`;
  }
  return `${m}m ${ss}s`;
}

export default function HomePage() {
  // --- ROASTER LIST ---
  const [roasters, setRoasters] = useState<RoasterSummary[]>([]);
  const [roastersLoading, setRoastersLoading] = useState(false);
  const [roastersError, setRoastersError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedRoaster, setSelectedRoaster] = useState<RoasterSummary | null>(null);

  // --- DATE & TIME PICKER ---
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [fromTime, setFromTime] = useState("00:00");
  const [toTime, setToTime] = useState("23:59");

  const [timeZone, setTimeZone] = useState<string>("");

  // --- ROAST RESULTS ---
  const [roastPage, setRoastPage] = useState<RoastPage | null>(null);
  const [roastsLoading, setRoastsLoading] = useState(false);
  const [roastsError, setRoastsError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [statusInfo, setStatusInfo] = useState<{
    state: "online" | "offline" | "unknown";
    label: string;
    lastSeen?: string;
    machineState?: { label: string; tone: "ready" | "preheat" | "roast" | "cool" | "standby" | "other" };
  }>({ state: "unknown", label: "Status unknown" });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const pageSize = 10;

  const liveLogsUrl = useMemo(() => {
    if (!selectedRoaster) return "";
    const query = encodeURIComponent(
      `logName="projects/bw-core/logs/roaster"\nlabels.serial="${selectedRoaster.serial}"`
    );
    return `https://console.cloud.google.com/logs/query;query=${query};timeRange=PT1H?project=bw-core`;
  }, [selectedRoaster]);

  function todayLocalISO() {
    // Format local date as YYYY-MM-DD without timezone shifts
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatSince(dateStr: string) {
    const ts = new Date(dateStr).getTime();
    if (!Number.isFinite(ts)) return "";
    const diffMs = Date.now() - ts;
    if (diffMs < 0) return "";
    const minutes = Math.floor(diffMs / (60 * 1000));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const years = Math.floor(days / 365);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 14) return `${days}d ago`;
    if (weeks < 52) return `${weeks}w ago`;
    return `${years}y ago`;
  }

  function normalizeLogTimestamp(ts: any): number | null {
    if (!ts) return null;
    if (typeof ts === "string") {
      const n = new Date(ts).getTime();
      return Number.isFinite(n) ? n : null;
    }
    if (ts instanceof Date) {
      const n = ts.getTime();
      return Number.isFinite(n) ? n : null;
    }
    if (typeof ts === "object") {
      const seconds = Number((ts as any).seconds ?? (ts as any)._seconds ?? 0);
      const nanos = Number((ts as any).nanos ?? (ts as any)._nanos ?? 0);
      if (!Number.isFinite(seconds)) return null;
      return seconds * 1000 + Math.floor(nanos / 1e6);
    }
    return null;
  }

  function alarmLink(r: RoastSummary, alarmName: string, alarmTs?: string) {
    const serial = selectedRoaster?.serial || "";
    if (!serial) return "";
    const centerIso = alarmTs || r.startTime;
    const query = encodeURIComponent(
      `logName="projects/bw-core/logs/roaster"\nlabels.serial="${serial}"\n${alarmName}`
    );
    const cursorParam = centerIso ? `;cursorTimestamp=${encodeURIComponent(centerIso)}` : "";
    const startParam = centerIso
      ? `;startTime=${encodeURIComponent(new Date(new Date(centerIso).getTime() - 5 * 60 * 1000).toISOString())}`
      : "";
    const endParam = centerIso
      ? `;endTime=${encodeURIComponent(new Date(new Date(centerIso).getTime() + 5 * 60 * 1000).toISOString())}`
      : "";
    return `https://console.cloud.google.com/logs/query;query=${query}${startParam}${endParam}${cursorParam}?project=bw-core`;
  }

  async function handleDownloadLogs(roast: RoastSummary) {
    if (!selectedRoaster) return;
    const start = roast.startTime;
    if (!start) return;
    let end = roast.endTime;
    if (!end) {
      end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
    } else if (roast.coolingDurationSeconds && roast.coolingDurationSeconds > 0) {
      end = new Date(new Date(end).getTime() + roast.coolingDurationSeconds * 1000).toISOString();
    }

    const params = new URLSearchParams();
    params.set("serial", selectedRoaster.serial);
    params.set("roastId", roast.id);
    params.set("start", start);
    if (end) params.set("end", end);
    params.set("slackSeconds", "10");

    function filenameFromDisposition(header: string | null): string | null {
      if (!header) return null;
      // Examples: attachment; filename="PS00015_12_6_2025_18_47_36.csv"
      const match = header.match(/filename\\*?=([^;]+)/i);
      if (!match || !match[1]) return null;
      return decodeURIComponent(match[1].trim().replace(/^\"|\"$/g, ""));
    }

    try {
      setDownloadingId(roast.id);
      const res = await fetch(`/api/downloadLogs?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const headerName = filenameFromDisposition(res.headers.get("Content-Disposition"));
      const fallbackName = `logs-${selectedRoaster.serial}-${roast.id}.csv`;
      const downloadName = headerName || fallbackName;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download logs", err);
      setRoastsError("Failed to download logs");
    } finally {
      setDownloadingId(null);
    }
  }

  function parseStateFromMessage(msg: string | undefined | null): string | null {
    if (!msg) return null;
    const lower = msg.toLowerCase();

    // Prefer explicit transitions: "... to Ready"
    const trans = lower.match(/state transition[^:]*:\s*[^>]*\bto\b\s*([a-z]+)/i);
    if (trans && trans[1]) return trans[1];

    // Generic "State: Ready"
    const stateAssign = lower.match(/\bstate\s*[:=]\s*([a-z]+)/i);
    if (stateAssign && stateAssign[1]) return stateAssign[1];

    // Keyword fallback
    const keywords: Record<string, string[]> = {
      ready: ["ready"],
      preheat: ["preheat", "pre-heat", "pre heat"],
      roast: ["roast", "roasting"],
      cool: ["cool", "cooling"],
      standby: ["standby", "idle"],
    };

    for (const [state, words] of Object.entries(keywords)) {
      for (const w of words) {
        if (lower.includes(w)) return state;
      }
    }

    return null;
  }

  function deriveMachineState(logs: any[]): { label: string; tone: "ready" | "preheat" | "roast" | "cool" | "standby" | "other" } | undefined {
    // Logs come newest-first from API; iterate to find the first with a recognizable state
    for (const log of logs || []) {
      const msg: string | undefined =
        log.message ||
        log.textPayload ||
        log.jsonPayload?.message ||
        log.metadata?.textPayload;

      const stateRaw = parseStateFromMessage(msg);
      if (!stateRaw) continue;

      const normalized = stateRaw.toLowerCase();
      if (normalized.includes("ready")) return { label: "Ready", tone: "ready" };
      if (normalized.includes("pre")) return { label: "Preheat", tone: "preheat" };
      if (normalized.includes("roast")) return { label: "Roast", tone: "roast" };
      if (normalized.includes("cool")) return { label: "Cool", tone: "cool" };
      if (normalized.includes("standby") || normalized.includes("idle")) return { label: "Standby", tone: "standby" };
      return { label: stateRaw.charAt(0).toUpperCase() + stateRaw.slice(1), tone: "other" };
    }
    return undefined;
  }

  function statusFromTimestamp(dateStr: string, thresholdMinutes = 60) {
    if (!dateStr) return { state: "unknown" as const, label: "Status unknown" };
    const t = new Date(dateStr).getTime();
    if (!Number.isFinite(t)) return { state: "unknown" as const, label: "Status unknown" };
    const diffMs = Date.now() - t;
    // Treat future timestamps as stale (offline) to avoid false "online" from clock skew/future logs
    if (diffMs < 0) {
      return {
        state: "offline" as const,
        label: `Offline • Last seen ${formatSince(new Date(t).toISOString())}`,
        lastSeen: new Date(t).toISOString(),
      };
    }
    const minutes = diffMs / (60 * 1000);
    if (minutes <= thresholdMinutes) return { state: "online" as const, label: "Online", lastSeen: new Date(t).toISOString() };
    return {
      state: "offline" as const,
      label: `Offline • Last seen ${formatSince(new Date(t).toISOString())}`,
      lastSeen: new Date(t).toISOString(),
    };
  }

  // Refresh online status from latest logs for the selected roaster
  useEffect(() => {
    if (!selectedRoaster) {
      setStatusInfo({ state: "unknown", label: "Status unknown" });
      return;
    }
    // Start in checking state to avoid flashing offline before we know
    setStatusInfo({ state: "unknown", label: "Checking status…" });

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/logs?serial=${encodeURIComponent(selectedRoaster.serial)}&windowMinutes=60`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const timestamps: number[] = (data.logs || [])
          .map((l: any) =>
            normalizeLogTimestamp(l.timestamp) ??
            normalizeLogTimestamp(l.timeStamp) ??
            normalizeLogTimestamp(l.time) ??
            normalizeLogTimestamp(l.receiveTimestamp) ??
            normalizeLogTimestamp(l.metadata?.timestamp)
          )
          .filter((n: number | null) => Number.isFinite(n)) as number[];

        const latest = Math.max(...timestamps, -Infinity);
        const machineState = deriveMachineState(data.logs || []);
        if (Number.isFinite(latest) || (data.logs || []).length > 0) {
          const lastIso = Number.isFinite(latest) ? new Date(latest).toISOString() : undefined;
          const isFresh =
            lastIso && Date.now() - new Date(lastIso).getTime() <= 60 * 60 * 1000; // 60 minutes freshness
          if (machineState && isFresh) {
            setStatusInfo({ state: "online", label: "Online", lastSeen: lastIso, machineState });
          } else {
            const label = lastIso ? `Offline • Last seen ${formatSince(lastIso)}` : "Offline";
            setStatusInfo({ state: "offline", label, lastSeen: lastIso });
          }
          return;
        }

        // No logs in window; if we have lastSeen, show offline relative to it; else unknown
        if (selectedRoaster.lastSeen) {
          setStatusInfo(statusFromTimestamp(selectedRoaster.lastSeen, 60));
        } else {
          setStatusInfo({ state: "unknown", label: "Status unknown" });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (selectedRoaster.lastSeen) {
          const offline = statusFromTimestamp(selectedRoaster.lastSeen, 60);
          setStatusInfo(offline);
        } else {
          setStatusInfo({ state: "unknown", label: "Status unknown" });
        }
      }
    })();

    return () => controller.abort();
  }, [selectedRoaster]);

  // ==============================
  // LOAD ROASTERS ON APP START
  // ==============================
  useEffect(() => {
    const loadRoasters = async () => {
      setRoastersLoading(true);
      setRoastersError(null);

      try {
        const res = await fetch("/api/roasters");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        setRoasters(data.roasters || []);
      } catch (err: any) {
        setRoastersError(err.message || "Failed to load roasters");
      } finally {
        setRoastersLoading(false);
      }
    };

    // Detect browser time zone for display and queries
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimeZone(tz || "");
    } catch {
      setTimeZone("");
    }

    loadRoasters();
  }, []);

  // ==============================
  // FILTER SEARCHED ROASTERS
  // ==============================
  const filteredRoasters = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? roasters.filter(r =>
          r.serial.toLowerCase().includes(q) ||
          (r.machineName || "").toLowerCase().includes(q)
        )
      : roasters;

    const onlineThresholdMinutes = 60;
    const weight = (r: RoasterSummary) => {
      if (!r.lastSeen) return -Infinity;
      const info = statusFromTimestamp(r.lastSeen, onlineThresholdMinutes);
      return info.state === "online" ? new Date(r.lastSeen).getTime() : -Infinity;
    };

    // If searching and nothing matches, allow a manual offline entry so user can fetch by serial
    let augmented = list;
    if (q && list.length === 0) {
      augmented = [{
        serial: q.toUpperCase(),
        machineName: "(manual entry)",
      } as RoasterSummary];
    }

    return [...augmented].sort((a, b) => {
      const wa = weight(a);
      const wb = weight(b);
      if (wa === wb) return a.serial.localeCompare(b.serial);
      return wb - wa; // online (recent) first
    });
  }, [roasters, search]);

  // ==============================
  // SELECT ROASTER
  // ==============================
  function handleSelectRoaster(roaster: RoasterSummary) {
    setSelectedRoaster(roaster);
    setRoastPage(null);
    setRoastsError(null);
    setCurrentPage(1);
    setRoastsLoading(true);

    // Set defaults to today's date
    const today = todayLocalISO();
    setFromDate(today);
    setToDate(today);
    setFromTime("00:00");
    setToTime("23:59");
    const fromIso = combineDateTime(today, "00:00");
    const toIso = combineDateTime(today, "23:59");
    fetchRoasts(1, { roaster, from: fromIso, to: toIso });
  }

  // ==============================
  // COMBINE DATE + TIME 
  // ==============================
  function combineDateTime(date: string, time: string) {
    if (!date || !time) return "";
    const local = new Date(`${date}T${time}:00`);
    if (isNaN(local.getTime())) return "";
    return local.toISOString();
  }
  

  // ==============================
  // FETCH ROASTS
  // ==============================
  async function fetchRoasts(
    page: number,
    overrides?: { roaster?: RoasterSummary; from?: string; to?: string }
  ) {
    const roaster = overrides?.roaster ?? selectedRoaster;
    if (!roaster) return;

    setRoastsLoading(true);
    setRoastsError(null);

    if (!overrides?.from && (!fromDate || !toDate)) {
      setRoastsError("Select both date values");
      setRoastsLoading(false);
      return;
    }

    const fromIso = overrides?.from ?? combineDateTime(fromDate, fromTime);
    const toIso = overrides?.to ?? combineDateTime(toDate, toTime);


    const params = new URLSearchParams();
    params.set("serial", roaster.serial);
    params.set("from", fromIso);
    params.set("to", toIso);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));    

    try {
      const res = await fetch(`/api/roasts?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as RoastPage;
      setRoastPage(data);
      setCurrentPage(data.page);
    } catch (err: any) {
      setRoastsError(err.message || "Failed to load roasts");
    } finally {
      setRoastsLoading(false);
    }
  }

  function handleLoadRoasts() {
    fetchRoasts(1);
  }

  function handleNextPage() {
    if (!roastPage) return;
    const maxPage = Math.ceil(roastPage.total / roastPage.pageSize);
    if (currentPage < maxPage) fetchRoasts(currentPage + 1);
  }

  function handlePrevPage() {
    if (currentPage > 1) fetchRoasts(currentPage - 1);
  }

  // ==============================
  // UI RENDER
  // ==============================
  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-title">Roaster Dashboard</div>
        <div className="app-subtitle">Bellwether Log Viewer (local)</div>
      </header>

      <main className="app-main">
        {/* LEFT: ROASTER LIST */}
        <section className="panel roaster-panel">
          <div className="panel-header">
            <h2>Roasters</h2>
            <div className="panel-subtitle">Select a roaster to view roast history</div>
          </div>

          <div className="search-row">
            <input
              type="text"
              placeholder="Search roaster by serial or name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {roastersLoading && <div className="info">Loading roasters…</div>}
          {roastersError && <div className="error">{roastersError}</div>}
          {!roastersLoading && filteredRoasters.length === 0 && (
            <div className="info">No roasters found.</div>
          )}

          <div className="roaster-grid">
            {filteredRoasters.map(r => {
              const active = selectedRoaster?.serial === r.serial;
              return (
                <button
                  key={r.serial}
                  className={`roaster-card ${active ? "roaster-card--active" : ""}`}
                  onClick={() => handleSelectRoaster(r)}
                >
                  <div className="roaster-card-main">
                    <div className="roaster-card-serial">{r.serial}</div>
                    {r.machineName && <div className="roaster-card-name">{r.machineName}</div>}
                  </div>

                  <div className="roaster-card-meta">
                    {r.model && <span>{r.model}</span>}
                    {r.firmware && <span>FW {r.firmware}</span>}
                  </div>

                </button>
              );
            })}
          </div>
        </section>

        {/* RIGHT: ROAST RESULTS */}
        <section className="panel roast-panel">
          <div className="panel-header">
            <h2>Roasts</h2>
            {selectedRoaster ? (
              <div className="panel-subtitle">
                {selectedRoaster.serial}
                {selectedRoaster.machineName && " • " + selectedRoaster.machineName}
                <span
                  className={`status-chip ${
                    statusInfo.state === "online"
                      ? "status-chip--online"
                      : statusInfo.state === "offline"
                      ? "status-chip--offline"
                      : "status-chip--unknown"
                  }`}
                  title={
                    statusInfo.state === "offline" && statusInfo.lastSeen
                      ? `Last seen ${new Date(statusInfo.lastSeen).toLocaleString()}`
                      : undefined
                  }
                >
                  <span className="status-dot" />
                  {statusInfo.label}
                </span>
                {statusInfo.machineState && (
                  <span className={`state-chip state-chip--${statusInfo.machineState.tone}`}>
                    {statusInfo.machineState.label}
                  </span>
                )}
                {liveLogsUrl && (
                  <a className="status-link" href={liveLogsUrl} target="_blank" rel="noopener noreferrer">
                    Live logs →
                  </a>
                )}
              </div>
            ) : (
              <div className="panel-subtitle">Select a roaster on the left</div>
            )}
          </div>

          {selectedRoaster && (
            <>
              {/* DATE + TIME PICKERS */}
              <div className="date-row">

                <div className="date-field">
                  <label>Start date</label>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                  <input type="time" value={fromTime} onChange={e => setFromTime(e.target.value)} />
                </div>

                <div className="date-field">
                  <label>End date</label>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
                  <input type="time" value={toTime} onChange={e => setToTime(e.target.value)} />
                </div>

                <div className="date-actions">
                  <div className="timezone-label">Timezone: {timeZone || "local device"}</div>
                  <button className="primary-btn" onClick={handleLoadRoasts} disabled={roastsLoading}>
                    {roastsLoading ? "Loading…" : "Load Roasts"}
                  </button>
                </div>
              </div>

              {/* ERRORS */}
              {roastsError && <div className="error error--spaced">{roastsError}</div>}

              {/* LOADING OVERLAY */}
              {roastsLoading && (
                <div className="loading-overlay">
                  <div className="loading-bar" />
                  <div className="loading-text">Loading roasts… Please wait!</div>
                </div>
              )}

              {/* TABLE */}
              {roastPage && roastPage.roasts.length > 0 && (
                <>
                  <table className="roast-table">
  <thead>
  <tr>
    <th>Roast ID</th>
    <th>Roast Profile ID</th>
    <th>Date</th>
    <th>Roast Seq</th>
    <th>Start Time</th>
    <th>End Time</th>
    <th>Duration</th>
    <th>Active Alarms</th>
    <th>Roast Status</th>
    <th>Cooling Duration</th>
    <th>Download Logs</th>
    <th>GCP Logs</th>
  </tr>
</thead>

<tbody>
  {roastPage.roasts.map(r => (
    <tr key={r.id}>
      <td className="mono">{r.id}</td>
      <td className="mono">{r.roastProfileId || "N/A"}</td>
      <td>{formatDateTime(r.startTime, timeZone).split(",")[0]}</td>
      <td>{Number.isFinite(r.roastSeq as number) ? r.roastSeq : "-"}</td>
      <td>{formatTime(r.startTime, timeZone)}</td>
      <td>{r.endTime ? formatTime(r.endTime, timeZone) : "N/A"}</td>
      <td>{r.endTime ? formatDuration(r.durationSeconds) : "N/A"}</td>
      <td>
                {r.hasAlarms ? (
                  <>
                    <span className="tag tag--danger">✓ Yes</span>
                    {r.alarms && r.alarms.length > 0 && (
                      <div className="alarm-list">
                        {r.alarms.map((alarm, idx) => (
                          <a
                            key={alarm.name + idx}
                            className="alarm-chip"
                            href={alarmLink(r, alarm.name, alarm.timestamp)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {alarm.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
          <span className="tag tag--ok">✗ No</span>
        )}
      </td>
      <td>
        {r.status === "success" && <span className="pill pill--success">Success</span>}
        {r.status === "in_progress" && <span className="pill pill--inprogress">In Progress</span>}
        {r.status === "failed" && <span className="pill pill--failed">Failed / Aborted</span>}
        {!r.status && <span className="pill pill--unknown">Unknown</span>}
      </td>
      <td>
        {r.coolingDurationSeconds && r.coolingDurationSeconds > 0
          ? formatDuration(r.coolingDurationSeconds)
          : "N/A"}
      </td>
      <td>
        <button
          className="icon-btn"
          title="Download logs"
          onClick={() => handleDownloadLogs(r)}
          disabled={!!downloadingId}
        >
          {downloadingId === r.id ? "⏳" : "⬇"}
        </button>
      </td>
      <td>
        <a
          href={r.gcpLink}
          target="_blank"
          rel="noopener noreferrer"
          className="gcp-link"
        >
          Open in GCP →
        </a>
      </td>
    </tr>
  ))}
</tbody>

                  </table>

                  {/* PAGINATION */}
                  <div className="pagination-row">
                    <button onClick={handlePrevPage} disabled={currentPage <= 1 || roastsLoading}>
                      Previous
                    </button>

                    <span>
                      Page {currentPage}
                      {roastPage.total > 0 && (
                        <>
                          {" "}
                          of {Math.ceil(roastPage.total / roastPage.pageSize)}
                          {" • "}
                          {roastPage.total} roasts
                        </>
                      )}
                    </span>

                    <button
                      onClick={handleNextPage}
                      disabled={
                        !roastPage ||
                        currentPage >= Math.ceil(roastPage.total / roastPage.pageSize) ||
                        roastsLoading
                      }
                    >
                      Next
                    </button>
                  </div>
                </>
              )}

              {/* EMPTY STATE */}
              {roastPage && roastPage.roasts.length === 0 && !roastsLoading && (
                <div className="info info--spaced">No roasts found for the selected range.</div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
