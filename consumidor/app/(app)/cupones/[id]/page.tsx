"use client";

import { useState, useMemo, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCampaigns, Campaign } from "@/context";

/* ─── Mock funnel generator ─── */
interface FunnelStage {
  id: string;
  label: string;
  sublabel: string;
  value: number;
  color: string;
}

function makeFunnel(c: Campaign): FunnelStage[] {
  const seed = (parseInt(c.id, 36) || 7) % 10;
  const imp = Math.round(c.couponCount * (14 + seed));
  const clicks = Math.round(imp * (0.30 + seed * 0.01));
  const reg = Math.round(clicks * (0.50 + seed * 0.02));
  const dl = Math.round(reg * (0.72 + seed * 0.015));
  const act = Math.round(dl * (0.65 + seed * 0.01));
  const red = c.couponsUsed > 0 ? c.couponsUsed : Math.round(act * 0.82);
  const rep = Math.round(red * (0.35 + seed * 0.02));

  return [
    { id: "impressions", label: "Impresiones", sublabel: "Alcance total", value: imp, color: "#7c3aed" },
    { id: "clicks", label: "Clicks", sublabel: "Interacción", value: clicks, color: "#8b5cf6" },
    { id: "registrations", label: "Registro", sublabel: "Usuarios registrados", value: reg, color: "#6366f1" },
    { id: "downloaded", label: "Cupón descargado", sublabel: "Descarga", value: dl, color: "#3b82f6" },
    { id: "activated", label: "Cupón activado", sublabel: "Activación", value: act, color: "#0ea5e9" },
    { id: "redeemed", label: "Cupón canjeado", sublabel: "Conversión final", value: red, color: "#10b981" },
    { id: "repeat", label: "Repeat", sublabel: "Reengagement", value: rep, color: "#f59e0b" },
  ];
}

/* previous-period: apply ~-15% noise for comparison */
function makePrevFunnel(stages: FunnelStage[]): FunnelStage[] {
  return stages.map((s, i) => ({
    ...s,
    value: Math.round(s.value * (0.72 + (i % 4) * 0.06)),
  }));
}

function fmt(n: number) {
  return n.toLocaleString("es-GT");
}

function convRate(current: number, prev: number) {
  if (prev === 0) return "—";
  const pct = ((current - prev) / prev) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
}

const statusColor: Record<string, string> = {
  Borrador: "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Por comenzar": "bg-gray-100 text-gray-600 border-gray-200",
  Activo: "bg-green-100 text-green-600 border-green-200",
  Cancelado: "bg-red-100 text-red-400 border-red-200",
  Finalizado: "bg-gray-100 text-gray-500 border-gray-200",
  Inactivo: "bg-orange-50 text-orange-400 border-orange-200",
};

export default function CampaignAnalyticsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-gray-400 text-sm">Cargando análisis...</div>}>
      <AnalyticsContent />
    </Suspense>
  );
}

function AnalyticsContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { campaigns } = useCampaigns();

  const campaign = campaigns.find((c) => c.id === id);

  const [view, setView] = useState<"funnel" | "table">("funnel");
  const [compareMode, setCompareMode] = useState(false);
  const [channel, setChannel] = useState("Todos");
  const [segment, setSegment] = useState("Todos");
  const [region, setRegion] = useState("Todas");
  const [dateRange, setDateRange] = useState<"custom" | "7d" | "30d" | "total">("total");
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);

  const funnel = useMemo(() => (campaign ? makeFunnel(campaign) : []), [campaign]);
  const prevFunnel = useMemo(() => makePrevFunnel(funnel), [funnel]);

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-gray-500 text-sm">Campaña no encontrada.</p>
        <button onClick={() => router.push("/cupones")} className="text-purple-600 text-sm font-medium hover:underline">
          Volver a campañas
        </button>
      </div>
    );
  }

  const maxVal = funnel[0]?.value || 1;

  function handleExportCSV() {
    if (!campaign) return;
    const headers = ["Etapa", "Volumen", "Tasa vs. etapa anterior"];
    const rows = funnel.map((s, i) => {
      const prev = i === 0 ? null : funnel[i - 1].value;
      const rate = prev ? ((s.value / prev) * 100).toFixed(1) + "%" : "100%";
      return [s.label, s.value, rate];
    });
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `funnel-${campaign.name.toLowerCase().replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* ─── Header ─── */}
      <div className="mb-6">
        <button
          onClick={() => router.push("/cupones")}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Volver a campañas
        </button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${statusColor[campaign.status] ?? ""}`}>
                {campaign.status}
              </span>
            </div>
            <p className="text-sm text-gray-400">
              {campaign.startDate && campaign.endDate
                ? `${campaign.startDate} — ${campaign.endDate}`
                : "Sin fechas definidas"}{" "}
              · Creado por {campaign.createdBy}
            </p>
          </div>

          {/* Export */}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-full text-sm text-gray-600 bg-white hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="border-b border-gray-200 mb-6" />

      {/* ─── Filters ─── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Date Range */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-full p-1 text-xs font-medium">
          {(["7d", "30d", "total"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={`px-3 py-1 rounded-full transition-colors ${
                dateRange === r ? "bg-purple-600 text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {r === "7d" ? "7 días" : r === "30d" ? "30 días" : "Todo el período"}
            </button>
          ))}
        </div>

        <Select label="Canal" value={channel} onChange={setChannel} options={["Todos", "WhatsApp", "App Móvil", "Web"]} />
        <Select label="Segmento" value={segment} onChange={setSegment} options={["Todos", "Nuevos", "Recurrentes", "Premium"]} />
        <Select label="Región" value={region} onChange={setRegion} options={["Todas", "Guatemala", "Quetzaltenango", "Escuintla", "Mixco"]} />

        {/* Compare toggle */}
        <button
          onClick={() => setCompareMode((v) => !v)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
            compareMode
              ? "bg-indigo-50 text-indigo-600 border-indigo-300"
              : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          {compareMode ? "Período anterior: ON" : "Comparar período anterior"}
        </button>

        {/* View toggle */}
        <div className="ml-auto flex gap-1 bg-white border border-gray-200 rounded-full p-1">
          <button
            onClick={() => setView("funnel")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              view === "funnel" ? "bg-purple-600 text-white" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Funnel
          </button>
          <button
            onClick={() => setView("table")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              view === "table" ? "bg-purple-600 text-white" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Tabla
          </button>
        </div>
      </div>

      {/* ─── KPI summary row ─── */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Alcance total"
          value={fmt(funnel[0]?.value ?? 0)}
          delta={compareMode ? convRate(funnel[0]?.value ?? 0, prevFunnel[0]?.value ?? 0) : undefined}
        />
        <KpiCard
          label="Tasa de registro"
          value={funnel[0] ? ((funnel[2].value / funnel[0].value) * 100).toFixed(1) + "%" : "—"}
          delta={
            compareMode && prevFunnel[0]
              ? convRate(
                  (funnel[2].value / funnel[0].value) * 100,
                  (prevFunnel[2].value / prevFunnel[0].value) * 100
                )
              : undefined
          }
        />
        <KpiCard
          label="Cupones canjeados"
          value={fmt(funnel[5]?.value ?? 0)}
          delta={compareMode ? convRate(funnel[5]?.value ?? 0, prevFunnel[5]?.value ?? 0) : undefined}
        />
        <KpiCard
          label="Tasa de canje"
          value={funnel[0] ? ((funnel[5].value / funnel[0].value) * 100).toFixed(1) + "%" : "—"}
          delta={
            compareMode && prevFunnel[0]
              ? convRate(
                  (funnel[5].value / funnel[0].value) * 100,
                  (prevFunnel[5].value / prevFunnel[0].value) * 100
                )
              : undefined
          }
        />
      </div>

      {/* ─── Main content ─── */}
      {view === "funnel" ? (
        <FunnelView
          stages={funnel}
          prevStages={compareMode ? prevFunnel : undefined}
          maxVal={maxVal}
          hoveredStage={hoveredStage}
          setHoveredStage={setHoveredStage}
        />
      ) : (
        <TableView stages={funnel} prevStages={compareMode ? prevFunnel : undefined} />
      )}
    </div>
  );
}

/* ─── Funnel View ─── */
function FunnelView({
  stages,
  prevStages,
  maxVal,
  hoveredStage,
  setHoveredStage,
}: {
  stages: FunnelStage[];
  prevStages?: FunnelStage[];
  maxVal: number;
  hoveredStage: string | null;
  setHoveredStage: (id: string | null) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-7">
      {prevStages && (
        <div className="flex items-center gap-4 mb-5 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: "#7c3aed" }} />
            <span className="text-gray-600">Período actual</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-gray-300" />
            <span className="text-gray-400">Período anterior</span>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {stages.map((stage, i) => {
          const pct = (stage.value / maxVal) * 100;
          const prev = prevStages?.[i];
          const prevPct = prev ? (prev.value / maxVal) * 100 : 0;
          const conversionFromPrev =
            i === 0 ? null : ((stage.value / stages[i - 1].value) * 100).toFixed(1);
          const dropOff = i === 0 ? null : (100 - parseFloat(conversionFromPrev!)).toFixed(1);
          const isHovered = hoveredStage === stage.id;

          return (
            <div key={stage.id}>
              {/* Conversion arrow between stages */}
              {i > 0 && (
                <div className="flex items-center gap-3 ml-[220px] my-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                    <span className="text-green-600 font-semibold">{conversionFromPrev}%</span>
                    <span className="text-gray-400">conversión</span>
                    <span className="text-red-400 font-medium ml-2">−{dropOff}% drop-off</span>
                  </div>
                </div>
              )}

              {/* Stage row */}
              <div
                className={`flex items-center gap-4 group cursor-default rounded-xl p-3 transition-colors ${
                  isHovered ? "bg-gray-50" : "hover:bg-gray-50"
                }`}
                onMouseEnter={() => setHoveredStage(stage.id)}
                onMouseLeave={() => setHoveredStage(null)}
              >
                {/* Label */}
                <div className="w-52 flex-shrink-0">
                  <p className="text-sm font-semibold text-gray-800">{stage.label}</p>
                  <p className="text-xs text-gray-400">{stage.sublabel}</p>
                </div>

                {/* Bar stack */}
                <div className="flex-1 flex flex-col gap-1">
                  {/* Current period bar */}
                  <div className="h-8 bg-gray-100 rounded-full overflow-hidden relative">
                    <div
                      className="h-full rounded-full transition-all duration-500 relative"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${stage.color}cc, ${stage.color})`,
                      }}
                    >
                      {pct > 15 && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white text-xs font-semibold">
                          {fmt(stage.value)}
                        </span>
                      )}
                    </div>
                    {pct <= 15 && (
                      <span className="absolute left-[calc(var(--w)+8px)] top-1/2 -translate-y-1/2 text-gray-700 text-xs font-semibold"
                        style={{ "--w": `${pct}%` } as React.CSSProperties}>
                        {fmt(stage.value)}
                      </span>
                    )}
                  </div>

                  {/* Previous period bar (comparison) */}
                  {prev && (
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gray-300 transition-all duration-500"
                        style={{ width: `${prevPct}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Numbers on the right */}
                <div className="w-32 flex-shrink-0 text-right">
                  <p className="text-sm font-bold text-gray-900">{fmt(stage.value)}</p>
                  <p className="text-xs text-gray-400">{((stage.value / maxVal) * 100).toFixed(1)}% del alcance</p>
                  {prev && (
                    <p className={`text-xs font-medium mt-0.5 ${
                      stage.value >= prev.value ? "text-green-500" : "text-red-400"
                    }`}>
                      {convRate(stage.value, prev.value)} vs anterior
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Table View ─── */
function TableView({ stages, prevStages }: { stages: FunnelStage[]; prevStages?: FunnelStage[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Etapa</th>
            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Volumen</th>
            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">% del alcance</th>
            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Conv. vs anterior</th>
            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Drop-off</th>
            {prevStages && (
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Período anterior</th>
            )}
            {prevStages && (
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Variación</th>
            )}
          </tr>
        </thead>
        <tbody>
          {stages.map((stage, i) => {
            const prev = stages[i - 1];
            const convPct = prev ? ((stage.value / prev.value) * 100).toFixed(1) + "%" : "—";
            const dropPct = prev ? (100 - parseFloat(convPct)).toFixed(1) + "%" : "—";
            const totalPct = ((stage.value / stages[0].value) * 100).toFixed(1) + "%";
            const compStage = prevStages?.[i];

            return (
              <tr key={stage.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                    <div>
                      <p className="font-semibold text-gray-800">{stage.label}</p>
                      <p className="text-xs text-gray-400">{stage.sublabel}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-right font-bold text-gray-900">{fmt(stage.value)}</td>
                <td className="px-6 py-4 text-right text-gray-600">{totalPct}</td>
                <td className="px-6 py-4 text-right">
                  {prev ? (
                    <span className="text-green-600 font-medium">{convPct}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  {prev ? (
                    <span className="text-red-400 font-medium">{dropPct}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                {compStage && (
                  <td className="px-6 py-4 text-right text-gray-400">{fmt(compStage.value)}</td>
                )}
                {compStage && (
                  <td className="px-6 py-4 text-right">
                    <span className={`font-medium text-xs ${stage.value >= compStage.value ? "text-green-500" : "text-red-400"}`}>
                      {convRate(stage.value, compStage.value)}
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── KPI Card ─── */
function KpiCard({ label, value, delta }: { label: string; value: string; delta?: string }) {
  const isPositive = delta?.startsWith("+");
  const isNegative = delta?.startsWith("-");
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
      {delta && (
        <p className={`text-xs font-medium mt-2 ${isPositive ? "text-green-500" : isNegative ? "text-red-400" : "text-gray-400"}`}>
          {delta} vs período anterior
        </p>
      )}
    </div>
  );
}

/* ─── Select ─── */
function Select({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-3 pr-7 py-2 bg-white border border-gray-200 rounded-full text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-200 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
