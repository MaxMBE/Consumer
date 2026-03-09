"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context";

const PUBLIC_ITEMS = [
  { label: "Análisis Funnel", href: "/analisis-funnel", icon: "📊" },
];

const PRIVATE_ITEMS = [
  { label: "Pepsi Cupones", href: "/cupones", icon: "🎫" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, signOut } = useAuth();

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  const displayName = user?.email ?? "Visitante";
  const displayRole = isAuthenticated ? "Administrador" : "Solo lectura";

  const handleLogout = async () => {
    await signOut();
    router.push("/cupones");
  };

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
        {[...PUBLIC_ITEMS, ...(isAuthenticated ? PRIVATE_ITEMS : [])].map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
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
      </nav>

      {/* User / Auth */}
      <div className="px-5 py-4 border-t border-gray-100">
        {isAuthenticated ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold text-purple-700 flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">{displayName}</p>
              <p className="text-xs text-gray-500">{displayRole}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              className="text-gray-400 hover:text-red-500 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-400 flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">Solo lectura</p>
            </div>
            <Link
              href="/login"
              className="text-xs font-medium text-purple-600 hover:text-purple-700"
            >
              Ingresar
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
