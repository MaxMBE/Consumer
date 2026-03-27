"use client";

import { useState, useEffect, useRef } from "react";
import { useCampaigns, useAuth } from "@/context";
import type { Campaign } from "@/context/CampaignsContext";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayStage {
  eventName: string;
  label: string;
  events: number;
}

interface DaySnapshot {
  id: string;
  savedAt: string;
  periodLabel: string; // "4 mar 2026"
  periodDate: string;  // "2026-03-04" — para ordenar
  source: string;
  totalEvents: number;
  totalUsers: number;
  eventsPerUser: number;
  funnel: DayStage[];
}

// ─── Constants ────────────────────────────────────────────────────────────────


const STAGE_DEFS = [
  { name: "page_view", label: "Visitas de página" },
  { name: "scroll", label: "Interacción (scroll)" },
  { name: "session_start", label: "Sesiones iniciadas" },
  { name: "first_visit", label: "Usuarios nuevos" },
  { name: "user_engagement", label: "Usuarios comprometidos" },
  { name: "cupon_generado", label: "Cupones generados" },
  { name: "registro_usuario", label: "Registros de usuario" },
  { name: "cupones_canjeados", label: "Cupones canjeados" },
];

const MONTH_MAP: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const calcPct = (c: number, p: number) =>
  p ? Math.round(((c - p) / p) * 1000) / 10 : 0;

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

const parseSpNum = (s: string) =>
  parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T12:00:00");
  const db = new Date(b + "T12:00:00");
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

// ─── PDF Extraction ───────────────────────────────────────────────────────────

async function extractPDFText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  (pdfjs as any).GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${(pdfjs as any).version}/build/pdf.worker.min.mjs`;
  const buf = await file.arrayBuffer();
  const doc = await (pdfjs as any).getDocument({ data: buf }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += (content.items as { str: string }[]).map((x) => x.str).join(" ") + "\n";
  }
  return out;
}

// ─── GA4 Single-Day Parser ───────────────────────────────────────────────────
//
// En el texto extraído por pdfjs el layout de GA4 pone los números ANTES
// que los nombres de eventos. Entonces no buscamos "forward" desde el nombre
// sino que extraemos los números del bloque previo y los mapeamos por orden.
//
function parseGA4SingleDay(raw: string): Partial<DaySnapshot> {
  // 1. Orden de eventos: "1 page_view", "2 scroll", etc.
  const ordRx = /\b([1-9])\s+(page_view|scroll|session_start|first_visit|user_engagement|cupon_generado|registro_usuario|cupones_canjeados)\b/gi;
  const ordMatches = [...raw.matchAll(ordRx)].sort((a, b) => parseInt(a[1]) - parseInt(b[1]));

  // 2. Sección de números: todo lo que está ANTES del primer nombre con ordinal
  const listStart = ordMatches.length > 0
    ? Math.min(...ordMatches.map((m) => m.index!))
    : raw.length;
  const numSection = raw.slice(0, listStart);

  // 3. Extraer todos los "N (P%)" del bloque de números
  const numRx = /\b(\d+)\s*\(\d+(?:[,.]?\d*)?\s*%\)/g;
  const allNums = [...numSection.matchAll(numRx)].map((m) => parseInt(m[1]));

  const eventCount = ordMatches.length || 1;
  const numsPerEvent = allNums.length > 0 ? Math.round(allNums.length / eventCount) : 4;

  // 4. Construir funnel mapeando por posición ordinal
  const funnel: DayStage[] = ordMatches
    .map((m, idx) => {
      const name = m[2].toLowerCase();
      const def = STAGE_DEFS.find((d) => d.name === name);
      if (!def) return null;
      const events = allNums[idx * numsPerEvent] ?? 0;
      return { eventName: def.name, label: def.label, events };
    })
    .filter((s): s is DayStage => s !== null);

  // 5. Totales — formato A: "576 en comparación con 576"
  //             formato B: "570\n100 % respecto al total" (sin comparación)
  let totalEvents = 0, totalUsers = 0, eventsPerUser = 0;

  const compRx = /(\d[\d.]*)\s+en comparaci[oó]n con\s+(\d[\d.]*)/gi;
  const comps = [...raw.matchAll(compRx)];

  if (comps.length >= 2) {
    // Formato con comparación
    totalEvents = parseSpNum(comps[0][1]);
    totalUsers  = parseSpNum(comps[1][1]);
    eventsPerUser = comps[2] ? parseSpNum(comps[2][1]) : 0;
  } else {
    // Formato sin comparación: buscar número seguido de "100 % respecto al total"
    const respRx = /(\d[\d.,]*)\s+100\s*%\s*respecto al total/gi;
    const respMatches = [...raw.matchAll(respRx)];
    if (respMatches[0]) totalEvents = parseSpNum(respMatches[0][1]);
    if (respMatches[1]) totalUsers  = parseSpNum(respMatches[1][1]);
    // Eventos por usuario: número antes de "Media"
    const mediaRx = /(\d[\d.,]+)\s+Media\s/i;
    const mediaMatch = raw.match(mediaRx);
    if (mediaMatch) eventsPerUser = parseSpNum(mediaMatch[1]);
  }

  // 6. Fecha "2 mar 2026"
  const dateRx = /(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s+(\d{4})/gi;
  const dates = [...raw.matchAll(dateRx)];
  const d0 = dates[0];

  return {
    source: "Google Analytics – Cuponera Pepsi",
    periodLabel: d0 ? `${d0[1]} ${d0[2]} ${d0[3]}` : "",
    periodDate: d0
      ? `${d0[3]}-${MONTH_MAP[d0[2].toLowerCase()] ?? "01"}-${d0[1].padStart(2, "0")}`
      : new Date().toISOString().split("T")[0],
    totalEvents,
    totalUsers,
    eventsPerUser,
    funnel,
  };
}

// ─── GA4 Monthly CSV Parser ───────────────────────────────────────────────────
//
// Soporta el CSV que exporta GA4 en "Eventos" con "Fecha" como dimensión
// secundaria. Formato esperado:
//   Nombre del evento,Fecha,Recuento de eventos
//   page_view,20260301,1500
//   ...
// También soporta formato manual:
//   date,total_events,total_users,events_per_user,page_view,scroll,...
//
function parseGA4MonthCSV(text: string): Partial<DaySnapshot>[] {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) return [];

  const parseCols = (line: string) =>
    line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());

  const header = parseCols(lines[0]).map((h) => h.toLowerCase());

  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const isoFromRaw = (raw: string) => {
    if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return null;
  };
  const labelFromIso = (iso: string) => {
    const d = new Date(iso + "T12:00:00");
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  };

  // ── Format A: GA4 events-by-date export ──
  const eiName = header.findIndex((h) => h.includes("event") || h.includes("evento"));
  const eiDate = header.findIndex((h) => h === "fecha" || h === "date");
  const eiCount = header.findIndex((h) => h.includes("recuento") || h.includes("count") || h.includes("events"));

  if (eiName !== -1 && eiDate !== -1 && eiCount !== -1) {
    const byDate: Record<string, Record<string, number>> = {};
    for (const line of lines.slice(1)) {
      const cols = parseCols(line);
      const rawEvent = cols[eiName]?.toLowerCase() ?? "";
      const rawDate  = cols[eiDate] ?? "";
      const count    = parseInt(cols[eiCount]?.replace(/\D/g, "") ?? "0") || 0;
      const iso = isoFromRaw(rawDate);
      if (!iso || !rawEvent || rawEvent === "(not set)") continue;
      if (!byDate[iso]) byDate[iso] = {};
      byDate[iso][rawEvent] = (byDate[iso][rawEvent] ?? 0) + count;
    }

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([iso, events]) => {
        const totalEvents = Object.values(events).reduce((s, v) => s + v, 0);
        const totalUsers  = events["session_start"] ?? events["first_visit"] ?? 0;
        const eventsPerUser = totalUsers > 0 ? Math.round((totalEvents / totalUsers) * 100) / 100 : 0;
        const funnel = STAGE_DEFS
          .filter((d) => events[d.name] != null)
          .map((d) => ({ eventName: d.name, label: d.label, events: events[d.name] }));
        return { periodDate: iso, periodLabel: labelFromIso(iso), source: "Google Analytics – Cuponera Pepsi", totalEvents, totalUsers, eventsPerUser, funnel };
      });
  }

  // ── Format B: manual CSV with event columns in header ──
  // date,total_events,total_users,events_per_user,page_view,scroll,...
  const dateIdx = header.findIndex((h) => h === "date" || h === "fecha");
  if (dateIdx !== -1) {
    const eventCols = STAGE_DEFS.map((d) => ({
      def: d,
      idx: header.findIndex((h) => h === d.name),
    })).filter((c) => c.idx !== -1);

    const getNum = (cols: string[], key: string) =>
      parseFloat(cols[header.indexOf(key)]?.replace(",", ".") ?? "0") || 0;

    return lines.slice(1).map((line) => {
      const cols = parseCols(line);
      const iso  = isoFromRaw(cols[dateIdx]);
      if (!iso) return null;
      const totalEvents   = getNum(cols, "total_events");
      const totalUsers    = getNum(cols, "total_users");
      const eventsPerUser = getNum(cols, "events_per_user");
      const funnel = eventCols
        .map(({ def, idx }) => ({ eventName: def.name, label: def.label, events: parseInt(cols[idx]) || 0 }))
        .filter((s) => s.events > 0);
      const te = totalEvents || funnel.reduce((s, f) => s + f.events, 0);
      const tu = totalUsers  || funnel.find((f) => f.eventName === "session_start")?.events ?? 0;
      return { periodDate: iso, periodLabel: labelFromIso(iso), source: "Google Analytics – Cuponera Pepsi", totalEvents: te, totalUsers: tu, eventsPerUser, funnel };
    }).filter((s): s is Partial<DaySnapshot> => s !== null);
  }

  return [];
}

// ─── Monthly Upload Modal ─────────────────────────────────────────────────────

function MonthUploadModal({
  onClose,
  onBulkSave,
  snapshots,
}: {
  onClose: () => void;
  onBulkSave: (toInsert: DaySnapshot[], toUpdate: { id: string; snap: DaySnapshot }[]) => Promise<void>;
  snapshots: DaySnapshot[];
}) {
  const [step, setStep]       = useState<"upload" | "preview">("upload");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [parsed, setParsed]   = useState<Partial<DaySnapshot>[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const text = await file.text();
      const result = parseGA4MonthCSV(text);
      setParsed(result);
      setStep("preview");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const toInsert: DaySnapshot[] = [];
    const toUpdate: { id: string; snap: DaySnapshot }[] = [];

    for (const p of parsed) {
      if (!p.periodDate) continue;
      const existing = snapshots.find((s) => s.periodDate === p.periodDate);
      const snap: DaySnapshot = {
        id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        savedAt: new Date().toISOString(),
        source: p.source ?? "Google Analytics – Cuponera Pepsi",
        periodLabel: p.periodLabel ?? p.periodDate,
        periodDate: p.periodDate,
        totalEvents: p.totalEvents ?? 0,
        totalUsers: p.totalUsers ?? 0,
        eventsPerUser: p.eventsPerUser ?? 0,
        funnel: [...(p.funnel ?? [])],
      };
      // Preserve manually entered cupones_canjeados
      if (existing) {
        const manualVal = existing.funnel.find((f) => f.eventName === "cupones_canjeados")?.events ?? 0;
        const def = STAGE_DEFS.find((d) => d.name === "cupones_canjeados")!;
        const idx = snap.funnel.findIndex((f) => f.eventName === "cupones_canjeados");
        if (manualVal > 0) {
          if (idx !== -1) snap.funnel[idx].events = manualVal;
          else snap.funnel.push({ eventName: "cupones_canjeados", label: def.label, events: manualVal });
        }
        toUpdate.push({ id: existing.id, snap });
      } else {
        toInsert.push(snap);
      }
    }

    await onBulkSave(toInsert, toUpdate);
    setSaving(false);
    onClose();
  };

  const newCount      = parsed.filter((p) => !snapshots.find((s) => s.periodDate === p.periodDate)).length;
  const updateCount   = parsed.length - newCount;

  const downloadTemplate = () => {
    const header = ["date","total_events","total_users","events_per_user",...STAGE_DEFS.map((d) => d.name)].join(",");
    const example = ["2026-03-01","1500","450","3.33",...STAGE_DEFS.map(() => "0")].join(",");
    const csv = header + "\n" + example;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plantilla-mes.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === "upload" ? "Cargar mes completo" : `Vista previa · ${parsed.length} día${parsed.length !== 1 ? "s" : ""} detectado${parsed.length !== 1 ? "s" : ""}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {step === "upload" && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 flex flex-col items-center gap-4 cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              >
                {loading ? (
                  <>
                    <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-gray-600">Procesando CSV...</p>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 bg-purple-100 rounded-full flex items-center justify-center">
                      <svg className="w-7 h-7 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-gray-900">Arrastrá el CSV de Google Analytics</p>
                      <p className="text-sm text-gray-500 mt-1">Reporte de "Eventos" con "Fecha" como dimensión secundaria</p>
                    </div>
                    <button className="mt-1 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700">
                      Seleccionar archivo
                    </button>
                  </>
                )}
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
              <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-1">
                <p className="font-medium text-gray-700">Cómo exportar desde GA4:</p>
                <p>1. Reportes → Engagement → Eventos</p>
                <p>2. Agregar dimensión secundaria: <strong>Fecha</strong></p>
                <p>3. Seleccionar el mes completo como rango de fechas</p>
                <p>4. Exportar → Descargar CSV</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={downloadTemplate} className="text-xs text-purple-600 hover:underline flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Descargar plantilla CSV manual
                </button>
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              {parsed.length === 0 ? (
                <div className="text-center py-10 text-gray-500 text-sm">
                  No se detectaron datos válidos en el archivo. Verificá el formato del CSV.
                </div>
              ) : (
                <>
                  <div className="flex gap-3">
                    {newCount > 0 && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        {newCount} días nuevos
                      </span>
                    )}
                    {updateCount > 0 && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {updateCount} días a actualizar
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-gray-500">Fecha</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-500">Eventos</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-500">Usuarios</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-500">Cupones gen.</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-500">Page views</th>
                          <th className="text-center px-3 py-2 font-semibold text-gray-500">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {parsed.map((p) => {
                          const isNew = !snapshots.find((s) => s.periodDate === p.periodDate);
                          const cupones = p.funnel?.find((f) => f.eventName === "cupon_generado")?.events ?? 0;
                          const pv      = p.funnel?.find((f) => f.eventName === "page_view")?.events ?? 0;
                          return (
                            <tr key={p.periodDate} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-medium text-gray-800">{p.periodLabel ?? p.periodDate}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{(p.totalEvents ?? 0).toLocaleString("es-ES")}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-500">{(p.totalUsers ?? 0).toLocaleString("es-ES")}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-purple-600 font-semibold">{cupones.toLocaleString("es-ES")}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-500">{pv.toLocaleString("es-ES")}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${isNew ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                                  {isNew ? "Nuevo" : "Actualizar"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
          {step === "preview" ? (
            <>
              <button onClick={() => setStep("upload")} className="text-sm text-gray-500 hover:text-gray-700">
                ← Cargar otro archivo
              </button>
              <div className="flex gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || parsed.length === 0}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${parsed.length > 0 && !saving ? "bg-purple-600 text-white hover:bg-purple-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
                >
                  {saving ? "Guardando..." : `Guardar ${parsed.length} día${parsed.length !== 1 ? "s" : ""}`}
                </button>
              </div>
            </>
          ) : (
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Auto-insights ────────────────────────────────────────────────────────────

interface Insight {
  title: string;
  body: string;
  detail?: string;
}

function getInsights(current: DaySnapshot, previous: DaySnapshot | null): Insight[] {
  if (!previous) {
    return [{
      title: "Sin comparativa disponible",
      body: "Cargá el reporte del día anterior para ver insights automáticos comparativos.",
    }];
  }

  const ins: Insight[] = [];
  const evtCh = calcPct(current.totalEvents, previous.totalEvents);
  const currCpn = current.funnel.find((f) => f.eventName === "cupon_generado")?.events ?? 0;
  const prevCpn = previous.funnel.find((f) => f.eventName === "cupon_generado")?.events ?? 0;
  const evtPerUserCh = calcPct(current.eventsPerUser, previous.eventsPerUser);
  const pv = current.funnel.find((f) => f.eventName === "page_view");

  // 1. Tráfico
  if (Math.abs(evtCh) > 10) {
    ins.push({
      title: evtCh < 0 ? "Caída de tráfico" : "Crecimiento de tráfico",
      body: `La principal causa de la ${evtCh < 0 ? "reducción" : "mejora"} en cupones generados es la ${evtCh < 0 ? "disminución" : "mejora"} del tráfico al sitio (${fmtPct(evtCh)}), lo que sugiere ${evtCh < 0 ? "menor exposición de la campaña o menor activación en canales." : "mayor exposición de la campaña o activación de canales."}`,
    });
  }

  // 2. Engagement por usuario
  ins.push({
    title: Math.abs(evtPerUserCh) < 10 ? "Engagement estable" : evtPerUserCh < 0 ? "Caída en engagement" : "Mejora en engagement",
    body: `El comportamiento por usuario se mantiene ${Math.abs(evtPerUserCh) < 10 ? "relativamente estable" : evtPerUserCh < 0 ? "a la baja" : "en alza"} respecto al día anterior.`,
    detail: `Eventos por usuario: ${previous.eventsPerUser.toFixed(2)} → ${current.eventsPerUser.toFixed(2)}. ${Math.abs(evtPerUserCh) < 10 ? "Esto indica que la experiencia del sitio no presenta problemas críticos de interacción." : ""}`,
  });

  // 3. Conversión
  if (pv && pv.events > 0 && currCpn > 0) {
    const conv = ((currCpn / pv.events) * 100).toFixed(1);
    const prevConv = previous.funnel.find(f => f.eventName === "page_view")?.events
      ? ((prevCpn / previous.funnel.find(f => f.eventName === "page_view")!.events) * 100).toFixed(1)
      : null;
    ins.push({
      title: parseFloat(conv) < 2
        ? "Conversión dentro de rangos esperados"
        : "Conversión por encima del promedio",
      body: `La tasa de generación de cupones (~${conv}%) es ${parseFloat(conv) < 3 ? "consistente con benchmarks de campañas promocionales digitales." : "superior al promedio esperado para campañas promocionales."}`,
      detail: prevConv ? `Conversión anterior: ${prevConv}% → actual: ${conv}%.` : undefined,
    });
  }

  // 4. Scroll / interacción
  const scroll = current.funnel.find((f) => f.eventName === "scroll");
  if (scroll && pv && pv.events > 0) {
    const sc = ((scroll.events / pv.events) * 100).toFixed(0);
    if (parseInt(sc) < 40) {
      ins.push({
        title: "Baja interacción post-visita",
        body: `Solo el ${sc}% de los visitantes hace scroll, lo que sugiere contenido poco atractivo o posible problema de carga.`,
      });
    }
  }

  return ins;
}

// ─── Trend Chart ──────────────────────────────────────────────────────────────

function SparkLine({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const W = 600;
  const H = 72;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * W,
    H - ((v - min) / range) * (H - 20) - 10,
  ]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const fill = `${d} L ${pts[pts.length - 1][0]} ${H} L ${pts[0][0]} ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" style={{ height: H }}>
      <path d={fill} fill="#7c3aed" fillOpacity={0.07} />
      <path d={d} stroke="#7c3aed" strokeWidth={2} fill="none" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={4} fill="white" stroke="#7c3aed" strokeWidth={2} />
      ))}
    </svg>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

type FormState = {
  source: string;
  periodLabel: string;
  periodDate: string;
  totalEvents: string;
  totalUsers: string;
  eventsPerUser: string;
  stages: { eventName: string; label: string; events: string }[];
};

function emptyForm(): FormState {
  return {
    source: "Google Analytics – Cuponera Pepsi",
    periodLabel: "",
    periodDate: new Date().toISOString().split("T")[0],
    totalEvents: "",
    totalUsers: "",
    eventsPerUser: "",
    stages: STAGE_DEFS.map((d) => ({ eventName: d.name, label: d.label, events: "" })),
  };
}

function parsedToForm(parsed: Partial<DaySnapshot>): FormState {
  const f = emptyForm();
  if (parsed.source) f.source = parsed.source;
  if (parsed.periodLabel) f.periodLabel = parsed.periodLabel;
  if (parsed.periodDate) f.periodDate = parsed.periodDate;
  if (parsed.totalEvents) f.totalEvents = String(parsed.totalEvents);
  if (parsed.totalUsers) f.totalUsers = String(parsed.totalUsers);
  if (parsed.eventsPerUser) f.eventsPerUser = String(parsed.eventsPerUser);
  if (parsed.funnel?.length) {
    f.stages = STAGE_DEFS.map((def) => {
      const found = parsed.funnel!.find((s) => s.eventName === def.name);
      return { eventName: def.name, label: def.label, events: found ? String(found.events) : "" };
    });
  }
  return f;
}

function formToSnapshot(f: FormState): DaySnapshot {
  return {
    id: Date.now().toString(),
    savedAt: new Date().toISOString(),
    source: f.source,
    periodLabel: f.periodLabel,
    periodDate: f.periodDate,
    totalEvents: parseFloat(f.totalEvents) || 0,
    totalUsers: parseFloat(f.totalUsers) || 0,
    eventsPerUser: parseFloat(f.eventsPerUser) || 0,
    funnel: f.stages
      .filter((s) => s.events !== "")
      .map((s) => ({ eventName: s.eventName, label: s.label, events: parseFloat(s.events) || 0 })),
  };
}

function UploadModal({
  onClose,
  onSave,
  onUpdate,
  snapshots,
  existingDates,
  latestDate,
}: {
  onClose: () => void;
  onSave: (s: DaySnapshot) => void;
  onUpdate: (existingId: string, s: DaySnapshot) => Promise<void>;
  snapshots: DaySnapshot[];
  existingDates: string[];
  latestDate: string | null;
}) {
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [updateMode, setUpdateMode] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isDuplicate = existingDates.includes(form.periodDate);
  const existingSnap = snapshots.find((s) => s.periodDate === form.periodDate) ?? null;
  const daysFromLatest = latestDate ? daysBetween(latestDate, form.periodDate) : null;
  const isGap = daysFromLatest !== null && Math.abs(daysFromLatest) !== 1;
  const canSave = (!isDuplicate || updateMode) && form.periodLabel !== "";

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const text = await extractPDFText(file);
      setRawText(text);
      const parsed = parseGA4SingleDay(text);
      const f = parsedToForm(parsed);
      // Preserve manual fields from existing snapshot
      const existing = snapshots.find((s) => s.periodDate === f.periodDate);
      if (existing) {
        setUpdateMode(true);
        for (const manualEvent of ["cupones_canjeados"]) {
          const existingVal = existing.funnel.find((ev) => ev.eventName === manualEvent)?.events ?? 0;
          const idx = f.stages.findIndex((s) => s.eventName === manualEvent);
          if (idx !== -1) f.stages[idx] = { ...f.stages[idx], events: String(existingVal || "") };
        }
      } else {
        setUpdateMode(false);
      }
      setForm(f);
    } catch {
      setForm(emptyForm());
      setUpdateMode(false);
    } finally {
      setLoading(false);
      setStep("review");
    }
  };

  const inputCls =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500";
  const labelCls = "text-xs font-medium text-gray-500 mb-1 block";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === "upload" ? "Cargar reporte diario" : "Revisar datos del día"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {step === "upload" && (
            <div
              className="border-2 border-dashed border-gray-300 rounded-xl p-12 flex flex-col items-center gap-4 cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              {loading ? (
                <>
                  <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-gray-600">Procesando PDF...</p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 bg-purple-100 rounded-full flex items-center justify-center">
                    <svg className="w-7 h-7 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-gray-900">Arrastrá el PDF de Google Analytics</p>
                    <p className="text-sm text-gray-500 mt-1">Reporte diario "Eventos: Nombre del evento"</p>
                    {latestDate && (
                      <p className="text-xs text-purple-600 mt-2 font-medium">
                        Último cargado: {latestDate} · La comparación se hará automáticamente
                      </p>
                    )}
                  </div>
                  <button className="mt-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700">
                    Seleccionar archivo
                  </button>
                </>
              )}
              <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          )}

          {step === "review" && (
            <div className="space-y-5">
              {/* Raw text toggle */}
              {rawText && (
                <div>
                  <button
                    onClick={() => setShowRaw(!showRaw)}
                    className="text-xs text-purple-600 hover:underline flex items-center gap-1"
                  >
                    {showRaw ? "Ocultar" : "Ver"} texto extraído del PDF
                    <svg className={`w-3 h-3 transition-transform ${showRaw ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showRaw && (
                    <pre className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 overflow-auto max-h-36 whitespace-pre-wrap border">
                      {rawText.slice(0, 2000)}{rawText.length > 2000 ? "\n[...]" : ""}
                    </pre>
                  )}
                </div>
              )}

              {/* Validation */}
              {isDuplicate && !updateMode && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm text-amber-700">
                      Ya existe un reporte para <strong>{form.periodLabel || form.periodDate}</strong>.
                    </p>
                    <button
                      onClick={() => setUpdateMode(true)}
                      className="mt-1.5 text-xs font-medium text-amber-700 underline hover:text-amber-900"
                    >
                      Actualizar reporte existente con estos datos →
                    </button>
                  </div>
                </div>
              )}
              {isDuplicate && updateMode && (
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                  <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-blue-700">
                    Modo actualización — se sobreescribirá el reporte de <strong>{form.periodLabel || form.periodDate}</strong>.
                  </p>
                </div>
              )}

              {!isDuplicate && isGap && latestDate && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-amber-700">
                    Este reporte no es consecutivo con el último cargado ({latestDate}). El histórico tendrá un salto.
                  </p>
                </div>
              )}

              {!isDuplicate && !isGap && latestDate && (
                <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-green-700">
                    Perfecto. Se comparará automáticamente con <strong>{latestDate}</strong>.
                  </p>
                </div>
              )}

              {/* Metadata */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Información del reporte</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={labelCls}>Fuente</label>
                    <input className={inputCls} value={form.source}
                      onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Fecha del reporte</label>
                    <input className={inputCls} value={form.periodLabel} placeholder="ej: 4 mar 2026"
                      onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Fecha (para histórico)</label>
                    <input
                      type="date"
                      className={`${inputCls} ${isDuplicate ? "border-red-400 ring-1 ring-red-300" : ""}`}
                      value={form.periodDate}
                      onChange={(e) => setForm((f) => ({ ...f, periodDate: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* KPIs */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">KPIs del día</h3>
                <div className="space-y-2">
                  {([
                    ["totalEvents", "Eventos totales"],
                    ["totalUsers", "Usuarios"],
                    ["eventsPerUser", "Eventos por usuario"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-44 flex-shrink-0">{label}</label>
                      <input
                        className={inputCls}
                        placeholder="0"
                        value={(form as any)[key]}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Funnel — datos del PDF */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Funnel digital</h3>
                <div className="space-y-2">
                  {form.stages
                    .filter((s) => s.eventName !== "cupones_canjeados")
                    .map((stage) => {
                      const idx = form.stages.findIndex((s) => s.eventName === stage.eventName);
                      return (
                        <div key={stage.eventName} className="flex items-center gap-3">
                          <label className="text-sm text-gray-700 w-44 flex-shrink-0">{stage.label}</label>
                          <input
                            className={inputCls}
                            placeholder="0"
                            value={stage.events}
                            onChange={(e) => {
                              const stages = [...form.stages];
                              stages[idx] = { ...stages[idx], events: e.target.value };
                              setForm((f) => ({ ...f, stages }));
                            }}
                          />
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Datos manuales */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Datos manuales</h3>
                  <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">Ingreso manual</span>
                </div>
                <div className="space-y-2">
                  {form.stages
                    .filter((s) => s.eventName === "cupones_canjeados")
                    .map((stage) => {
                      const idx = form.stages.findIndex((s) => s.eventName === stage.eventName);
                      return (
                        <div key={stage.eventName} className="flex items-center gap-3">
                          <label className="text-sm text-gray-700 w-44 flex-shrink-0">{stage.label}</label>
                          <input
                            className={inputCls}
                            placeholder="0"
                            value={stage.events}
                            onChange={(e) => {
                              const stages = [...form.stages];
                              stages[idx] = { ...stages[idx], events: e.target.value };
                              setForm((f) => ({ ...f, stages }));
                            }}
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
          {step === "review" ? (
            <>
              <button onClick={() => setStep("upload")} className="text-sm text-gray-500 hover:text-gray-700">
                ← Cargar otro PDF
              </button>
              <div className="flex gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    if (!canSave) return;
                    if (updateMode && existingSnap) {
                      onUpdate(existingSnap.id, formToSnapshot(form)).then(onClose);
                    } else {
                      onSave(formToSnapshot(form));
                    }
                  }}
                  disabled={!canSave}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${
                    canSave
                      ? "bg-purple-600 text-white hover:bg-purple-700"
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  {updateMode ? "Actualizar reporte" : "Guardar reporte"}
                </button>
              </div>
            </>
          ) : (
            <>
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
              <button
                onClick={() => setStep("review")}
                className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Ingresar datos manualmente
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ current, previous }: { current: DaySnapshot; previous: DaySnapshot | null }) {
  const getP = (name: string) => previous?.funnel.find((f) => f.eventName === name)?.events ?? null;
  const pv = current.funnel.find((f) => f.eventName === "page_view");
  const insights = getInsights(current, previous);
  const evtCh = previous ? calcPct(current.totalEvents, previous.totalEvents) : null;

  const kpiRows = [
    { label: "Eventos totales", curr: current.totalEvents, prev: previous?.totalEvents ?? null },
    { label: "Usuarios", curr: current.totalUsers, prev: previous?.totalUsers ?? null },
    { label: "Eventos por usuario", curr: current.eventsPerUser, prev: previous?.eventsPerUser ?? null, decimal: true },
    {
      label: "Cupones generados",
      curr: current.funnel.find((f) => f.eventName === "cupon_generado")?.events ?? 0,
      prev: getP("cupon_generado"),
    },
    {
      label: "Cupones canjeados",
      curr: current.funnel.find((f) => f.eventName === "cupones_canjeados")?.events ?? 0,
      prev: getP("cupones_canjeados"),
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-3xl space-y-8">

      {/* Header */}
      <div className="text-sm text-gray-600 space-y-1 pb-5 border-b border-gray-100">
        <p><span className="font-semibold text-gray-800">Periodo analizado:</span> {current.periodLabel}</p>
        {previous
          ? <p><span className="font-semibold text-gray-800">Comparación:</span> vs {previous.periodLabel}</p>
          : <p className="text-amber-600">Sin período anterior — cargá el día anterior para ver comparativas.</p>
        }
        <p><span className="font-semibold text-gray-800">Fuente de datos:</span> {current.source}</p>
      </div>

      {/* KPIs Principales */}
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-4">KPIs Principales</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Métrica</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">{current.periodLabel || "Actual"}</th>
                {previous && <th className="text-right px-4 py-3 font-semibold text-gray-600">{previous.periodLabel}</th>}
                {previous && <th className="text-right px-4 py-3 font-semibold text-gray-600">Variación</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {kpiRows.map(({ label, curr, prev, decimal }) => {
                const ch = prev !== null ? calcPct(curr, prev) : null;
                return (
                  <tr key={label} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-gray-700 font-medium">{label}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                      {decimal ? curr.toFixed(2) : curr.toLocaleString("es-ES")}
                    </td>
                    {previous && (
                      <td className="px-4 py-3 text-right text-gray-500 tabular-nums">
                        {prev !== null ? (decimal ? prev.toFixed(2) : prev.toLocaleString("es-ES")) : "—"}
                      </td>
                    )}
                    {previous && (
                      <td className="px-4 py-3 text-right">
                        {ch !== null ? (
                          <span className={`font-semibold ${ch < 0 ? "text-red-600" : "text-green-600"}`}>
                            {fmtPct(ch)}
                          </span>
                        ) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Observación */}
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-2">Observación</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          {evtCh !== null && Math.abs(evtCh) > 10 ? (
            <>
              Se observa una{" "}
              <strong className={evtCh < 0 ? "text-red-700" : "text-green-700"}>
                {evtCh < 0 ? "caída significativa" : "mejora significativa"} del tráfico y actividad general
              </strong>
              , lo que impacta directamente en la generación de cupones.
            </>
          ) : evtCh !== null ? (
            "El tráfico y la actividad general se mantienen estables respecto al día anterior."
          ) : (
            "Sin período anterior para comparar. Cargá el reporte del día anterior para ver análisis comparativo."
          )}
        </p>
      </div>

      {/* Funnel Digital */}
      {current.funnel.length > 0 && (
        <div>
          <h2 className="text-base font-bold text-gray-900 mb-4">Funnel Digital</h2>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Etapa</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Eventos</th>
                  {previous && <th className="text-right px-4 py-3 font-semibold text-gray-600">Anterior</th>}
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Conversión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {current.funnel.map((stage, idx) => {
                  const prevEvts = getP(stage.eventName);
                  const convRate = idx === 0 || !pv ? null : Math.round((stage.events / pv.events) * 1000) / 10;
                  const evtCh2 = prevEvts !== null ? calcPct(stage.events, prevEvts) : null;
                  return (
                    <tr key={stage.eventName} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-gray-700">{stage.label}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-semibold text-gray-900">{stage.events.toLocaleString("es-ES")}</span>
                        {evtCh2 !== null && (
                          <span className={`ml-2 text-xs font-medium ${evtCh2 < 0 ? "text-red-500" : "text-green-600"}`}>
                            {fmtPct(evtCh2)}
                          </span>
                        )}
                      </td>
                      {previous && (
                        <td className="px-4 py-3 text-right text-gray-400 tabular-nums">
                          {prevEvts !== null ? prevEvts.toLocaleString("es-ES") : "—"}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-semibold">
                        {convRate === null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className={convRate < 10 ? "text-orange-600" : "text-green-600"}>
                            {convRate}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Conversión final */}
          {pv && current.funnel.find((f) => f.eventName === "cupon_generado") && (
            <div className="mt-5">
              <p className="text-sm font-semibold text-gray-700">Conversión final</p>
              <p className="text-base font-bold text-purple-700 mt-1">
                {((current.funnel.find((f) => f.eventName === "cupon_generado")!.events / pv.events) * 100).toFixed(1)}% de visitas generan un cupón
              </p>
              {previous && (() => {
                const prevPv = getP("page_view");
                const prevCpn = getP("cupon_generado");
                if (prevPv && prevCpn && prevPv > 0) {
                  return (
                    <p className="text-sm text-gray-400 mt-0.5">
                      vs {((prevCpn / prevPv) * 100).toFixed(1)}% el día anterior
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>
      )}

      {/* Insights clave */}
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-4">Insights clave</h2>
        <div className="space-y-5">
          {insights.map((insight, i) => (
            <div key={i}>
              <p className="text-sm font-bold text-gray-900 mb-1">{i + 1}. {insight.title}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{insight.body}</p>
              {insight.detail && (
                <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{insight.detail}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Historical ───────────────────────────────────────────────────────────────

type Period = "dia" | "semana" | "mes" | "año";

function Historical({
  snapshots,
  period,
  setPeriod,
  onSelect,
  onDelete,
  selectedId,
}: {
  snapshots: DaySnapshot[];
  period: Period;
  setPeriod: (p: Period) => void;
  onSelect: (s: DaySnapshot) => void;
  onDelete: (id: string) => void;
  selectedId: string | null;
}) {
  const sorted = [...snapshots].sort((a, b) => b.periodDate.localeCompare(a.periodDate));
  const now = new Date();
  const diffDays = (iso: string) =>
    (now.getTime() - new Date(iso + "T12:00:00").getTime()) / 86400000;

  const filtered = sorted.filter((s) => {
    const d = diffDays(s.periodDate);
    if (period === "dia") return d < 1;
    if (period === "semana") return d < 7;
    if (period === "mes") return d < 30;
    return true;
  });

  const chronological = [...sorted].reverse();
  const couponsData = chronological.map((s) => ({
    label: s.periodLabel,
    val: s.funnel.find((f) => f.eventName === "cupon_generado")?.events ?? 0,
  }));

  const periodLabels: Record<Period, string> = {
    dia: "Hoy", semana: "Últimos 7 días", mes: "Últimos 30 días", año: "Todo el tiempo",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-sm text-gray-500">Ver:</span>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(["dia", "semana", "mes", "año"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                period === p ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {p === "dia" ? "Día" : p === "año" ? "Año" : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400">
          {periodLabels[period]} · {filtered.length} reporte{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Trend chart */}
      {couponsData.length >= 2 && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-sm font-semibold text-gray-900 mb-1">Cupones generados — tendencia diaria</p>
          <p className="text-xs text-gray-400 mb-4">Evolución histórica de todos los reportes cargados</p>
          <SparkLine data={couponsData.map((d) => d.val)} />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">{couponsData[0]?.label}</span>
            <span className="text-xs text-gray-400">{couponsData[couponsData.length - 1]?.label}</span>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No hay reportes en este período.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((snap, idx) => {
            const prevSnap = sorted[idx + 1] ?? null;
            const coupons = snap.funnel.find((f) => f.eventName === "cupon_generado")?.events ?? 0;
            const prevCoupons = prevSnap?.funnel.find((f) => f.eventName === "cupon_generado")?.events ?? null;
            const evtCh = prevSnap ? calcPct(snap.totalEvents, prevSnap.totalEvents) : null;
            const cpnCh = prevCoupons !== null ? calcPct(coupons, prevCoupons) : null;
            const isSelected = selectedId === snap.id;
            return (
              <div
                key={snap.id}
                className={`bg-white rounded-xl border px-5 py-4 transition-all ${
                  isSelected ? "border-purple-400 ring-1 ring-purple-300" : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-semibold text-gray-900">{snap.periodLabel}</p>
                    {prevSnap && (
                      <p className="text-xs text-gray-400 mt-0.5">comparado con {prevSnap.periodLabel}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">{snap.source}</p>
                  </div>
                  <div className="flex items-center gap-5 flex-wrap">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Eventos</p>
                      <p className="text-sm font-bold text-gray-900">{snap.totalEvents.toLocaleString("es-ES")}</p>
                      {evtCh !== null && (
                        <p className={`text-xs font-medium ${evtCh < 0 ? "text-red-500" : "text-green-600"}`}>
                          {fmtPct(evtCh)}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Usuarios</p>
                      <p className="text-sm font-bold text-gray-900">{snap.totalUsers}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Cupones</p>
                      <p className="text-sm font-bold text-gray-900">{coupons}</p>
                      {cpnCh !== null && (
                        <p className={`text-xs font-medium ${cpnCh < 0 ? "text-red-500" : "text-green-600"}`}>
                          {fmtPct(cpnCh)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSelect(snap)}
                        className="px-3 py-1.5 text-xs font-medium bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100"
                      >
                        Ver detalle
                      </button>
                      <button
                        onClick={() => onDelete(snap.id)}
                        className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
                        title="Eliminar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tendencias (Events Over Time) ───────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  total:              "#4285f4",
  page_view:          "#1a73e8",
  scroll:           "#34a853",
  session_start:    "#fbbc04",
  first_visit:        "#3c4043",
  user_engagement:    "#ea4335",
  cupon_generado:     "#7c3aed",
  registro_usuario:   "#0f9d58",
  cupones_canjeados:  "#f4511e",
};

const MONTH_NAMES: Record<string, string> = {
  "01": "Enero", "02": "Febrero", "03": "Marzo", "04": "Abril",
  "05": "Mayo", "06": "Junio", "07": "Julio", "08": "Agosto",
  "09": "Septiembre", "10": "Octubre", "11": "Noviembre", "12": "Diciembre",
};

function EventsChart({ snapshots }: { snapshots: DaySnapshot[] }) {
  const allSorted = [...snapshots].sort((a, b) => a.periodDate.localeCompare(b.periodDate));

  // Meses disponibles a partir de los datos (ej: "2026-03")
  const availableMonths = Array.from(
    new Set(allSorted.map((s) => s.periodDate.slice(0, 7)))
  ).sort();

  const latestMonth = availableMonths[availableMonths.length - 1] ?? "";
  const [selectedMonth, setSelectedMonth] = useState<string>(latestMonth);

  // Sincronizar si llegan nuevos datos
  const effectiveMonth = availableMonths.includes(selectedMonth) ? selectedMonth : latestMonth;

  const sorted = effectiveMonth
    ? allSorted.filter((s) => s.periodDate.startsWith(effectiveMonth))
    : allSorted;

  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(["total", ...STAGE_DEFS.map((d) => d.name)])
  );
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const seriesList = [
    { key: "total", label: "Total", values: sorted.map((s) => s.totalEvents) },
    ...STAGE_DEFS.map((def) => ({
      key: def.name,
      label: def.name,
      values: sorted.map((s) => s.funnel.find((f) => f.eventName === def.name)?.events ?? 0),
    })),
  ];

  const visibleSeries = seriesList.filter((s) => visible.has(s.key));

  const W = 900, H = 280, PL = 64, PR = 24, PT = 16, PB = 40;
  const cW = W - PL - PR;
  const cH = H - PT - PB;

  const allVals = visibleSeries.flatMap((s) => s.values);
  const rawMax = allVals.length > 0 ? Math.max(...allVals) : 1000;
  const step = Math.ceil(rawMax / 5 / 100) * 100 || 200;
  const yMax = step * 5;
  const yTicks = [0, 1, 2, 3, 4, 5].map((i) => i * step);

  const xOf = (i: number) =>
    PL + (sorted.length > 1 ? (i / (sorted.length - 1)) * cW : cW / 2);
  const yOf = (v: number) => PT + cH - (v / yMax) * cH;
  const pathFor = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");

  const xStep = Math.max(1, Math.ceil(sorted.length / 8));

  const toggle = (key: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const fmtTick = (v: number) =>
    v >= 1000 ? `${(v / 1000).toFixed(v % 500 === 0 ? 0 : 1)} mil` : String(v);

  // tooltip x position as percentage of SVG width
  const tooltipLeft = hoverIdx !== null
    ? Math.min(((xOf(hoverIdx) + 10) / W) * 100, 58)
    : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Número de eventos por Nombre del evento a lo largo del tiempo
        </h2>
        <select
          value={effectiveMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
        >
          {availableMonths.map((m) => {
            const [year, mon] = m.split("-");
            return (
              <option key={m} value={m}>
                {MONTH_NAMES[mon] ?? m} {year}
              </option>
            );
          })}
        </select>
      </div>

      {sorted.length < 2 ? (
        <p className="text-sm text-gray-400 py-8 text-center">Cargá al menos 2 días para ver la tendencia.</p>
      ) : (
        <div
          className="relative select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full overflow-visible"
            style={{ height: H }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * W - PL;
              const idx = Math.round((x / cW) * (sorted.length - 1));
              setHoverIdx(Math.max(0, Math.min(sorted.length - 1, idx)));
            }}
          >
            {/* Horizontal grid + Y labels */}
            {yTicks.map((tick) => (
              <g key={tick}>
                <line x1={PL} y1={yOf(tick)} x2={W - PR} y2={yOf(tick)} stroke="#e5e7eb" strokeWidth={1} />
                <text x={PL - 6} y={yOf(tick) + 4} textAnchor="end" fontSize={11} fill="#9ca3af">
                  {fmtTick(tick)}
                </text>
              </g>
            ))}

            {/* X labels */}
            {sorted.map((s, i) => {
              if (i % xStep !== 0 && i !== sorted.length - 1) return null;
              const parts = s.periodLabel.split(" ");
              return (
                <text key={s.id} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="#9ca3af">
                  {parts[0]} {parts[1]}
                </text>
              );
            })}

            {/* Series lines */}
            {visibleSeries.map((series) => (
              <path
                key={series.key}
                d={pathFor(series.values)}
                stroke={EVENT_COLORS[series.key] ?? "#aaa"}
                strokeWidth={series.key === "total" ? 2.5 : 1.5}
                strokeDasharray={series.key === "total" ? "7 4" : undefined}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* Hover vertical line + dots */}
            {hoverIdx !== null && (
              <>
                <line
                  x1={xOf(hoverIdx)} y1={PT} x2={xOf(hoverIdx)} y2={PT + cH}
                  stroke="#d1d5db" strokeWidth={1} strokeDasharray="4 3"
                />
                {visibleSeries.map((series) => (
                  <circle
                    key={series.key}
                    cx={xOf(hoverIdx)}
                    cy={yOf(series.values[hoverIdx] ?? 0)}
                    r={4}
                    fill="white"
                    stroke={EVENT_COLORS[series.key] ?? "#aaa"}
                    strokeWidth={2}
                  />
                ))}
              </>
            )}
          </svg>

          {/* Tooltip */}
          {hoverIdx !== null && (
            <div
              className="absolute top-2 bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs z-10 pointer-events-none"
              style={{ left: `${tooltipLeft}%`, minWidth: 180 }}
            >
              <p className="font-semibold text-gray-800 mb-1.5 pb-1.5 border-b border-gray-100">
                {sorted[hoverIdx]?.periodLabel}
              </p>
              {visibleSeries.map((series) => (
                <div key={series.key} className="flex items-center justify-between gap-3 py-0.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: EVENT_COLORS[series.key] ?? "#aaa" }}
                    />
                    <span className="text-gray-600">
                      {series.key === "total" ? "Total" : series.key}
                    </span>
                  </div>
                  <span className="font-bold text-gray-900 tabular-nums">
                    {(series.values[hoverIdx] ?? 0).toLocaleString("es-ES")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center flex-wrap gap-x-5 gap-y-2 pt-2 border-t border-gray-100">
        {seriesList.map((series) => (
          <label key={series.key} className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={visible.has(series.key)}
              onChange={() => toggle(series.key)}
              style={{ accentColor: EVENT_COLORS[series.key] ?? "#7c3aed" }}
              className="w-3.5 h-3.5"
            />
            <span className="text-xs text-gray-600">
              {series.key === "total" ? "Total" : series.key}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

const MANUAL_EVENTS = new Set(["registro_usuario", "cupones_canjeados"]);

function ManualEditModal({
  eventName,
  snapshots,
  onUpdate,
  onClose,
}: {
  eventName: string;
  snapshots: DaySnapshot[];
  onUpdate: (snapshotId: string, eventName: string, value: number) => Promise<void>;
  onClose: () => void;
}) {
  const def = STAGE_DEFS.find((d) => d.name === eventName)!;
  const sorted = [...snapshots].sort((a, b) => a.periodDate.localeCompare(b.periodDate));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      sorted.map((s) => [
        s.id,
        String(s.funnel.find((f) => f.eventName === eventName)?.events ?? ""),
      ])
    )
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    for (const snap of sorted) {
      const val = parseInt(values[snap.id] || "0", 10) || 0;
      await onUpdate(snap.id, eventName, val);
    }
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{def.label}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Ingreso manual por fecha</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {sorted.map((snap) => (
            <div key={snap.id} className="flex items-center gap-3">
              <label className="text-sm text-gray-700 w-28 flex-shrink-0">{snap.periodLabel}</label>
              <input
                type="number"
                min="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="0"
                value={values[snap.id]}
                onChange={(e) => setValues((v) => ({ ...v, [snap.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventsTableGA4({
  snapshots,
  onUpdateManual,
  canEdit,
}: {
  snapshots: DaySnapshot[];
  onUpdateManual: (snapshotId: string, eventName: string, value: number) => Promise<void>;
  canEdit: boolean;
}) {
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  if (snapshots.length === 0) return null;

  // Agregar totales de TODOS los días cargados
  const totalEvts = snapshots.reduce((s, snap) => s + snap.totalEvents, 0);
  const totalUsers = snapshots.reduce((s, snap) => s + snap.totalUsers, 0);
  const evtPerUser = totalUsers > 0 ? totalEvts / totalUsers : 0;

  const rows = STAGE_DEFS.map((def) => {
    const evts = snapshots.reduce((s, snap) => {
      return s + (snap.funnel.find((f) => f.eventName === def.name)?.events ?? 0);
    }, 0);
    const pct = totalEvts > 0 ? ((evts / totalEvts) * 100).toFixed(2).replace(".", ",") : "0,00";
    return { name: def.name, evts, pct };
  })
    .sort((a, b) => b.evts - a.evts)
    .map((r, i) => ({ ...r, idx: i + 1 }));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-400 bg-white w-40">
            Incluir en gráfico
          </div>
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-400 bg-white">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Buscar...
          </div>
        </div>
        <span className="text-xs text-gray-400">
          Filas por página: 10 · 1–{rows.length + 1} de {rows.length + 1}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-6 py-3">
              <div className="flex items-center gap-2">
                <input type="checkbox" className="rounded w-3.5 h-3.5" defaultChecked readOnly />
                <span className="font-semibold text-gray-600 text-xs">Nombre del evento</span>
              </div>
            </th>
            <th className="text-right px-6 py-3">
              <div className="flex items-center justify-end gap-1 font-semibold text-gray-600 text-xs">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                Número de eventos
              </div>
            </th>
            <th className="text-right px-6 py-3 font-semibold text-gray-600 text-xs">Total de usuarios</th>
            <th className="text-right px-6 py-3 font-semibold text-gray-600 text-xs">Número de eventos por usuario activo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {/* Total row */}
          <tr className="bg-gray-50/60">
            <td className="px-6 py-3">
              <div className="flex items-center gap-2">
                <input type="checkbox" className="rounded w-3.5 h-3.5" defaultChecked readOnly />
                <span className="font-bold text-gray-900 text-sm">Total</span>
              </div>
            </td>
            <td className="px-6 py-3 text-right">
              <span className="font-bold text-gray-900">{totalEvts.toLocaleString("es-ES")}</span>
              <br />
              <span className="text-xs text-gray-400">100 % respecto al total</span>
            </td>
            <td className="px-6 py-3 text-right">
              <span className="font-bold text-gray-900">{totalUsers.toLocaleString("es-ES")}</span>
              <br />
              <span className="text-xs text-gray-400">100 % respecto al total</span>
            </td>
            <td className="px-6 py-3 text-right font-bold text-gray-900">
              {evtPerUser.toFixed(2)}
              <br />
              <span className="text-xs text-gray-400 font-normal">Media 0 %</span>
            </td>
          </tr>
          {rows.map((row) => (
            <tr key={row.name} className="hover:bg-gray-50/50">
              <td className="px-6 py-3">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded w-3.5 h-3.5" defaultChecked readOnly />
                  <span className="text-xs text-gray-400 w-4 text-right">{row.idx}</span>
                  <span
                    className="font-medium cursor-pointer hover:underline"
                    style={{ color: EVENT_COLORS[row.name] ?? "#1a73e8" }}
                  >
                    {row.name}
                  </span>
                  {MANUAL_EVENTS.has(row.name) && canEdit && (
                    <button
                      onClick={() => setEditingEvent(row.name)}
                      className="ml-1 text-gray-300 hover:text-purple-500 transition-colors"
                      title="Editar manualmente"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  )}
                </div>
              </td>
              <td className="px-6 py-3 text-right">
                <span className="text-gray-900">{row.evts.toLocaleString("es-ES")}</span>
                <span className="text-gray-400 ml-1.5 text-xs">({row.pct} %)</span>
              </td>
              <td className="px-6 py-3 text-right text-gray-400 text-xs">—</td>
              <td className="px-6 py-3 text-right text-gray-400 text-xs">—</td>
            </tr>
          ))}
        </tbody>
      </table>

      {editingEvent && (
        <ManualEditModal
          eventName={editingEvent}
          snapshots={snapshots}
          onUpdate={onUpdateManual}
          onClose={() => setEditingEvent(null)}
        />
      )}
    </div>
  );
}

function DashboardView({
  snapshots,
  onUpdateManual,
  canEdit,
}: {
  snapshots: DaySnapshot[];
  onUpdateManual: (snapshotId: string, eventName: string, value: number) => Promise<void>;
  canEdit: boolean;
}) {
  if (snapshots.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400 text-sm">
        Cargá al menos un reporte para ver el dashboard.
      </div>
    );
  }
  const sorted = [...snapshots].sort((a, b) => b.periodDate.localeCompare(a.periodDate));
  const current  = sorted[0];
  const previous = sorted[1] ?? null;
  return (
    <div className="space-y-5">
      <Dashboard current={current} previous={previous} />
      <EventsChart snapshots={snapshots} />
      <EventsTableGA4 snapshots={snapshots} onUpdateManual={onUpdateManual} canEdit={canEdit} />
    </div>
  );
}

function RendimientoView({
  snapshots,
  currentSnap,
  previousSnap,
  setSelectedId,
  comparisonId,
  setComparisonId,
}: {
  snapshots: DaySnapshot[];
  currentSnap: DaySnapshot | null;
  previousSnap: DaySnapshot | null;
  setSelectedId: (id: string | null) => void;
  comparisonId: string | "none" | null;
  setComparisonId: (id: string | "none" | null) => void;
}) {
  const sorted = [...snapshots].sort((a, b) => b.periodDate.localeCompare(a.periodDate));

  if (!currentSnap) {
    return (
      <div className="text-center py-20 text-gray-400 text-sm">
        Cargá al menos un reporte para ver el análisis de rendimiento.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Selectores de día y comparación */}
      <div className="flex items-center gap-4 flex-wrap bg-white border border-gray-200 rounded-xl px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 whitespace-nowrap">Día analizado:</span>
          <select
            value={currentSnap.id}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setComparisonId(null);
            }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
          >
            {sorted.map((s) => (
              <option key={s.id} value={s.id}>{s.periodLabel}</option>
            ))}
          </select>
        </div>

        {sorted.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 whitespace-nowrap">Comparar con:</span>
            <select
              value={comparisonId ?? "auto"}
              onChange={(e) => setComparisonId(e.target.value === "auto" ? null : e.target.value as string | "none")}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              <option value="auto">Día anterior (automático)</option>
              <option value="none">Sin comparación</option>
              {sorted
                .filter((s) => s.id !== currentSnap.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.periodLabel}</option>
                ))}
            </select>
          </div>
        )}
      </div>

      <Dashboard current={currentSnap} previous={previousSnap} />
    </div>
  );
}

// ─── Cupones View ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Activo:         "bg-green-100 text-green-700",
  "Por comenzar": "bg-blue-100 text-blue-700",
  Borrador:       "bg-yellow-100 text-yellow-700",
  Cancelado:      "bg-red-100 text-red-400",
  Finalizado:     "bg-gray-100 text-gray-600",
  Inactivo:       "bg-gray-100 text-gray-400",
};

const LATAM_CURRENCIES = [
  { code: "GTQ", label: "Quetzal (Guatemala)", symbol: "Q" },
  { code: "MXN", label: "Peso Mexicano (México)", symbol: "$" },
  { code: "COP", label: "Peso Colombiano (Colombia)", symbol: "$" },
  { code: "ARS", label: "Peso Argentino (Argentina)", symbol: "$" },
  { code: "CLP", label: "Peso Chileno (Chile)", symbol: "$" },
  { code: "PEN", label: "Sol (Perú)", symbol: "S/" },
  { code: "BRL", label: "Real (Brasil)", symbol: "R$" },
  { code: "HNL", label: "Lempira (Honduras)", symbol: "L" },
  { code: "NIO", label: "Córdoba (Nicaragua)", symbol: "C$" },
  { code: "CRC", label: "Colón (Costa Rica)", symbol: "₡" },
  { code: "DOP", label: "Peso Dominicano (Rep. Dom.)", symbol: "RD$" },
  { code: "BOB", label: "Boliviano (Bolivia)", symbol: "Bs." },
  { code: "PYG", label: "Guaraní (Paraguay)", symbol: "₲" },
  { code: "UYU", label: "Peso Uruguayo (Uruguay)", symbol: "$U" },
  { code: "PAB", label: "Balboa (Panamá)", symbol: "B/." },
  { code: "USD", label: "Dólar (EEUU)", symbol: "$" },
];

function getCurrencySymbol(code: string) {
  return LATAM_CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

const EMPTY_CAMPAIGN_FORM = {
  name: "", description: "", startDate: "", endDate: "",
  couponCount: "", couponsGenerated: "", couponsUsed: "0", status: "Borrador",
  campaignLink: "", pointsPerCoupon: "0", valuePerCoupon: "", currency: "",
};

function CuponesView() {
  const { campaigns, addCampaign, updateCampaign, deleteCampaign } = useCampaigns();
  const { isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("Todos");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; startDate: string; endDate: string;
    couponCount: string; couponsGenerated: string; couponsUsed: string; status: string; campaignLink: string;
    pointsPerCoupon: string; valuePerCoupon: string; currency: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<typeof EMPTY_CAMPAIGN_FORM>(EMPTY_CAMPAIGN_FORM);
  const [creating, setCreating] = useState(false);

  const openEdit = (c: (typeof campaigns)[0]) => {
    setEditForm({
      name: c.name,
      startDate: c.startDate,
      endDate: c.endDate,
      couponCount: String(c.couponCount),
      couponsGenerated: c.couponsGenerated != null ? String(c.couponsGenerated) : "",
      couponsUsed: String(c.couponsUsed),
      status: c.status,
      campaignLink: c.campaignLink,
      pointsPerCoupon: String(c.pointsPerCoupon),
      valuePerCoupon: c.valuePerCoupon != null ? String(c.valuePerCoupon) : "",
      currency: c.currency ?? "GTQ",
    });
    setEditingId(c.id);
  };

  const saveEdit = async () => {
    if (!editingId || !editForm) return;
    setSaving(true);
    await updateCampaign(editingId, {
      name: editForm.name,
      startDate: editForm.startDate,
      endDate: editForm.endDate,
      couponCount: parseInt(editForm.couponCount) || 0,
      couponsGenerated: editForm.couponsGenerated !== "" ? parseInt(editForm.couponsGenerated) : undefined,
      couponsUsed: parseInt(editForm.couponsUsed) || 0,
      pointsPerCoupon: parseInt(editForm.pointsPerCoupon) || 0,
      status: editForm.status as Campaign["status"],
      campaignLink: editForm.campaignLink,
      valuePerCoupon: editForm.valuePerCoupon !== "" ? parseFloat(editForm.valuePerCoupon) : undefined,
      currency: editForm.currency || undefined,
    });
    setSaving(false);
    setEditingId(null);
    setEditForm(null);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    await deleteCampaign(confirmDeleteId);
    setDeleting(false);
    setConfirmDeleteId(null);
    setEditingId(null);
    setEditForm(null);
  };

  const saveCreate = async () => {
    if (!createForm.name.trim() || !createForm.couponCount) return;
    setCreating(true);
    await addCampaign({
      name: createForm.name.trim(),
      description: createForm.description.trim(),
      startDate: createForm.startDate,
      endDate: createForm.endDate,
      couponCount: parseInt(createForm.couponCount) || 0,
      couponsGenerated: createForm.couponsGenerated !== "" ? parseInt(createForm.couponsGenerated) : undefined,
      pointsPerCoupon: parseInt(createForm.pointsPerCoupon) || 0,
      status: createForm.status as Campaign["status"],
      skuIds: [],
      tenderoTitle: "",
      tenderoDescription: "",
      valuePerCoupon: createForm.valuePerCoupon !== "" ? parseFloat(createForm.valuePerCoupon) : undefined,
      currency: createForm.currency || undefined,
    });
    setCreating(false);
    setShowCreate(false);
    setCreateForm(EMPTY_CAMPAIGN_FORM);
  };

  const statuses = ["Todos", "Activo", "Por comenzar", "Borrador", "Finalizado", "Cancelado", "Inactivo"];

  const filtered = campaigns.filter((c) => {
    const matchSearch =
      search === "" ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "Todos" || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Base for cards: filtered set (by status) but ignoring search text
  const cardBase = statusFilter === "Todos"
    ? campaigns
    : campaigns.filter((c) => c.status === statusFilter);

  const totalCoupons = cardBase.reduce((s, c) => s + c.couponCount, 0);
  const totalGenerated = cardBase.reduce((s, c) => s + (c.couponsGenerated ?? 0), 0);
  const totalUsed = cardBase.reduce((s, c) => s + c.couponsUsed, 0);
  const totalAvailable = totalCoupons - totalUsed;
  const totalActive = cardBase.filter((c) => c.status === "Activo").length;
  const isFiltered = statusFilter !== "Todos";

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total emitidos", value: totalCoupons.toLocaleString("es-ES"), sub: `en ${cardBase.length} campaña${cardBase.length !== 1 ? "s" : ""}${isFiltered ? ` · ${statusFilter}` : ""}` },
          { label: "Cupones generados", value: totalGenerated.toLocaleString("es-ES"), sub: totalCoupons > 0 ? `${((totalGenerated / totalCoupons) * 100).toFixed(1)}% del total` : "—" },
          { label: "Cupones canjeados", value: totalUsed.toLocaleString("es-ES"), sub: totalCoupons > 0 ? `${((totalUsed / totalCoupons) * 100).toFixed(1)}% del total` : "—" },
          { label: isFiltered ? "Campañas selección" : "Campañas activas", value: isFiltered ? String(cardBase.length) : String(totalActive), sub: `${totalAvailable.toLocaleString("es-ES")} cupones disponibles` },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Buscar campaña o ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 w-52 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              {statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{filtered.length} de {campaigns.length} campañas</span>
            {isAuthenticated && (
              <button
                onClick={() => { setCreateForm(EMPTY_CAMPAIGN_FORM); setShowCreate(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Nueva campaña
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-6 py-3 font-semibold text-gray-500 text-xs w-48">Nombre de campaña</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs w-24">Total</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs w-24">Generados</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs w-28">Canjeados</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs w-24">Disponibles</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs w-32">Puntos</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs w-28">Estado</th>
              <th className="px-4 py-3 w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((c) => {
              const available = c.couponCount - c.couponsUsed;
              const usedPct = c.couponCount > 0 ? ((c.couponsUsed / c.couponCount) * 100).toFixed(0) : "0";
              const totalPts = c.couponCount * c.pointsPerCoupon;
              const usedPts = c.couponsUsed * c.pointsPerCoupon;
              const sym = c.currency ? getCurrencySymbol(c.currency) : null;
              const totalVal = c.valuePerCoupon != null ? c.couponCount * c.valuePerCoupon : null;
              const usedVal = c.valuePerCoupon != null ? c.couponsUsed * c.valuePerCoupon : null;
              return (
                <tr key={c.id} className="hover:bg-gray-50/40 cursor-pointer" onClick={() => setDetailId(c.id)}>
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900 leading-snug">{c.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 whitespace-nowrap">{c.startDate} – {c.endDate}</p>
                  </td>
                  <td className="px-4 py-4 text-right font-semibold text-gray-900 tabular-nums">
                    {c.couponCount.toLocaleString("es-ES")}
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums text-gray-500">
                    {c.couponsGenerated != null ? c.couponsGenerated.toLocaleString("es-ES") : <span className="text-gray-200">—</span>}
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums whitespace-nowrap">
                    <span className="font-semibold text-gray-900">{c.couponsUsed.toLocaleString("es-ES")}</span>
                    {c.couponsUsed > 0 && <span className="ml-1 text-xs text-gray-400">({usedPct}%)</span>}
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums text-gray-500">
                    {available.toLocaleString("es-ES")}
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums text-xs whitespace-nowrap">
                    {totalPts > 0 ? (
                      <><span className="font-semibold text-gray-800">{totalPts.toLocaleString("es-ES")}</span><span className="text-gray-400"> / {usedPts.toLocaleString("es-ES")}</span></>
                    ) : <span className="text-gray-200">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-500"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setDetailId(c.id)}
                        className="text-gray-300 hover:text-blue-500 transition-colors"
                        title="Ver detalles"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                      {isAuthenticated && (
                        <button
                          onClick={() => openEdit(c)}
                          className="text-gray-300 hover:text-purple-500 transition-colors"
                          title="Editar campaña"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-gray-400 text-sm">
                  No se encontraron campañas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      {/* Detail modal */}
      {detailId && (() => {
        const c = campaigns.find((x) => x.id === detailId);
        if (!c) return null;
        const totalPts = c.couponCount * c.pointsPerCoupon;
        const usedPts = c.couponsUsed * c.pointsPerCoupon;
        const sym = c.currency ? getCurrencySymbol(c.currency) : null;
        const totalVal = c.valuePerCoupon != null ? c.couponCount * c.valuePerCoupon : null;
        const usedVal = c.valuePerCoupon != null ? c.couponsUsed * c.valuePerCoupon : null;
        const available = c.couponCount - c.couponsUsed;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">{c.name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{c.startDate} – {c.endDate}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-500"}`}>
                    {c.status}
                  </span>
                  <button onClick={() => setDetailId(null)} className="text-gray-400 hover:text-gray-600 ml-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
                {/* Métricas principales */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Total cupones", value: c.couponCount.toLocaleString("es-ES") },
                    { label: "Disponibles", value: available.toLocaleString("es-ES") },
                    { label: "Generados", value: c.couponsGenerated != null ? c.couponsGenerated.toLocaleString("es-ES") : "—" },
                    { label: "Canjeados", value: c.couponsUsed.toLocaleString("es-ES") + (c.couponsUsed > 0 ? ` (${c.couponCount > 0 ? ((c.couponsUsed/c.couponCount)*100).toFixed(0) : 0}%)` : "") },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-50 rounded-xl px-4 py-3">
                      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                      <p className="text-lg font-bold text-gray-900">{value}</p>
                    </div>
                  ))}
                </div>
                {/* Indicadores económicos */}
                {(totalPts > 0 || (sym && totalVal != null)) && (
                  <div className="grid grid-cols-2 gap-3">
                    {totalPts > 0 && (
                      <div className="bg-purple-50 rounded-xl px-4 py-3">
                        <p className="text-xs text-purple-500 mb-0.5">Puntos</p>
                        <p className="text-lg font-bold text-purple-900">{totalPts.toLocaleString("es-ES")}<span className="text-sm font-normal text-purple-400">/{usedPts.toLocaleString("es-ES")}</span></p>
                      </div>
                    )}
                    {sym && totalVal != null && (
                      <div className="bg-blue-50 rounded-xl px-4 py-3">
                        <p className="text-xs text-blue-500 mb-0.5">Valor ({c.currency})</p>
                        <p className="text-lg font-bold text-blue-900">{sym} {totalVal.toLocaleString("es-ES")}<span className="text-sm font-normal text-blue-400">/{usedVal!.toLocaleString("es-ES")}</span></p>
                      </div>
                    )}
                  </div>
                )}
                {/* Info adicional */}
                <div className="space-y-2 text-sm">
                  {c.description && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Descripción</p>
                      <p className="text-gray-700">{c.description}</p>
                    </div>
                  )}
                  {c.campaignLink && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">URL</p>
                      <a href={c.campaignLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs break-all">{c.campaignLink}</a>
                    </div>
                  )}
                  <div className="flex gap-6 text-xs text-gray-500 pt-1">
                    <span>Creado por: <strong>{c.createdBy}</strong></span>
                    <span>Fecha: <strong>{c.createdDate}</strong></span>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex justify-between">
                <button onClick={() => setDetailId(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cerrar</button>
                {isAuthenticated && (
                  <button onClick={() => { setDetailId(null); openEdit(c); }} className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                    Editar campaña
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit modal */}
      {editingId && editForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Editar campaña #{editingId}</h2>
              <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              {([
                ["name", "Nombre de campaña", "text"],
                ["startDate", "Fecha inicio", "date"],
                ["endDate", "Fecha fin", "date"],
                ["couponCount", "Total cupones", "number"],
                ["couponsGenerated", "Cupones generados", "number"],
                ["couponsUsed", "Cupones canjeados", "number"],
                ["campaignLink", "URL", "text"],
              ] as const).map(([key, label, type]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
                  <input
                    type={type}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={editForm[key]}
                    onChange={(e) => setEditForm((f) => f ? { ...f, [key]: e.target.value } : f)}
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Estado</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => f ? { ...f, status: e.target.value } : f)}
                >
                  {["Borrador", "Por comenzar", "Activo", "Inactivo", "Finalizado", "Cancelado"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              {/* Indicadores económicos */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Indicadores económicos</p>
                <div className="mb-3">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Puntos por cupón</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="0"
                    value={editForm.pointsPerCoupon}
                    onChange={(e) => setEditForm((f) => f ? { ...f, pointsPerCoupon: e.target.value } : f)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Moneda</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                      value={editForm.currency}
                      onChange={(e) => setEditForm((f) => f ? { ...f, currency: e.target.value } : f)}
                    >
                      <option value="">Sin moneda</option>
                      {LATAM_CURRENCIES.map((cur) => (
                        <option key={cur.code} value={cur.code}>{cur.symbol} — {cur.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Valor por cupón</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="0.00"
                      value={editForm.valuePerCoupon}
                      onChange={(e) => setEditForm((f) => f ? { ...f, valuePerCoupon: e.target.value } : f)}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
              <button
                onClick={() => setConfirmDeleteId(editingId)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Eliminar campaña
              </button>
              <div className="flex gap-3">
                <button onClick={() => { setEditingId(null); setEditForm(null); }} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                  Cancelar
                </button>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {saving ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900 text-center mb-2">¿Eliminar campaña?</h3>
            <p className="text-sm text-gray-500 text-center mb-6">
              Esta acción no se puede deshacer. La campaña #{confirmDeleteId} será eliminada permanentemente.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Eliminando..." : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Nueva campaña</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              {([
                ["name", "Nombre de campaña *", "text"],
                ["description", "Descripción", "text"],
                ["startDate", "Fecha inicio", "date"],
                ["endDate", "Fecha fin", "date"],
                ["couponCount", "Total cupones *", "number"],
                ["couponsGenerated", "Cupones generados", "number"],
                ["campaignLink", "URL", "text"],
              ] as const).map(([key, label, type]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
                  <input
                    type={type}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={createForm[key]}
                    onChange={(e) => setCreateForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Estado</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                  value={createForm.status}
                  onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value }))}
                >
                  {["Borrador", "Por comenzar", "Activo", "Inactivo", "Finalizado", "Cancelado"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Indicadores económicos</p>
                <div className="mb-3">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Puntos por cupón</label>
                  <input
                    type="number" min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="0"
                    value={createForm.pointsPerCoupon}
                    onChange={(e) => setCreateForm((f) => ({ ...f, pointsPerCoupon: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Moneda</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                      value={createForm.currency}
                      onChange={(e) => setCreateForm((f) => ({ ...f, currency: e.target.value }))}
                    >
                      <option value="">Sin moneda</option>
                      {LATAM_CURRENCIES.map((cur) => (
                        <option key={cur.code} value={cur.code}>{cur.symbol} — {cur.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Valor por cupón</label>
                    <input
                      type="number" min="0" step="0.01"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="0.00"
                      value={createForm.valuePerCoupon}
                      onChange={(e) => setCreateForm((f) => ({ ...f, valuePerCoupon: e.target.value }))}
                    />
                  </div>
                </div>
                {/* Live preview */}
                {(() => {
                  const qty = parseInt(createForm.couponCount) || 0;
                  const pts = parseInt(createForm.pointsPerCoupon) || 0;
                  const val = parseFloat(createForm.valuePerCoupon) || 0;
                  const totalPts = qty * pts;
                  const totalVal = qty * val;
                  const sym = createForm.currency ? getCurrencySymbol(createForm.currency) : null;
                  const curLabel = createForm.currency
                    ? LATAM_CURRENCIES.find((c) => c.code === createForm.currency)?.label ?? createForm.currency
                    : "—";
                  if (totalPts === 0 && totalVal === 0) return null;
                  return (
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      {totalPts > 0 && (
                        <div className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                          <p className="text-xs text-purple-500 font-medium mb-1">Pepsi puntos por campaña</p>
                          <p className="text-xl font-bold text-gray-900">{totalPts.toLocaleString("es-ES")}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Puntos</p>
                        </div>
                      )}
                      {totalVal > 0 && sym && (
                        <div className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                          <p className="text-xs text-purple-500 font-medium mb-1">Valor de la campaña</p>
                          <p className="text-xl font-bold text-gray-900">{sym} {totalVal.toLocaleString("es-ES")}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{curLabel}</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={saveCreate}
                disabled={creating || !createForm.name.trim() || !createForm.couponCount}
                className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {creating ? "Creando..." : "Crear campaña"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PDF Report ───────────────────────────────────────────────────────────────

function buildReportHTML(snapshots: DaySnapshot[], campaigns: Campaign[], currentSnap: DaySnapshot | null, previousSnap: DaySnapshot | null): string {
  const today = new Date();
  const currentMonth = today.toISOString().slice(0, 7);
  const monthSnaps = snapshots.filter((s) => s.periodDate.startsWith(currentMonth));
  const reportSnaps = monthSnaps.length > 0 ? monthSnaps : snapshots;
  const sortedSnaps = [...reportSnaps].sort((a, b) => a.periodDate.localeCompare(b.periodDate));

  const totalEvents    = reportSnaps.reduce((s, snap) => s + snap.totalEvents, 0);
  const totalUsers     = reportSnaps.reduce((s, snap) => s + snap.totalUsers, 0);
  const totalGenerated = reportSnaps.reduce((s, snap) => s + (snap.funnel.find((f) => f.eventName === "cupon_generado")?.events ?? 0), 0);
  const totalRedeemed  = reportSnaps.reduce((s, snap) => s + (snap.funnel.find((f) => f.eventName === "cupones_canjeados")?.events ?? 0), 0);

  const funnelRows = STAGE_DEFS.map((def) => ({
    label: def.label,
    events: reportSnaps.reduce((s, snap) => s + (snap.funnel.find((f) => f.eventName === def.name)?.events ?? 0), 0),
  })).sort((a, b) => b.events - a.events);

  const dateStr   = today.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  const periodStr = sortedSnaps.length > 0
    ? `${sortedSnaps[0].periodLabel} – ${sortedSnaps[sortedSnaps.length - 1].periodLabel}`
    : dateStr;

  const campTotalCoupons   = campaigns.reduce((s, c) => s + c.couponCount, 0);
  const campTotalGenerated = campaigns.reduce((s, c) => s + (c.couponsGenerated ?? 0), 0);
  const campTotalUsed      = campaigns.reduce((s, c) => s + c.couponsUsed, 0);
  const campTotalAvail     = campTotalCoupons - campTotalUsed;
  const campActiveCount    = campaigns.filter((c) => c.status === "Activo").length;

  const n   = (v: number) => v.toLocaleString("es-ES");
  const pct = (a: number, b: number) => b > 0 ? ((a / b) * 100).toFixed(1) + "%" : "—";

  const statusStyle: Record<string, string> = {
    Activo:         "background:#dcfce7;color:#16a34a",
    "Por comenzar": "background:#dbeafe;color:#2563eb",
    Borrador:       "background:#fef3c7;color:#d97706",
    Cancelado:      "background:#fee2e2;color:#dc2626",
    Finalizado:     "background:#f3f4f6;color:#6b7280",
    Inactivo:       "background:#f3f4f6;color:#9ca3af",
  };

  const funnelHTML = funnelRows.map(({ label, events }, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#fafafa"}">
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;color:#374151">${label}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#1a1a2e">${n(events)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280">${totalEvents > 0 ? ((events / totalEvents) * 100).toFixed(2) + "%" : "—"}</td>
    </tr>`).join("");

  const campaignHTML = campaigns.map((c, i) => {
    const available = c.couponCount - c.couponsUsed;
    const usedPct   = c.couponCount > 0 ? ((c.couponsUsed / c.couponCount) * 100).toFixed(0) : "0";
    const totalPts  = c.couponCount * c.pointsPerCoupon;
    const usedPts   = c.couponsUsed * c.pointsPerCoupon;
    const sym       = c.currency ? getCurrencySymbol(c.currency) : null;
    const totalVal  = c.valuePerCoupon != null ? c.couponCount * c.valuePerCoupon : null;
    const usedVal   = c.valuePerCoupon != null ? c.couponsUsed * c.valuePerCoupon : null;
    const ss        = statusStyle[c.status] ?? "background:#f3f4f6;color:#6b7280";
    const bg        = i % 2 === 0 ? "#fff" : "#fafafa";
    return `
    <tr style="background:${bg}">
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6">
        <div style="font-weight:600;color:#111827;font-size:12px">${c.name}</div>
        <div style="font-size:10px;color:#9ca3af;margin-top:2px">${c.startDate} – ${c.endDate}</div>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#111827">${n(c.couponCount)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280">${c.couponsGenerated != null ? n(c.couponsGenerated) : "—"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;text-align:right;white-space:nowrap">
        <span style="font-weight:600;color:#111827">${n(c.couponsUsed)}</span>${c.couponsUsed > 0 ? `<span style="font-size:10px;color:#9ca3af;margin-left:3px">(${usedPct}%)</span>` : ""}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280">${n(available)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;text-align:right;white-space:nowrap">
        ${totalPts > 0 ? `<span style="font-weight:600;color:#111827">${n(totalPts)}</span><span style="color:#9ca3af"> / ${n(usedPts)}</span>` : '<span style="color:#d1d5db">—</span>'}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6">
        <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;${ss}">${c.status}</span>
      </td>
    </tr>`;
  }).join("");

  // ── Daily comparison ──
  const chg = (curr: number, prev: number | null | undefined) => {
    if (prev == null || prev === 0) return "";
    const v = ((curr - prev) / prev) * 100;
    const color = v >= 0 ? "#16a34a" : "#dc2626";
    return `<span style="font-size:11px;font-weight:600;color:${color};margin-left:6px">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`;
  };

  const kpiRowsHTML = currentSnap ? [
    { label: "Eventos totales",    curr: currentSnap.totalEvents,  prev: previousSnap?.totalEvents,   dec: false },
    { label: "Usuarios",           curr: currentSnap.totalUsers,   prev: previousSnap?.totalUsers,    dec: false },
    { label: "Eventos por usuario",curr: currentSnap.eventsPerUser,prev: previousSnap?.eventsPerUser, dec: true  },
    { label: "Cupones generados",  curr: currentSnap.funnel.find(f => f.eventName === "cupon_generado")?.events ?? 0,
      prev: previousSnap?.funnel.find(f => f.eventName === "cupon_generado")?.events, dec: false },
    { label: "Cupones canjeados",  curr: currentSnap.funnel.find(f => f.eventName === "cupones_canjeados")?.events ?? 0,
      prev: previousSnap?.funnel.find(f => f.eventName === "cupones_canjeados")?.events, dec: false },
  ].map(({ label, curr, prev, dec }, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#fafafa"}">
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-weight:500">${label}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;color:#1a1a2e">
        ${dec ? curr.toFixed(2) : n(curr)}${chg(curr, prev)}
      </td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280">
        ${prev != null ? (dec ? prev.toFixed(2) : n(prev)) : "—"}
      </td>
    </tr>`).join("") : "";

  const pv = currentSnap?.funnel.find(f => f.eventName === "page_view");
  const funnelDayHTML = currentSnap ? STAGE_DEFS.map((def) => {
    const curr = currentSnap.funnel.find(f => f.eventName === def.name)?.events ?? 0;
    const prev = previousSnap?.funnel.find(f => f.eventName === def.name)?.events ?? null;
    const conv = pv && pv.events > 0 && def.name !== "page_view" ? ((curr / pv.events) * 100).toFixed(1) + "%" : "—";
    return { label: def.label, curr, prev, conv };
  }).sort((a, b) => b.curr - a.curr).map(({ label, curr, prev, conv }, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#fafafa"}">
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;color:#374151">${label}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#1a1a2e">
        ${n(curr)}${chg(curr, prev)}
      </td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280">${prev != null ? n(prev) : "—"}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:${conv === "—" ? "#9ca3af" : parseFloat(conv) < 10 ? "#ea580c" : "#16a34a"}">${conv}</td>
    </tr>`).join("") : "";

  const daySection = currentSnap ? `
    <div class="pb"></div>
    <div style="border-bottom:2px solid #7c3aed;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:18px;font-weight:800">Análisis del Día · ${currentSnap.periodLabel}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px">
        ${previousSnap ? `Comparación: vs ${previousSnap.periodLabel}` : "Sin comparación disponible"} · ${currentSnap.source}
      </div>
    </div>
    <div style="font-size:15px;font-weight:700;margin-bottom:10px">KPIs Principales</div>
    <table style="margin-bottom:24px">
      <thead><tr>
        <th style="text-align:left">Métrica</th>
        <th style="text-align:right">${currentSnap.periodLabel}</th>
        <th style="text-align:right">${previousSnap ? previousSnap.periodLabel : "Anterior"}</th>
      </tr></thead>
      <tbody>${kpiRowsHTML}</tbody>
    </table>
    <div style="font-size:15px;font-weight:700;margin-bottom:10px">Funnel Digital</div>
    <table style="margin-bottom:32px">
      <thead><tr>
        <th style="text-align:left">Etapa</th>
        <th style="text-align:right">Eventos</th>
        <th style="text-align:right">Anterior</th>
        <th style="text-align:right">Conversión</th>
      </tr></thead>
      <tbody>${funnelDayHTML}</tbody>
    </table>` : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte Funnel · Cuponera Pepsi · ${dateStr}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a2e;background:#fff;font-size:13px;line-height:1.5}
    .page{padding:40px 48px;max-width:860px;margin:0 auto}
    h2{font-size:15px;font-weight:700}
    table{width:100%;border-collapse:collapse}
    th{font-size:11px;font-weight:700;color:#6b7280;background:#f9fafb;padding:9px 10px;border-bottom:1px solid #e5e7eb}
    .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    .card{border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;background:#fff}
    .clabel{font-size:11px;color:#6b7280;margin-bottom:4px}
    .cval{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums}
    .csub{font-size:10px;color:#9ca3af;margin-top:3px}
    .toolbar{position:fixed;top:16px;right:16px;display:flex;gap:8px;z-index:100}
    .btn-p{background:#7c3aed;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
    .btn-c{background:#fff;color:#6b7280;border:1px solid #e5e7eb;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
    @media print{
      *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
      @page{margin:1.2cm;size:A4 portrait}
      .toolbar{display:none!important}
      .pb{page-break-before:always}
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn-c" onclick="window.close()">Cerrar</button>
    <button class="btn-p" onclick="window.print()">&#8595; Guardar como PDF</button>
  </div>
  <div class="page">
    <!-- Header -->
    <div style="border-bottom:2px solid #7c3aed;padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:22px;font-weight:800;color:#1a1a2e">Análisis Funnel · Cuponera Pepsi</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px">Monitoreo diario · Google Analytics</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:#6b7280">Generado el</div>
        <div style="font-size:13px;font-weight:600;margin-top:2px">${dateStr}</div>
        <div style="font-size:12px;color:#7c3aed;margin-top:2px">${reportSnaps.length} día${reportSnaps.length !== 1 ? "s" : ""} cargado${reportSnaps.length !== 1 ? "s" : ""}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px">${periodStr}</div>
      </div>
    </div>

    <!-- KPIs -->
    <div style="font-size:15px;font-weight:700;margin-bottom:12px">Indicadores del Período</div>
    <div class="grid4" style="margin-bottom:28px">
      <div class="card"><div class="clabel">Eventos totales</div><div class="cval" style="color:#1a73e8">${n(totalEvents)}</div></div>
      <div class="card"><div class="clabel">Usuarios únicos</div><div class="cval" style="color:#34a853">${n(totalUsers)}</div></div>
      <div class="card"><div class="clabel">Cupones generados</div><div class="cval" style="color:#7c3aed">${n(totalGenerated)}</div></div>
      <div class="card"><div class="clabel">Cupones canjeados</div><div class="cval" style="color:#f4511e">${n(totalRedeemed)}</div></div>
    </div>

    <!-- Funnel -->
    <div style="font-size:15px;font-weight:700;margin-bottom:10px">Funnel Digital — Acumulado del Período</div>
    <table style="margin-bottom:32px">
      <thead><tr>
        <th style="text-align:left">Etapa del Funnel</th>
        <th style="text-align:right">Total eventos</th>
        <th style="text-align:right">% del total</th>
      </tr></thead>
      <tbody>
        ${funnelHTML}
        <tr style="background:#f0fdf4;border-top:2px solid #86efac">
          <td style="padding:9px 12px;font-weight:700;color:#166534">Conversión final (cupones generados)</td>
          <td style="padding:9px 12px;text-align:right;font-weight:700;color:#166534">${n(totalGenerated)}</td>
          <td style="padding:9px 12px;text-align:right;font-weight:700;color:#166534">${pct(totalGenerated, totalEvents)}</td>
        </tr>
      </tbody>
    </table>

    ${daySection}

    <!-- Campaigns -->
    <div class="pb"></div>
    <div style="border-bottom:2px solid #7c3aed;padding-bottom:12px;margin-bottom:20px">
      <div style="font-size:18px;font-weight:800">Campañas de Cupones</div>
      <div style="font-size:12px;color:#6b7280;margin-top:2px">Canjeados a la fecha · ${dateStr}</div>
    </div>
    <div class="grid4" style="margin-bottom:16px">
      <div class="card"><div class="clabel">Total emitidos</div><div class="cval">${n(campTotalCoupons)}</div><div class="csub">en ${campaigns.length} campaña${campaigns.length !== 1 ? "s" : ""}</div></div>
      <div class="card"><div class="clabel">Cupones generados</div><div class="cval">${n(campTotalGenerated)}</div><div class="csub">${pct(campTotalGenerated, campTotalCoupons)} del total</div></div>
      <div class="card"><div class="clabel">Cupones canjeados</div><div class="cval">${n(campTotalUsed)}</div><div class="csub">${pct(campTotalUsed, campTotalCoupons)} del total</div></div>
      <div class="card"><div class="clabel">Campañas activas</div><div class="cval">${campActiveCount}</div><div class="csub">${n(campTotalAvail)} cupones disponibles</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Nombre de campaña</th>
        <th style="text-align:right">Total</th>
        <th style="text-align:right">Generados</th>
        <th style="text-align:right">Canjeados</th>
        <th style="text-align:right">Disponibles</th>
        <th style="text-align:right">Puntos</th>
        <th>Estado</th>
      </tr></thead>
      <tbody>${campaignHTML}</tbody>
    </table>

    <!-- Footer -->
    <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between">
      <span style="font-size:10px;color:#9ca3af">Cuponera Pepsi · Análisis Funnel</span>
      <span style="font-size:10px;color:#9ca3af">Generado el ${dateStr}</span>
    </div>
  </div>
</body>
</html>`;
}


// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Sin datos de funnel</h2>
      <p className="text-sm text-gray-500 max-w-sm mb-6">
        Cargá el primer reporte diario. Cada día que subas se comparará automáticamente con el anterior.
      </p>
      <button
        onClick={onUpload}
        className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        Cargar primer reporte
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalisisFunnelPage() {
  const { isAuthenticated } = useAuth();
  const { campaigns } = useCampaigns();
  const [snapshots, setSnapshots] = useState<DaySnapshot[]>([]);
  const [view, setView] = useState<"dashboard" | "rendimiento" | "historico" | "cupones">("dashboard");
  const [period, setPeriod] = useState<Period>("semana");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparisonId, setComparisonId] = useState<string | "none" | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [monthUploadOpen, setMonthUploadOpen] = useState(false);

  useEffect(() => {
    supabase
      .from("funnel_snapshots")
      .select("*")
      .order("period_date", { ascending: true })
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        if (data && data.length > 0) {
          setSnapshots(data.map((row: Record<string, unknown>): DaySnapshot => ({
            id: row.id as string,
            savedAt: row.saved_at as string,
            periodLabel: row.period_label as string,
            periodDate: row.period_date as string,
            source: row.source as string,
            totalEvents: row.total_events as number,
            totalUsers: row.total_users as number,
            eventsPerUser: row.events_per_user as number,
            funnel: (row.funnel as DayStage[]) ?? [],
          })));
        }
      });
  }, []);

  const addSnapshot = async (s: DaySnapshot) => {
    await supabase.from("funnel_snapshots").insert({
      id: s.id,
      saved_at: s.savedAt,
      period_label: s.periodLabel,
      period_date: s.periodDate,
      source: s.source,
      total_events: s.totalEvents,
      total_users: s.totalUsers,
      events_per_user: s.eventsPerUser,
      funnel: s.funnel,
    });
    setSnapshots((prev) => [...prev, s]);
  };

  const replaceSnapshot = async (existingId: string, s: DaySnapshot) => {
    await supabase.from("funnel_snapshots").update({
      saved_at: s.savedAt,
      period_label: s.periodLabel,
      period_date: s.periodDate,
      source: s.source,
      total_events: s.totalEvents,
      total_users: s.totalUsers,
      events_per_user: s.eventsPerUser,
      funnel: s.funnel,
    }).eq("id", existingId);
    setSnapshots((prev) => prev.map((snap) => snap.id === existingId ? { ...s, id: existingId } : snap));
  };

  const deleteSnapshot = async (id: string) => {
    await supabase.from("funnel_snapshots").delete().eq("id", id);
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const bulkSaveSnapshots = async (
    toInsert: DaySnapshot[],
    toUpdate: { id: string; snap: DaySnapshot }[]
  ) => {
    const toRow = (s: DaySnapshot) => ({
      id: s.id, saved_at: s.savedAt, period_label: s.periodLabel, period_date: s.periodDate,
      source: s.source, total_events: s.totalEvents, total_users: s.totalUsers,
      events_per_user: s.eventsPerUser, funnel: s.funnel,
    });
    if (toInsert.length > 0) {
      await supabase.from("funnel_snapshots").insert(toInsert.map(toRow));
      setSnapshots((prev) => [...prev, ...toInsert]);
    }
    for (const { id, snap } of toUpdate) {
      await supabase.from("funnel_snapshots").update(toRow(snap)).eq("id", id);
      setSnapshots((prev) => prev.map((s) => (s.id === id ? snap : s)));
    }
  };

  const updateSnapshotEvent = async (snapshotId: string, eventName: string, value: number) => {
    const snap = snapshots.find((s) => s.id === snapshotId);
    if (!snap) return;
    const def = STAGE_DEFS.find((d) => d.name === eventName);
    if (!def) return;
    const existingStage = snap.funnel.find((f) => f.eventName === eventName);
    const newFunnel = existingStage
      ? snap.funnel.map((f) => f.eventName === eventName ? { ...f, events: value } : f)
      : [...snap.funnel, { eventName, label: def.label, events: value }];
    await supabase.from("funnel_snapshots").update({ funnel: newFunnel }).eq("id", snapshotId);
    setSnapshots((prev) =>
      prev.map((s) => s.id === snapshotId ? { ...s, funnel: newFunnel } : s)
    );
  };

  // Ordenado desc por fecha
  const sorted = [...snapshots].sort((a, b) => b.periodDate.localeCompare(a.periodDate));

  const currentSnap = (selectedId ? snapshots.find((s) => s.id === selectedId) : null) ?? sorted[0] ?? null;

  // El "anterior": puede ser el auto-previo, uno elegido, o ninguno
  const previousSnap: DaySnapshot | null = (() => {
    if (!currentSnap) return null;
    if (comparisonId === "none") return null;
    if (comparisonId) return snapshots.find((s) => s.id === comparisonId) ?? null;
    return sorted.find((s) => s.id !== currentSnap.id && s.periodDate < currentSnap.periodDate) ?? null;
  })();

  const latestDate = sorted[0]?.periodDate ?? null;
  const existingDates = snapshots.map((s) => s.periodDate);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Análisis Funnel</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Monitoreo diario · Cuponera Pepsi
            {sorted.length > 0 && (
              <span className="ml-2 text-purple-600 font-medium">
                · {sorted.length} día{sorted.length !== 1 ? "s" : ""} cargado{sorted.length !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {snapshots.length > 0 && (
            <>
              <button
                onClick={() => {
                  const html = buildReportHTML(snapshots, campaigns, currentSnap, previousSnap);
                  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "reporte-funnel-pepsi.html";
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Descargar HTML
              </button>
              <button
                onClick={() => {
                  const html = buildReportHTML(snapshots, campaigns, currentSnap, previousSnap);
                  const win = window.open("", "_blank");
                  if (win) { win.document.write(html); win.document.close(); }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Exportar PDF
              </button>
            </>
          )}
          {isAuthenticated && (
            <>
              <button
                onClick={() => setMonthUploadOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Cargar mes
              </button>
              <button
                onClick={() => setUploadOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Cargar día
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      {(() => {
        const tabs: [string, string][] = [
          ["dashboard", "Dashboard"],
          ["rendimiento", "Rendimiento"],
          ["historico", "Histórico"],
          ["cupones", "Cupones"],
        ];
        return (
          <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
            {tabs.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v as typeof view)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Content */}
      {view === "dashboard" && (
        snapshots.length === 0
          ? <EmptyState onUpload={() => setUploadOpen(true)} />
          : <DashboardView snapshots={snapshots} onUpdateManual={updateSnapshotEvent} canEdit={isAuthenticated} />
      )}
      {view === "rendimiento" && (
        <RendimientoView
          snapshots={snapshots}
          currentSnap={currentSnap}
          previousSnap={previousSnap}
          setSelectedId={setSelectedId}
          comparisonId={comparisonId}
          setComparisonId={setComparisonId}
        />
      )}
      {view === "cupones" && <CuponesView />}
      {view === "historico" && (
        <Historical
          snapshots={snapshots}
          period={period}
          setPeriod={setPeriod}
          onSelect={(s) => { setSelectedId(s.id); setView("rendimiento"); }}
          onDelete={deleteSnapshot}
          selectedId={selectedId}
        />
      )}

      {monthUploadOpen && (
        <MonthUploadModal
          onClose={() => setMonthUploadOpen(false)}
          onBulkSave={async (toInsert, toUpdate) => {
            await bulkSaveSnapshots(toInsert, toUpdate);
            setView("dashboard");
          }}
          snapshots={snapshots}
        />
      )}

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onSave={(s) => {
            addSnapshot(s);
            setSelectedId(s.id);
            setView("dashboard");
            setUploadOpen(false);
          }}
          onUpdate={async (existingId, s) => {
            await replaceSnapshot(existingId, s);
            setView("dashboard");
          }}
          snapshots={snapshots}
          existingDates={existingDates}
          latestDate={latestDate}
        />
      )}

    </div>
  );
}
