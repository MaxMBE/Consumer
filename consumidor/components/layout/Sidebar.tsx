"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  {
    section: "Monitoreo",
    items: [{ label: "Historial de pedidos", href: "/historial", icon: "🕐" }],
  },
  {
    section: "Gestión digital",
    items: [
      { label: "Pepsi Chat", href: "/pepsi-chat", icon: "💬" },
      { label: "Preventa", href: "/preventa", icon: "🏷️" },
      { label: "Perfilamiento", href: "/perfilamiento", icon: "👤" },
      { label: "Pepsi Cupones", href: "/cupones", icon: "🎫" },
      { label: "Análisis Funnel", href: "/analisis-funnel", icon: "📊" },
    ],
  },
  {
    section: "Administración",
    items: [
      { label: "Usuarios", href: "/usuarios", icon: "👥" },
      { label: "Rutas", href: "/rutas", icon: "🗺️" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 min-h-screen bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <Image
          src="/wolvex-logo.svg"
          alt="Wolvex Platform"
          width={130}
          height={31}
          priority
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {navItems.map((group) => (
          <div key={group.section} className="mb-4">
            <p className="px-5 py-1 text-xs font-medium text-gray-400 uppercase tracking-wider">
              {group.section}
            </p>
            {group.items.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "bg-purple-50 text-purple-700 font-medium border-r-2 border-purple-600"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-5 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
            JG
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              Javier Gonzales
            </p>
            <p className="text-xs text-gray-500">Administrador</p>
          </div>
          <button className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
