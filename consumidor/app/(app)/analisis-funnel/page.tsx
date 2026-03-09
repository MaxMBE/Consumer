"use client";

import { useState, useEffect, useRef } from "react";
import { useCampaigns, useAuth } from "@/context";
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
  const ordRx = /\b([1-9])\s+(page_view|scroll|session_start|first_visit|user_engagement|cupon_generado)\b/gi;
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
  existingDates,
  latestDate,
}: {
  onClose: () => void;
  onSave: (s: DaySnapshot) => void;
  existingDates: string[];
  latestDate: string | null;
}) {
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const fileRef = useRef<HTMLInputElement>(null);

  const isDuplicate = existingDates.includes(form.periodDate);
  const daysFromLatest = latestDate ? daysBetween(latestDate, form.periodDate) : null;
  const isGap = daysFromLatest !== null && Math.abs(daysFromLatest) !== 1;
  const canSave = !isDuplicate && form.periodLabel !== "";

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const text = await extractPDFText(file);
      setRawText(text);
      const parsed = parseGA4SingleDay(text);
      setForm(parsedToForm(parsed));
    } catch {
      setForm(emptyForm());
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
              {isDuplicate && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-red-700">
                    Ya existe un reporte para <strong>{form.periodLabel || form.periodDate}</strong>. Cada día debe ser único.
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

              {/* Funnel */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Funnel digital</h3>
                <div className="space-y-2">
                  {form.stages.map((stage, idx) => (
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
                  ))}
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
                  onClick={() => canSave && onSave(formToSnapshot(form))}
                  disabled={!canSave}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${
                    canSave
                      ? "bg-purple-600 text-white hover:bg-purple-700"
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  Guardar reporte
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
  total:            "#4285f4",
  page_view:        "#1a73e8",
  scroll:           "#34a853",
  session_start:    "#fbbc04",
  first_visit:      "#3c4043",
  user_engagement:  "#ea4335",
  cupon_generado:   "#7c3aed",
};

function EventsChart({ snapshots }: { snapshots: DaySnapshot[] }) {
  const sorted = [...snapshots].sort((a, b) => a.periodDate.localeCompare(b.periodDate));
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
        <span className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 bg-white">Día</span>
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

function EventsTable({ snapshots }: { snapshots: DaySnapshot[] }) {
  const latest = [...snapshots].sort((a, b) => b.periodDate.localeCompare(a.periodDate))[0];
  if (!latest) return null;

  const totalEvts = latest.totalEvents;
  const totalUsers = latest.totalUsers;
  const evtPerUser = latest.eventsPerUser;

  const rows = STAGE_DEFS.map((def, idx) => {
    const stage = latest.funnel.find((f) => f.eventName === def.name);
    const evts = stage?.events ?? 0;
    const pct = totalEvts > 0 ? ((evts / totalEvts) * 100).toFixed(2).replace(".", ",") : "0,00";
    return { idx: idx + 1, name: def.name, evts, pct };
  }).filter((r) => r.evts > 0);

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
          Filas por página: 10 · 1–{rows.length} de {rows.length}
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
            <th className="text-right px-6 py-3 font-semibold text-gray-600 text-xs">Usuarios activos</th>
            <th className="text-right px-6 py-3 font-semibold text-gray-600 text-xs">Eventos / usuario activo</th>
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
            </td>
          </tr>
          {rows.map((row) => (
            <tr key={row.name} className="hover:bg-gray-50/50">
              <td className="px-6 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-4 text-right">{row.idx}</span>
                  <span
                    className="font-medium cursor-pointer"
                    style={{ color: EVENT_COLORS[row.name] ?? "#1a73e8" }}
                  >
                    {row.name}
                  </span>
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
    </div>
  );
}

function TendenciasView({ snapshots }: { snapshots: DaySnapshot[] }) {
  if (snapshots.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400 text-sm">
        Cargá al menos un reporte para ver las tendencias.
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <EventsChart snapshots={snapshots} />
      <EventsTable snapshots={snapshots} />
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

function CuponesView() {
  const { campaigns } = useCampaigns();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("Todos");

  const statuses = ["Todos", "Activo", "Por comenzar", "Borrador", "Finalizado", "Cancelado", "Inactivo"];

  const filtered = campaigns.filter((c) => {
    const matchSearch =
      search === "" ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "Todos" || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalCoupons = campaigns.reduce((s, c) => s + c.couponCount, 0);
  const totalUsed = campaigns.reduce((s, c) => s + c.couponsUsed, 0);
  const totalActive = campaigns.filter((c) => c.status === "Activo").length;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total cupones disponibles", value: (totalCoupons - totalUsed).toLocaleString("es-ES"), sub: `de ${totalCoupons.toLocaleString("es-ES")} emitidos` },
          { label: "Cupones generados", value: totalUsed.toLocaleString("es-ES"), sub: totalCoupons > 0 ? `${((totalUsed / totalCoupons) * 100).toFixed(1)}% del total` : "—" },
          { label: "Campañas activas", value: String(totalActive), sub: `de ${campaigns.length} campañas` },
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
          <span className="text-xs text-gray-400">{filtered.length} de {campaigns.length} campañas</span>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-6 py-3 font-semibold text-gray-600 text-xs">Nombre de campaña</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">ID</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">Total</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">Generados</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">Disponibles</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">Estado</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">URL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((c) => {
              const available = c.couponCount - c.couponsUsed;
              const usedPct = c.couponCount > 0 ? ((c.couponsUsed / c.couponCount) * 100).toFixed(0) : "0";
              return (
                <tr key={c.id} className="hover:bg-gray-50/50">
                  <td className="px-6 py-3.5">
                    <p className="font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{c.startDate} – {c.endDate}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      #{c.id}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right font-semibold text-gray-900 tabular-nums">
                    {c.couponCount.toLocaleString("es-ES")}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums">
                    <span className="font-semibold text-gray-900">{c.couponsUsed.toLocaleString("es-ES")}</span>
                    {c.couponsUsed > 0 && (
                      <span className="ml-1.5 text-xs text-gray-400">({usedPct}%)</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-gray-600">
                    {available.toLocaleString("es-ES")}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-500"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 max-w-[180px]">
                    {c.campaignLink ? (
                      <a
                        href={c.campaignLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline font-mono truncate block"
                        title={c.campaignLink}
                      >
                        {c.campaignLink.replace(/^https?:\/\//, "").slice(0, 32)}…
                      </a>
                    ) : (
                      <span className="text-xs text-gray-300">Sin URL</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                  No se encontraron campañas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  const [snapshots, setSnapshots] = useState<DaySnapshot[]>([]);
  const [view, setView] = useState<"dashboard" | "tendencias" | "cupones" | "historico">("dashboard");
  const [period, setPeriod] = useState<Period>("semana");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparisonId, setComparisonId] = useState<string | "none" | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

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

  const deleteSnapshot = async (id: string) => {
    await supabase.from("funnel_snapshots").delete().eq("id", id);
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
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
        {isAuthenticated && (
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Cargar día
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {(([["dashboard", "Dashboard"], ["tendencias", "Tendencias"], ["historico", "Histórico"], ...(isAuthenticated ? [["cupones", "Cupones"]] : [])] as const) as [string, string][]).map(([v, label]) => (
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

      {/* Day selectors (only in dashboard when at least 1 day loaded) */}
      {view === "dashboard" && currentSnap && (
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          {/* Día analizado */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 whitespace-nowrap">Día analizado:</span>
            <select
              value={currentSnap.id}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setComparisonId(null); // reset comparación al cambiar día
              }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              {sorted.map((s) => (
                <option key={s.id} value={s.id}>{s.periodLabel}</option>
              ))}
            </select>
          </div>

          {/* Comparar con (solo si hay más de 1 día) */}
          {sorted.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 whitespace-nowrap">Comparar con:</span>
              <select
                value={comparisonId ?? "auto"}
                onChange={(e) => setComparisonId(e.target.value === "auto" ? null : e.target.value)}
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
      )}

      {/* Content */}
      {!currentSnap && view === "dashboard" && <EmptyState onUpload={() => setUploadOpen(true)} />}
      {currentSnap && view === "dashboard" && (
        <Dashboard current={currentSnap} previous={previousSnap} />
      )}
      {view === "tendencias" && <TendenciasView snapshots={snapshots} />}
      {view === "cupones" && <CuponesView />}
      {view === "historico" && (
        <Historical
          snapshots={snapshots}
          period={period}
          setPeriod={setPeriod}
          onSelect={(s) => { setSelectedId(s.id); setView("dashboard"); }}
          onDelete={deleteSnapshot}
          selectedId={selectedId}
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
          existingDates={existingDates}
          latestDate={latestDate}
        />
      )}
    </div>
  );
}
