"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";

export type CampaignStatus =
  | "Borrador"
  | "Por comenzar"
  | "Activo"
  | "Cancelado"
  | "Finalizado"
  | "Inactivo";

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  createdBy: string;
  createdDate: string;
  startDate: string;
  endDate: string;
  couponCount: number;
  pointsPerCoupon: number;
  skuIds: string[];
  couponsUsed: number;
  tenderoTitle: string;
  tenderoDescription: string;
  materialName?: string;
  campaignLink: string;
}

interface CampaignsContextType {
  campaigns: Campaign[];
  loading: boolean;
  addCampaign: (data: Omit<Campaign, "id" | "createdDate" | "createdBy" | "couponsUsed" | "campaignLink">) => Promise<string>;
  updateCampaign: (id: string, updates: Partial<Campaign>) => Promise<void>;
  confirmCampaign: (id: string) => Promise<void>;
  cancelCampaign: (id: string) => Promise<void>;
}

const CampaignsContext = createContext<CampaignsContextType | null>(null);

// ─── DB row ↔ Campaign mapping ─────────────────────────────────────────────

function rowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    status: row.status as CampaignStatus,
    createdBy: (row.created_by as string) ?? "USER_TRADER_PROD",
    createdDate: (row.created_date as string) ?? "",
    startDate: (row.start_date as string) ?? "",
    endDate: (row.end_date as string) ?? "",
    couponCount: (row.coupon_count as number) ?? 0,
    pointsPerCoupon: (row.points_per_coupon as number) ?? 0,
    skuIds: (row.sku_ids as string[]) ?? [],
    couponsUsed: (row.coupons_used as number) ?? 0,
    tenderoTitle: (row.tendero_title as string) ?? "",
    tenderoDescription: (row.tendero_description as string) ?? "",
    materialName: row.material_name as string | undefined,
    campaignLink: (row.campaign_link as string) ?? "",
  };
}

function campaignToRow(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    created_by: c.createdBy,
    created_date: c.createdDate,
    start_date: c.startDate,
    end_date: c.endDate,
    coupon_count: c.couponCount,
    points_per_coupon: c.pointsPerCoupon,
    sku_ids: c.skuIds,
    coupons_used: c.couponsUsed,
    tendero_title: c.tenderoTitle,
    tendero_description: c.tenderoDescription,
    material_name: c.materialName ?? null,
    campaign_link: c.campaignLink,
  };
}

function deriveStatus(startDate: string): CampaignStatus {
  if (!startDate) return "Por comenzar";
  const now = new Date();
  const start = new Date(startDate);
  return start > now ? "Por comenzar" : "Activo";
}

// ─── Seed data (se inserta solo si la tabla está vacía) ───────────────────

const SEED: Campaign[] = [
  {
    id: "1", name: "2X1 Pepsi 355ML",
    description: "Por la compra de 2 latas de Pepsi 355 ml, llévate 1 adicional gratis.",
    status: "Activo", createdBy: "USER_TRADER_PROD", createdDate: "2026-02-27",
    startDate: "2026-02-28", endDate: "2026-03-06", couponCount: 500, pointsPerCoupon: 10,
    skuIds: ["1"], couponsUsed: 0, tenderoTitle: "Entrega 1 Pepsi gratis por la compra de 2",
    tenderoDescription: "Por la compra de 2 latas de Pepsi 350 ml, entrega 1 Pepsi adicional sin costo al cliente.",
    materialName: "whatsapp-image-2026-02-26.jpeg",
    campaignLink: "https://gui0landing0shopper0pr.../campaign/1",
  },
  {
    id: "2", name: "Cúpon de Bienvenida",
    description: "Bienvenido a Pepsi Cupones. Canjea tu primer cupón.",
    status: "Activo", createdBy: "USER_TRADER_PROD", createdDate: "2026-02-12",
    startDate: "2026-03-02", endDate: "2026-03-26", couponCount: 2000, pointsPerCoupon: 5,
    skuIds: ["1", "2"], couponsUsed: 0, tenderoTitle: "Cupón de bienvenida para nuevos clientes",
    tenderoDescription: "Entrega este cupón a clientes nuevos.",
    campaignLink: "https://gui0landing0shopper0pr.../campaign/2",
  },
  {
    id: "3", name: "Cúpon de Bienvenida",
    description: "Bienvenido a Pepsi Cupones. Canjea tu primer cupón.",
    status: "Activo", createdBy: "USER_TRADER_PROD", createdDate: "2026-02-12",
    startDate: "2026-03-02", endDate: "2026-03-26", couponCount: 2000, pointsPerCoupon: 5,
    skuIds: ["1"], couponsUsed: 0, tenderoTitle: "Cupón de bienvenida",
    tenderoDescription: "Entrega este cupón a clientes nuevos.",
    campaignLink: "https://gui0landing0shopper0pr.../campaign/3",
  },
  {
    id: "4", name: "Cúpon de Bienvenida",
    description: "Bienvenido a Pepsi Cupones. Canjea tu primer cupón.",
    status: "Activo", createdBy: "USER_TRADER_PROD", createdDate: "2026-02-12",
    startDate: "2026-03-02", endDate: "2026-03-26", couponCount: 2000, pointsPerCoupon: 5,
    skuIds: ["2"], couponsUsed: 0, tenderoTitle: "Cupón de bienvenida",
    tenderoDescription: "Entrega este cupón a clientes nuevos.",
    campaignLink: "https://gui0landing0shopper0pr.../campaign/4",
  },
  {
    id: "5", name: "2X1 Pepsi 355ML",
    description: "Por la compra de 2 latas de Pepsi 355 ml, llévate 1 adicional gratis.",
    status: "Cancelado", createdBy: "USER_TRADER_PROD", createdDate: "2026-02-27",
    startDate: "2026-02-27", endDate: "2026-03-06", couponCount: 500, pointsPerCoupon: 10,
    skuIds: ["1"], couponsUsed: 0, tenderoTitle: "Entrega 1 Pepsi gratis por la compra de 2",
    tenderoDescription: "Por la compra de 2 latas de Pepsi 350 ml.",
    campaignLink: "https://gui0landing0shopper0pr.../campaign/5",
  },
  {
    id: "6", name: "Oferta Primavera", description: "Campaña de primavera en borrador.",
    status: "Borrador", createdBy: "USER_TRADER_PROD", createdDate: "2026-03-01",
    startDate: "2026-04-01", endDate: "2026-04-30", couponCount: 1000, pointsPerCoupon: 20,
    skuIds: [], couponsUsed: 0, tenderoTitle: "Oferta primavera para tenderos",
    tenderoDescription: "Instrucciones de la oferta de primavera.", campaignLink: "",
  },
  {
    id: "7", name: "Verano 2026", description: "Campaña de verano próxima a iniciar.",
    status: "Por comenzar", createdBy: "USER_TRADER_PROD", createdDate: "2026-03-01",
    startDate: "2026-04-15", endDate: "2026-05-15", couponCount: 3000, pointsPerCoupon: 15,
    skuIds: ["1", "3"], couponsUsed: 0, tenderoTitle: "Campaña verano 2026",
    tenderoDescription: "Instrucciones de la campaña de verano.",
    campaignLink: "https://gui0landing0shopper0pr.../campaign/7",
  },
  {
    id: "8", name: "Promo Navidad", description: "Campaña navideña finalizada.",
    status: "Finalizado", createdBy: "USER_TRADER_PROD", createdDate: "2025-12-01",
    startDate: "2025-12-01", endDate: "2025-12-31", couponCount: 1000, pointsPerCoupon: 50,
    skuIds: ["1", "2"], couponsUsed: 800, tenderoTitle: "Promo navidad",
    tenderoDescription: "Campaña navidad.",
    campaignLink: "https://gui0landing0shopper0pr.../campaign/8",
  },
  {
    id: "9", name: "Oferta Invierno", description: "Campaña de invierno inactiva.",
    status: "Inactivo", createdBy: "USER_TRADER_PROD", createdDate: "2026-01-10",
    startDate: "2026-01-15", endDate: "2026-02-15", couponCount: 1000, pointsPerCoupon: 12,
    skuIds: ["2"], couponsUsed: 120, tenderoTitle: "Oferta invierno",
    tenderoDescription: "Campaña invierno.",
    campaignLink: "https://gui0landing0shopper0pr.../campaign/9",
  },
];

export function CampaignsProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) { console.error("Error loading campaigns:", error); setLoading(false); return; }

      if (data && data.length > 0) {
        setCampaigns(data.map(rowToCampaign));
      } else {
        const rows = SEED.map(campaignToRow);
        const { error: seedErr } = await supabase.from("campaigns").insert(rows);
        if (!seedErr) setCampaigns(SEED);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function addCampaign(
    data: Omit<Campaign, "id" | "createdDate" | "createdBy" | "couponsUsed" | "campaignLink">
  ): Promise<string> {
    const id = `camp-${Date.now()}`;
    const link = data.status !== "Borrador"
      ? `https://gui0landing0shopper0pr.../campaign/${id}`
      : "";
    const newCampaign: Campaign = {
      ...data, id,
      createdDate: new Date().toISOString().split("T")[0],
      createdBy: "USER_TRADER_PROD",
      couponsUsed: 0,
      campaignLink: link,
    };
    await supabase.from("campaigns").insert(campaignToRow(newCampaign));
    setCampaigns((prev) => [newCampaign, ...prev]);
    return id;
  }

  async function updateCampaign(id: string, updates: Partial<Campaign>): Promise<void> {
    const current = campaigns.find((c) => c.id === id);
    if (!current) return;
    const updated = { ...current, ...updates };
    await supabase.from("campaigns").update(campaignToRow(updated)).eq("id", id);
    setCampaigns((prev) => prev.map((c) => (c.id === id ? updated : c)));
  }

  async function confirmCampaign(id: string): Promise<void> {
    const current = campaigns.find((c) => c.id === id);
    if (!current) return;
    const newStatus = deriveStatus(current.startDate);
    const updated = {
      ...current,
      status: newStatus,
      campaignLink: `https://gui0landing0shopper0pr.../campaign/${id}`,
    };
    await supabase.from("campaigns").update(campaignToRow(updated)).eq("id", id);
    setCampaigns((prev) => prev.map((c) => (c.id === id ? updated : c)));
  }

  async function cancelCampaign(id: string): Promise<void> {
    await supabase.from("campaigns").update({ status: "Cancelado" }).eq("id", id);
    setCampaigns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "Cancelado" } : c))
    );
  }

  return (
    <CampaignsContext.Provider
      value={{ campaigns, loading, addCampaign, updateCampaign, confirmCampaign, cancelCampaign }}
    >
      {children}
    </CampaignsContext.Provider>
  );
}

export function useCampaigns() {
  const ctx = useContext(CampaignsContext);
  if (!ctx) throw new Error("useCampaigns must be used within CampaignsProvider");
  return ctx;
}
