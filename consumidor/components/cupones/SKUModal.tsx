"use client";

import { useState } from "react";

interface Product {
  id: string;
  name: string;
  sku: string;
}

const products: Product[] = [
  { id: "1", name: "Pepsi 355 ML PET * 112CJ", sku: "AA685001" },
  { id: "2", name: "Pepsi 1250 ml Pet x 12", sku: "AA829001" },
  { id: "3", name: "8 Pack 12 Onz Lata Pepsi Sabores Surt V2", sku: "AA685001" },
  { id: "4", name: "Pepsi 2.25 LT PET*8 RECO", sku: "BA010902" },
  { id: "5", name: "Pepsi Light Splenda 600 ML PET *24", sku: "BA000448" },
  { id: "6", name: "8Pk Pepsi 12 Onz Lata", sku: "BA007775" },
  { id: "7", name: "24 Pack Lata Pepsi + Salutaris surt", sku: "BA014468" },
  { id: "8", name: "24 Pk Pepsi 355 Ml Pet PS", sku: "BA019039" },
  { id: "9", name: "Pepsi Zero 2L PET x 6", sku: "BA021100" },
  { id: "10", name: "Pepsi Cola 500ml PET x 24", sku: "BA033201" },
];

interface Props {
  selected: string[];
  onSave: (selected: string[]) => void;
  onClose: () => void;
}

export default function SKUModal({ selected, onSave, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [localSelected, setLocalSelected] = useState<string[]>(selected);

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(id: string) {
    setLocalSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const hasSelection = localSelected.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="w-[520px] bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Selección de Productos</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full px-4 py-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none text-purple-600 placeholder-gray-400"
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((product, idx) => {
            const isChecked = localSelected.includes(product.id);
            return (
              <div
                key={product.id}
                onClick={() => toggle(product.id)}
                className={`flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                  idx < filtered.length - 1 ? "border-b border-gray-100" : ""
                }`}
              >
                <div
                  className={`w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-colors ${
                    isChecked
                      ? "bg-purple-600 border-purple-600"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  {isChecked && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="flex-1 text-sm text-gray-800">{product.name}</span>
                <span className="text-sm text-gray-400 font-mono">{product.sku}</span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
          <span className="text-sm text-gray-600">
            {localSelected.length} SKU seleccionados
          </span>
          <button
            onClick={() => onSave(localSelected)}
            disabled={!hasSelection}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${
              hasSelection
                ? "bg-purple-600 text-white hover:bg-purple-700"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
