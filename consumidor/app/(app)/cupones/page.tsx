"use client";

import Link from "next/link";
import { useState } from "react";
import { useCampaigns, Campaign, CampaignStatus } from "@/context";
import { CampaignDrawer } from "@/components/cupones";

const statusConfig: Record<CampaignStatus, { label: string; className: string }> = {
  Borrador:       { label: "Borrador",       className: "bg-yellow-50 text-yellow-600" },
  Activo:         { label: "Activo",         className: "bg-green-100 text-green-600" },
  Cancelado:      { label: "Cancelado",      className: "bg-red-100 text-red-400" },
  Finalizado:     { label: "Finalizado",     className: "bg-gray-100 text-gray-500" },
  "Por comenzar": { label: "Por comenzar",   className: "bg-gray-100 text-gray-500" },
  Inactivo:       { label: "Inactivo",       className: "bg-orange-50 text-orange-400" },
};

function CircleProgress({ percentage }: { percentage: number }) {
  const r = 13;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percentage / 100) * circ;
  return (
    <div className="flex items-center gap-2">
      <svg width="32" height="32" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r={r} fill="none" stroke="#e5e7eb" strokeWidth="3" />
        {percentage > 0 && (
          <circle cx="16" cy="16" r={r} fill="none" stroke="#3b82f6" strokeWidth="3"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" transform="rotate(-90 16 16)"
          />
        )}
      </svg>
      <span className="text-sm text-gray-700">{percentage}%</span>
    </div>
  );
}

type FilterKey = "all" | "Activo" | "inactivas" | "Por comenzar" | "Borrador";

export default function CuponesPage() {
  const { campaigns } = useCampaigns();
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<Campaign | null>(null);

  const total       = campaigns.length;
  const activas     = campaigns.filter((c) => c.status === "Activo").length;
  const inactivas   = campaigns.filter((c) => ["Inactivo", "Cancelado", "Finalizado"].includes(c.status)).length;
  const porComenzar = campaigns.filter((c) => c.status === "Por comenzar").length;
  const borradores  = campaigns.filter((c) => c.status === "Borrador").length;

  function toggleFilter(key: FilterKey) {
    setActiveFilter((prev) => (prev === key ? "all" : key));
  }

  const filtered = campaigns.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (activeFilter === "all") return true;
    if (activeFilter === "inactivas") return ["Inactivo", "Cancelado", "Finalizado"].includes(c.status);
    return c.status === activeFilter;
  });

  return (
    <div className="p-8 min-h-screen bg-gray-50">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">
            Bienvenido a tu espacio de campañas de cupones
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Gestiona las campañas y cupones asociados para tus clientes
          </p>
        </div>
        <Link
          href="/cupones/crear"
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-full text-sm font-semibold transition-colors whitespace-nowrap shadow-sm"
        >
          Crear nuevo Cupón
          <span className="text-base font-bold leading-none">+</span>
        </Link>
      </div>

      <div className="border-b border-gray-200 mb-6" />

      {/* Filters */}
      <div className="flex items-center justify-end gap-3 mb-6">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Buscar cupones" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 w-52 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 text-gray-700 placeholder-gray-400"
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-full text-sm text-gray-600 bg-white hover:bg-gray-50">
          <CalendarIcon className="w-4 h-4 text-gray-400" /> Fecha de inicio
        </button>
        <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-full text-sm text-gray-600 bg-white hover:bg-gray-50">
          <CalendarIcon className="w-4 h-4 text-gray-400" /> Fecha de fin
        </button>
        <button className="flex items-center gap-2 px-4 py-2 text-sm text-purple-600 hover:text-purple-700 font-medium">
          Actualizar datos
          <RefreshIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <StatCard icon={<TicketIcon className="w-5 h-5 text-purple-500" />} iconBg="bg-purple-100" label="Total campañas" value={total} filterKey="all" activeFilter={activeFilter} onToggle={toggleFilter} />
        <StatCard icon={<CheckIcon className="w-5 h-5 text-green-500" />} iconBg="bg-green-100" label="Activas" value={activas} filterKey="Activo" activeFilter={activeFilter} onToggle={toggleFilter} />
        <StatCard icon={<WarningIcon className="w-5 h-5 text-red-400" />} iconBg="bg-red-100" label="Inactivas" value={inactivas} filterKey="inactivas" activeFilter={activeFilter} onToggle={toggleFilter} />
        <StatCard icon={<ClockIcon className="w-5 h-5 text-gray-400" />} iconBg="bg-gray-100" label="Por comenzar" value={porComenzar} filterKey="Por comenzar" activeFilter={activeFilter} onToggle={toggleFilter} />
        <StatCard icon={<DraftIcon className="w-5 h-5 text-yellow-500" />} iconBg="bg-yellow-50" label="Borradores" value={borradores} filterKey="Borrador" activeFilter={activeFilter} onToggle={toggleFilter} />
      </div>

      {/* Active filter label */}
      {activeFilter !== "all" && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-gray-500">Filtrando por:</span>
          <span className="flex items-center gap-1.5 bg-purple-100 text-purple-700 text-xs font-medium px-3 py-1 rounded-full">
            {activeFilter === "inactivas" ? "Inactivas" : activeFilter}
            <button onClick={() => setActiveFilter("all")} className="hover:text-purple-900">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        </div>
      )}

      {/* Campaign List */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 && (
          <div className="py-16 text-center text-gray-400 text-sm">No se encontraron campañas</div>
        )}
        {filtered.map((campaign, idx) => {
          const percentage = campaign.couponCount > 0
            ? Math.round((campaign.couponsUsed / campaign.couponCount) * 100) : 0;
          return (
            <div key={campaign.id} onClick={() => setSelected(campaign)}
              className={`flex items-center gap-4 px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors ${idx < filtered.length - 1 ? "border-b border-gray-100" : ""}`}
            >
              <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-blue-800 via-blue-700 to-indigo-900 flex items-center justify-center">
                <span className="text-white text-[9px] font-black tracking-tight text-center leading-tight px-1 whitespace-pre-line">
                  {campaign.name.includes("Bienvenida") ? "CUPÓN\nBIENV" : "2X1\nPEPSI"}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm truncate">{campaign.name}</p>
                  {campaign.status === "Borrador" && (
                    <span className="flex-shrink-0 text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full border border-yellow-200">Borrador</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Creado {campaign.createdDate} por {campaign.createdBy}</p>
              </div>

              <div className="w-44">
                {campaign.status !== "Borrador" && (
                  <span className={`inline-block px-3 py-0.5 rounded-full text-xs font-medium ${statusConfig[campaign.status].className}`}>
                    {statusConfig[campaign.status].label}
                  </span>
                )}
                {campaign.startDate && campaign.endDate && (
                  <p className="text-xs text-gray-400 mt-1">{campaign.startDate} - {campaign.endDate}</p>
                )}
              </div>

              <div className="flex items-center gap-1.5 w-28">
                <TicketIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-600">
                  {campaign.couponsUsed.toLocaleString()}/{campaign.couponCount.toLocaleString()}
                </span>
              </div>

              <CircleProgress percentage={percentage} />

              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          );
        })}
        <div className="px-5 py-3 text-center text-sm text-gray-500 border-t border-gray-100">
          Mostrando {filtered.length} de {campaigns.length} resultados
        </div>
      </div>

      {selected && (
        <CampaignDrawer
          campaign={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function StatCard({ icon, iconBg, label, value, filterKey, activeFilter, onToggle }: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: number;
  filterKey: FilterKey;
  activeFilter: FilterKey;
  onToggle: (key: FilterKey) => void;
}) {
  const isActive = activeFilter === filterKey;
  return (
    <button
      onClick={() => onToggle(filterKey)}
      className={`bg-white rounded-2xl border p-4 flex items-center gap-3 shadow-sm text-left w-full transition-all ${
        isActive
          ? "border-purple-400 ring-2 ring-purple-200"
          : "border-gray-200 hover:border-purple-200 hover:shadow-md"
      }`}
    >
      <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div>
        <p className="text-xs text-gray-400 leading-tight mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
      </div>
    </button>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
}
function RefreshIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
}
function TicketIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>;
}
function CheckIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>;
}
function WarningIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
}
function ClockIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function DraftIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>;
}
