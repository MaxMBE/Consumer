"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Campaign, CampaignStatus, useCampaigns, useAuth } from "@/context";

const statusLabel: Record<CampaignStatus, string> = {
  Borrador: "Borrador",
  "Por comenzar": "Por comenzar",
  Activo: "Activo",
  Cancelado: "Cancelado",
  Finalizado: "Finalizado",
  Inactivo: "Inactivo",
};

const statusColor: Record<CampaignStatus, string> = {
  Borrador: "text-yellow-600",
  "Por comenzar": "text-gray-500",
  Activo: "text-green-600",
  Cancelado: "text-red-400",
  Finalizado: "text-gray-500",
  Inactivo: "text-orange-400",
};

interface EditForm {
  startDate: string;
  endDate: string;
  couponCount: string;
  pointsPerCoupon: string;
  artFile: File | null;
  artName: string;
}

interface Props {
  campaign: Campaign;
  onClose: () => void;
}

export default function CampaignDrawer({ campaign, onClose }: Props) {
  const router = useRouter();
  const { confirmCampaign, cancelCampaign, updateCampaign } = useCampaigns();
  const { isAuthenticated } = useAuth();
  const [tab, setTab] = useState<"info" | "config">("info");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    couponCount: String(campaign.couponCount),
    pointsPerCoupon: String(campaign.pointsPerCoupon),
    artFile: null,
    artName: campaign.materialName ?? "",
  });
  const [saving, setSaving] = useState(false);

  const percentage = campaign.couponCount > 0
    ? Math.round((campaign.couponsUsed / campaign.couponCount) * 100)
    : 0;

  const totalPoints = campaign.couponCount * campaign.pointsPerCoupon;
  const usedPoints = campaign.couponsUsed * campaign.pointsPerCoupon;

  const canConfirm = campaign.status === "Borrador";
  const canCancel = campaign.status === "Activo" || campaign.status === "Por comenzar";

  function handleEdit() {
    setEditForm({
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      couponCount: String(campaign.couponCount),
      pointsPerCoupon: String(campaign.pointsPerCoupon),
      artFile: null,
      artName: campaign.materialName ?? "",
    });
    setShowEditModal(true);
  }

  async function handleSaveEdit() {
    setSaving(true);
    await updateCampaign(campaign.id, {
      startDate: editForm.startDate,
      endDate: editForm.endDate,
      couponCount: Number(editForm.couponCount) || 0,
      pointsPerCoupon: Number(editForm.pointsPerCoupon) || 0,
      materialName: editForm.artFile ? editForm.artFile.name : editForm.artName || undefined,
    });
    setSaving(false);
    setShowEditModal(false);
  }

  function handleAnalytics() {
    router.push(`/cupones/${campaign.id}`);
    onClose();
  }

  function handleConfirm() {
    confirmCampaign(campaign.id);
    setShowConfirmDialog(false);
    onClose();
  }

  function handleCancel() {
    cancelCampaign(campaign.id);
    setShowCancelConfirm(false);
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-[560px] bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-7 pt-7 pb-5 border-b border-gray-100">
          <div className="flex items-start justify-between mb-1">
            <div className="flex-1 pr-4">
              <h2 className="text-xl font-bold text-gray-900">{campaign.name}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{campaign.description}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors mt-0.5"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Status badge */}
          {campaign.status === "Borrador" && (
            <span className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 bg-yellow-50 text-yellow-700 text-xs font-medium rounded-full border border-yellow-200">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              Borrador — pendiente de confirmación
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="px-7 py-5 border-b border-gray-100">
          <div className="grid grid-cols-3 gap-4 mb-5">
            <StatMini
              icon={<TicketStatIcon className="w-5 h-5 text-purple-500" />}
              iconBg="bg-purple-50"
              label="Total cupones"
              value={campaign.couponCount.toLocaleString()}
            />
            <StatMini
              icon={<svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              iconBg="bg-green-50"
              label="Canjeados"
              value={campaign.couponsUsed.toLocaleString()}
            />
            <StatMini
              icon={<svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>}
              iconBg="bg-gray-50"
              label="No canjeados"
              value={(campaign.couponCount - campaign.couponsUsed).toLocaleString()}
            />
          </div>

          {/* Tasa de canje */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">Tasa de canje</span>
              <span className="text-xs text-green-500 font-medium">+0% que el día anterior</span>
            </div>
            <div className="relative w-full h-7 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(percentage, percentage > 0 ? 5 : 0)}%` }}
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-white">
                {percentage}%
              </span>
            </div>
          </div>

          {/* Puntos / Quetzales */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {usedPoints.toLocaleString()}/{totalPoints.toLocaleString()}
              </p>
              <p className="text-sm text-gray-400">Puntos</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                Q {usedPoints.toLocaleString()} / {totalPoints.toLocaleString()}
              </p>
              <p className="text-sm text-gray-400">Quetzales</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-7">
          <button
            onClick={() => setTab("info")}
            className={`py-3 mr-6 text-sm font-medium border-b-2 transition-colors ${
              tab === "info"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            Info. general
          </button>
          <button
            onClick={() => setTab("config")}
            className={`py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === "config"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            Configuración
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-7 py-5">
          {tab === "info" ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">
              <InfoField label="Creado por" value={campaign.createdBy} />
              <InfoField
                label="Estado"
                value={
                  <span className={`font-medium ${statusColor[campaign.status]}`}>
                    {statusLabel[campaign.status]}
                  </span>
                }
              />
              <InfoField label="Fecha de inicio" value={campaign.startDate} />
              <InfoField label="Fecha de fin" value={campaign.endDate} />
              {campaign.materialName && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400 mb-1">Material de apoyo</p>
                  <div className="flex items-center gap-2">
                    <button className="text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    <span className="text-sm text-gray-700">{campaign.materialName}</span>
                  </div>
                </div>
              )}
              {campaign.campaignLink && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400 mb-1">link de campaña</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 truncate max-w-xs">{campaign.campaignLink}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(campaign.campaignLink)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-purple-600 transition-colors flex-shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copiar
                    </button>
                  </div>
                </div>
              )}
              {!campaign.campaignLink && campaign.status === "Borrador" && (
                <div className="col-span-2 bg-blue-50 rounded-lg p-3 flex items-center gap-2 text-sm text-blue-600">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Podrás copiar el link de la campaña una vez confirmada.
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">
              <InfoField label="Cantidad de cupones" value={campaign.couponCount.toLocaleString()} />
              <InfoField label="Puntos por cupón" value={campaign.pointsPerCoupon.toLocaleString()} />
              <InfoField label="Pepsi puntos totales" value={totalPoints.toLocaleString()} />
              <InfoField label="Valor de la campaña" value={`${totalPoints.toLocaleString()} Quetzales`} />
              <InfoField label="SKU participantes" value={`${campaign.skuIds.length} producto(s)`} />
              <InfoField label="Título Mundo Pepsi" value={campaign.name} />
              <div className="col-span-2">
                <InfoField label="Instrucciones Tendero" value={campaign.tenderoTitle} />
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-7 py-4 border-t border-gray-100 space-y-2">
          {!isAuthenticated && (
            <p className="text-xs text-center text-gray-400 pb-1">
              <a href="/login" className="text-purple-600 hover:underline font-medium">Iniciá sesión</a> para editar campañas
            </p>
          )}
          <div className="flex items-center gap-3">
            {isAuthenticated && canConfirm && (
              <button
                onClick={() => setShowConfirmDialog(true)}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2.5 rounded-full text-sm font-medium transition-colors"
              >
                Confirmar campaña
              </button>
            )}
            {isAuthenticated && (
              <button
                onClick={handleEdit}
                className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 py-2.5 rounded-full text-sm font-medium transition-colors"
              >
                Editar
              </button>
            )}
            {isAuthenticated && canCancel && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="flex-1 border border-purple-300 hover:bg-purple-50 text-purple-600 py-2.5 rounded-full text-sm font-medium transition-colors"
              >
                Cancelar campaña
              </button>
            )}
          </div>
          {campaign.status !== "Borrador" && (
            <button
              onClick={handleAnalytics}
              className="w-full flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-600 py-2.5 rounded-full text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Ver análisis de funnel
            </button>
          )}
        </div>
      </div>

      {/* Confirm campaign dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
              Confirmar campaña
            </h3>
            <p className="text-sm text-gray-500 text-center mb-5">
              La campaña <strong>{campaign.name}</strong> quedará activa y visible para los usuarios. ¿Confirmar?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 bg-purple-600 text-white py-2.5 rounded-full text-sm font-medium hover:bg-purple-700 transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit campaign modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowEditModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900">Editar campaña</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Fechas */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Fecha de inicio</label>
                  <input
                    type="date"
                    value={editForm.startDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
                    className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Fecha de término</label>
                  <input
                    type="date"
                    value={editForm.endDate}
                    min={editForm.startDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                    className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors"
                  />
                </div>
              </div>

              {/* Cupones y valor */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Cantidad de cupones</label>
                  <input
                    type="number"
                    value={editForm.couponCount}
                    onChange={(e) => setEditForm((f) => ({ ...f, couponCount: e.target.value }))}
                    placeholder="0"
                    className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Valor por cupón (pts)</label>
                  <input
                    type="number"
                    value={editForm.pointsPerCoupon}
                    onChange={(e) => setEditForm((f) => ({ ...f, pointsPerCoupon: e.target.value }))}
                    placeholder="0"
                    className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors"
                  />
                </div>
              </div>

              {/* Monto calculado */}
              {editForm.couponCount && editForm.pointsPerCoupon && (
                <div className="bg-purple-50 rounded-lg px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-purple-600 font-medium">Monto total campaña</span>
                  <span className="text-sm font-bold text-purple-700">
                    Q {(Number(editForm.couponCount) * Number(editForm.pointsPerCoupon)).toLocaleString()}
                  </span>
                </div>
              )}

              {/* Arte */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">Arte de campaña</label>
                <div className="border border-dashed border-gray-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      {editForm.artFile ? editForm.artFile.name : editForm.artName || "Sin arte seleccionado"}
                    </p>
                    <p className="text-xs text-gray-400">Formato: png, jpg</p>
                  </div>
                  <label className="px-4 py-1.5 border border-gray-300 rounded-full text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50 transition-colors">
                    {editForm.artFile || editForm.artName ? "Cambiar" : "Subir"}
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setEditForm((f) => ({ ...f, artFile: file, artName: file?.name ?? f.artName }));
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowEditModal(false)}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex-1 bg-purple-600 text-white py-2.5 rounded-full text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-60"
              >
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel campaign dialog */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
              Cancelar campaña
            </h3>
            <p className="text-sm text-gray-500 text-center mb-5">
              ¿Estás seguro que deseas cancelar <strong>{campaign.name}</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Volver
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 bg-red-500 text-white py-2.5 rounded-full text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatMini({ icon, iconBg, label, value }: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center`}>
        {icon}
      </div>
      <p className="text-xs text-gray-400 text-center leading-tight">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm text-gray-800 font-medium">{value}</p>
    </div>
  );
}

function TicketStatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
    </svg>
  );
}
