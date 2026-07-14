import { Link, useLocation, Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import {
  Users,
  UserPlus,
  ClipboardList,
  LogOut,
  Home,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout, isAdmin, isSetter } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="animate-spin h-8 w-8 border-4 border-slate-900 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const navItems = [
    // Sprint 2: para el setter, la tabla de leads reemplaza al Dashboard —
    // no tiene sentido dejar un link que solo rebota para otro lado.
    ...(isSetter ? [] : [{ href: "/", label: "Dashboard", icon: Home }]),
    ...(isAdmin ? [{ href: "/usuarios", label: "Usuarios", icon: Users }] : []),
    { href: "/leads", label: "Leads", icon: UserPlus },
    // Event Log es una vista de auditoria global — no aporta al centro
    // operativo del setter (su tabla + el detalle de cada lead). Sigue
    // existiendo para ADMIN/MANAGER, solo se saca del nav del setter.
    ...(isSetter ? [] : [{ href: "/event-log", label: "Event Log", icon: ClipboardList }]),
  ];

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-white">
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-xl font-bold tracking-tight">OPERAL OS</h1>
          <p className="text-xs text-slate-400 mt-1">Sprint 1 — v0.1</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const active = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-semibold">
              {user.nombre.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.nombre}</p>
              <p className="text-xs text-slate-400 capitalize">{user.rol.toLowerCase()}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 mt-2 text-sm text-slate-400 hover:text-white transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-slate-900 text-white">
        <div className="flex items-center justify-between p-4">
          <h1 className="text-lg font-bold">OPERAL OS</h1>
          <button onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {mobileOpen && (
          <nav className="px-4 pb-4 space-y-1">
            {navItems.map((item) => {
              const active = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    active
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
            <button
              onClick={logout}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 w-full"
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesión
            </button>
          </nav>
        )}
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-auto pt-16 md:pt-0">
        <div className="p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
