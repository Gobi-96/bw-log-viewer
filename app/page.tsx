// app/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

interface RoasterSummary {
  serial: string;
  machineName?: string;
  model?: string;
  firmware?: string;
  lastSeen?: string;
}

interface RoastSummary {
  id: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  hasAlarms: boolean;
  alarms: string[];
  gcpLink: string;
  coolingDurationSeconds?: number | null;
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

  const pageSize = 10;

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
    if (!q) return roasters;

    return roasters.filter(r =>
      r.serial.toLowerCase().includes(q) ||
      (r.machineName || "").toLowerCase().includes(q)
    );
  }, [roasters, search]);

  // ==============================
  // SELECT ROASTER
  // ==============================
  function handleSelectRoaster(roaster: RoasterSummary) {
    setSelectedRoaster(roaster);
    setRoastPage(null);
    setRoastsError(null);
    setCurrentPage(1);

    // Set defaults to today's date
    const today = new Date().toISOString().slice(0, 10);
    setFromDate(today);
    setToDate(today);
    setFromTime("00:00");
    setToTime("23:59");
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
  async function fetchRoasts(page: number) {
    if (!selectedRoaster) return;

    if (!fromDate || !toDate) {
      setRoastsError("Select both date values");
      return;
    }

    setRoastsLoading(true);
    setRoastsError(null);

    const fromIso = combineDateTime(fromDate, fromTime);
    const toIso = combineDateTime(toDate, toTime);
    

    const params = new URLSearchParams();
    params.set("serial", selectedRoaster.serial);
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

                  {r.lastSeen && (
                    <div className="roaster-card-last-seen">
                      Last seen:
                      {" " + new Date(r.lastSeen).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  )}
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

              {/* TABLE */}
              {roastPage && roastPage.roasts.length > 0 && (
                <>
                  <table className="roast-table">
  <thead>
  <tr>
    <th>Roast ID</th>
    <th>Date</th>
    <th>Start Time</th>
    <th>End Time</th>
    <th>Duration</th>
    <th>Active Alarms</th>
    <th>Cooling Duration</th>
    <th>GCP Logs</th>
  </tr>
</thead>

<tbody>
  {roastPage.roasts.map(r => (
    <tr key={r.id}>
      <td className="mono">{r.id}</td>
      <td>{formatDateTime(r.startTime, timeZone).split(",")[0]}</td>
      <td>{formatTime(r.startTime, timeZone)}</td>
      <td>{r.endTime ? formatTime(r.endTime, timeZone) : "N/A"}</td>
      <td>{r.endTime ? formatDuration(r.durationSeconds) : "N/A"}</td>
      <td>
        {r.hasAlarms ? (
          <>
            <span className="tag tag--danger">✓ Yes</span>
                {r.alarms && r.alarms.length > 0 && (
                  <div className="alarm-list">
                    {r.alarms.map((name, idx) => (
                      <span key={name + idx} className="alarm-chip">
                        {name}
                      </span>
                    ))}
                  </div>
                )}
          </>
        ) : (
          <span className="tag tag--ok">✗ No</span>
        )}
      </td>
      <td>
        {r.coolingDurationSeconds && r.coolingDurationSeconds > 0
          ? formatDuration(r.coolingDurationSeconds)
          : "N/A"}
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
                <div className="info info--spaced">No roasts found for this range.</div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
