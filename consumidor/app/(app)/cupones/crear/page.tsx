"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Stepper, MundoPepsiPreview, PepsiChatPreview, SKUModal } from "@/components/cupones";
import { useCampaigns, CampaignStatus } from "@/context";

interface FormData {
  // Step 1 - Mundo Pepsi
  shopperTitle: string;
  shopperDescription: string;
  shopperImage: File | null;

  // Step 2 - Pepsi Chat
  tenderoTitle: string;
  tenderoDescription: string;
  tenderoImage: File | null;

  // Step 3 - Configuración
  startDate: string;
  endDate: string;
  couponCount: string;
  pointsPerCoupon: string;
  skuIds: string[];
}

const INITIAL_FORM: FormData = {
  shopperTitle: "",
  shopperDescription: "",
  shopperImage: null,
  tenderoTitle: "",
  tenderoDescription: "",
  tenderoImage: null,
  startDate: "",
  endDate: "",
  couponCount: "",
  pointsPerCoupon: "",
  skuIds: [],
};

function canContinue(step: number, form: FormData): boolean {
  if (step === 1) return form.shopperTitle.trim().length > 0;
  if (step === 2) return form.tenderoTitle.trim().length > 0;
  if (step === 3) return form.startDate !== "" && form.endDate !== "" && form.couponCount !== "" && form.pointsPerCoupon !== "";
  return true;
}

function deriveStatus(startDate: string): CampaignStatus {
  if (!startDate) return "Por comenzar";
  return new Date(startDate) > new Date() ? "Por comenzar" : "Activo";
}

export default function CrearCuponPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-gray-400 text-sm">Cargando...</div>}>
      <CrearCuponForm />
    </Suspense>
  );
}

function CrearCuponForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { campaigns, addCampaign, updateCampaign } = useCampaigns();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [showSKUModal, setShowSKUModal] = useState(false);

  // Pre-fill form when editing
  useEffect(() => {
    if (!editId) return;
    const campaign = campaigns.find((c) => c.id === editId);
    if (!campaign) return;
    setForm({
      shopperTitle: campaign.name,
      shopperDescription: campaign.description,
      shopperImage: null,
      tenderoTitle: campaign.tenderoTitle,
      tenderoDescription: campaign.tenderoDescription,
      tenderoImage: null,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      couponCount: String(campaign.couponCount),
      pointsPerCoupon: String(campaign.pointsPerCoupon),
      skuIds: campaign.skuIds,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleImageUpload(key: "shopperImage" | "tenderoImage", e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    update(key, file);
  }

  function saveCampaign(status: CampaignStatus) {
    const data = {
      name: form.shopperTitle,
      description: form.shopperDescription,
      status,
      startDate: form.startDate,
      endDate: form.endDate,
      couponCount: Number(form.couponCount) || 0,
      pointsPerCoupon: Number(form.pointsPerCoupon) || 0,
      skuIds: form.skuIds,
      tenderoTitle: form.tenderoTitle,
      tenderoDescription: form.tenderoDescription,
      materialName: form.shopperImage?.name ?? form.tenderoImage?.name ?? undefined,
    };
    if (editId) {
      updateCampaign(editId, data);
    } else {
      addCampaign(data);
    }
    router.push("/cupones");
  }

  const taskDays =
    form.startDate && form.endDate
      ? Math.max(0, Math.floor((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 86400000))
      : 0;

  const totalPoints = Number(form.couponCount || 0) * Number(form.pointsPerCoupon || 0);

  const tag = form.startDate
    ? `puntos_campaña_cupones_<${new Date(form.startDate).getFullYear()}><${String(new Date(form.startDate).getMonth() + 1).padStart(2, "0")}><${String(new Date(form.startDate).getDate()).padStart(2, "0")}>_<ID>`
    : "";

  const canGo = canContinue(step, form);
  const isLastStep = step === 4;
  const isEditing = !!editId;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Link href="/cupones" className="hover:text-purple-600 transition-colors">Cupones</Link>
            <span>›</span>
            <span className="text-gray-600">{isEditing ? "Editar" : "Crear"}</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {isEditing ? "Editar cupón" : "Crear nuevo cupón"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/cupones" className="px-5 py-2 border border-gray-300 rounded-full text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </Link>
          {isLastStep ? (
            <>
              <button
                onClick={() => saveCampaign("Borrador")}
                className="px-5 py-2 border border-purple-300 text-purple-600 rounded-full text-sm font-medium hover:bg-purple-50 transition-colors"
              >
                Guardar borrador
              </button>
              <button
                onClick={() => saveCampaign(deriveStatus(form.startDate))}
                disabled={!canGo}
                className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${
                  canGo ? "bg-purple-600 text-white hover:bg-purple-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                Confirmar campaña
              </button>
            </>
          ) : (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canGo}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${
                canGo ? "bg-purple-600 text-white hover:bg-purple-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              Continuar
            </button>
          )}
        </div>
      </div>

      {/* Stepper */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <Stepper currentStep={step} />
      </div>

      {/* Content */}
      <div className="flex-1 px-8 py-6 max-w-6xl mx-auto w-full">
        {step === 1 && (
          <StepMundoPepsi form={form} update={update} onImageUpload={(e) => handleImageUpload("shopperImage", e)} />
        )}
        {step === 2 && (
          <StepPepsiChat form={form} update={update} onImageUpload={(e) => handleImageUpload("tenderoImage", e)} />
        )}
        {step === 3 && (
          <StepConfiguracion
            form={form}
            update={update}
            taskDays={taskDays}
            tag={tag}
            totalPoints={totalPoints}
            onOpenSKU={() => setShowSKUModal(true)}
          />
        )}
        {step === 4 && <StepAsignacion />}
      </div>

      {/* Info banner */}
      {(step === 3 || step === 4) && (
        <div className="px-8 pb-4">
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-5 py-3 flex items-center gap-2 text-sm text-blue-700 max-w-6xl mx-auto">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Podrás copiar el link de la campaña desde el detalle una vez creada.
          </div>
        </div>
      )}

      {/* SKU Modal */}
      {showSKUModal && (
        <SKUModal
          selected={form.skuIds}
          onSave={(ids) => {
            update("skuIds", ids);
            setShowSKUModal(false);
          }}
          onClose={() => setShowSKUModal(false)}
        />
      )}
    </div>
  );
}

/* ─── Step 1: Mundo Pepsi ─── */
function StepMundoPepsi({
  form,
  update,
  onImageUpload,
}: {
  form: FormData;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Left - Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Instrucciones Shopper</h2>
        <p className="text-sm text-gray-500 mb-5">
          Ingresa el título y las instrucciones de este cupón. Esta información será la que verán los Shoppers cuando lo canjeen.
        </p>

        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">Título de la campaña</label>
          <input
            type="text"
            value={form.shopperTitle}
            onChange={(e) => update("shopperTitle", e.target.value)}
            placeholder="Título de la campaña"
            className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors"
          />
        </div>

        <div className="mb-5">
          <label className="block text-xs text-gray-400 mb-1">Texto de la promoción</label>
          <textarea
            value={form.shopperDescription}
            onChange={(e) => update("shopperDescription", e.target.value)}
            placeholder="Texto de la promoción"
            maxLength={300}
            rows={4}
            className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent resize-none transition-colors"
          />
          <p className="text-right text-xs text-gray-400">{form.shopperDescription.length}/300</p>
        </div>

        <div className="border border-dashed border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">
                {form.shopperImage ? form.shopperImage.name : "Material de apoyo"}
              </p>
              <p className="text-xs text-gray-400">Formato permitido: png, jpg,</p>
            </div>
            <label className="px-4 py-1.5 border border-gray-300 rounded-full text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50 transition-colors">
              {form.shopperImage ? "Editar" : "Subir"}
              <input type="file" accept=".png,.jpg,.jpeg" className="hidden" onChange={onImageUpload} />
            </label>
          </div>
        </div>
      </div>

      {/* Right - Preview */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Mundo pepsi</h2>
        <MundoPepsiPreview
          title={form.shopperTitle}
          description={form.shopperDescription}
          imageFile={form.shopperImage}
        />
      </div>
    </div>
  );
}

/* ─── Step 2: Pepsi Chat ─── */
function StepPepsiChat({
  form,
  update,
  onImageUpload,
}: {
  form: FormData;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Left */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Instrucciones Tendero</h2>
        <p className="text-sm text-gray-500 mb-5">
          Ingresa el título y las instrucciones del canje, los Tenderos verán esta información en Pepsi Chat
        </p>

        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">
            Título de la campaña {form.tenderoTitle.length}/180
          </label>
          <input
            type="text"
            value={form.tenderoTitle}
            onChange={(e) => update("tenderoTitle", e.target.value.slice(0, 180))}
            placeholder="Título de la campaña 0/180"
            className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors"
          />
        </div>

        <div className="mb-5">
          <label className="block text-xs text-gray-400 mb-1">Texto de la promoción</label>
          <textarea
            value={form.tenderoDescription}
            onChange={(e) => update("tenderoDescription", e.target.value)}
            placeholder="Texto de la promoción"
            maxLength={300}
            rows={4}
            className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent resize-none transition-colors"
          />
          <p className="text-right text-xs text-gray-400">{form.tenderoDescription.length}/300</p>
        </div>

        <div className="border border-dashed border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">
                {form.tenderoImage ? form.tenderoImage.name : "Material de apoyo"}
              </p>
              <p className="text-xs text-gray-400">Formato permitido: png, jpg,</p>
            </div>
            <label className="px-4 py-1.5 border border-gray-300 rounded-full text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50 transition-colors">
              {form.tenderoImage ? "Editar" : "Subir"}
              <input type="file" accept=".png,.jpg,.jpeg" className="hidden" onChange={onImageUpload} />
            </label>
          </div>
        </div>
      </div>

      {/* Right - Preview */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Pepsi Chat</h2>
        <PepsiChatPreview
          title={form.tenderoTitle}
          description={form.tenderoDescription}
          imageFile={form.tenderoImage}
        />
        <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm text-blue-600">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Puntos y fecha se configura en el paso siguiente
        </div>
      </div>
    </div>
  );
}

/* ─── Step 3: Configuración ─── */
function StepConfiguracion({
  form,
  update,
  taskDays,
  tag,
  totalPoints,
  onOpenSKU,
}: {
  form: FormData;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  taskDays: number;
  tag: string;
  totalPoints: number;
  onOpenSKU: () => void;
}) {
  const hasSKUs = form.skuIds.length > 0;

  return (
    <div className="space-y-5">
      {/* Vigencia */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Vigencia del cupón</h2>
        <p className="text-sm text-gray-500 mb-5">Selecciona tiempo de vigencia del cupón.</p>

        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <label className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {form.startDate ? "Fecha de inicio" : "Fecha de inicio"}
            </label>
            <div className="relative">
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => update("startDate", e.target.value)}
                className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors appearance-none"
              />
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {form.endDate ? "Fecha fin" : "Fecha fin"}
            </label>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => update("endDate", e.target.value)}
              min={form.startDate}
              className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors appearance-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Tiempo de la tarea: {taskDays} días
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Tag (autogenerado)</label>
          <input
            type="text"
            value={tag}
            readOnly
            placeholder="Tag (autogenerado)"
            className="w-full border-b border-gray-200 outline-none text-sm py-2 bg-transparent text-gray-400 cursor-default"
          />
        </div>
      </div>

      {/* Configuración de cupones */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Configuración de cupones</h2>
        <p className="text-sm text-gray-500 mb-5">
          Establece los productos participantes, la cantidad de cupones y las condiciones de puntos de la campaña.
        </p>

        <div className="grid grid-cols-2 gap-6 mb-5">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cantidad de cupones</label>
            <input
              type="number"
              value={form.couponCount}
              onChange={(e) => update("couponCount", e.target.value)}
              placeholder="Cantidad de cupones"
              className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Valor de pepsi puntos por cupón</label>
            <input
              type="number"
              value={form.pointsPerCoupon}
              onChange={(e) => update("pointsPerCoupon", e.target.value)}
              placeholder="Valor de pepsi puntos por cupón"
              className="w-full border-b border-gray-300 focus:border-purple-500 outline-none text-sm py-2 bg-transparent transition-colors"
            />
          </div>
        </div>

        {/* Calculated */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
            <p className="text-xs text-purple-500 font-medium mb-1">Pepsi puntos por campañas</p>
            <p className="text-xl font-bold text-gray-900">
              {totalPoints > 0 ? totalPoints.toLocaleString() : "—"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Puntos</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
            <p className="text-xs text-purple-500 font-medium mb-1">Valor de la campaña</p>
            <p className="text-xl font-bold text-gray-900">
              {totalPoints > 0 ? totalPoints.toLocaleString() : "—"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Quetzales</p>
          </div>
        </div>

        {/* SKU */}
        <div className="flex items-center justify-between py-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            {hasSKUs ? (
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span className="text-sm font-medium text-gray-700">
              SKU participantes
              {hasSKUs && (
                <span className="text-gray-500 font-normal"> / {form.skuIds.length} productos</span>
              )}
            </span>
          </div>
          <button
            onClick={onOpenSKU}
            className="px-5 py-1.5 border border-gray-300 rounded-full text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {hasSKUs ? "Editar" : "Seleccionar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Step 4: Asignación ─── */
function StepAsignacion() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
      <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Asignación</h2>
      <p className="text-gray-500 text-sm">Configura a quién se asignará esta campaña de cupones.</p>
    </div>
  );
}
