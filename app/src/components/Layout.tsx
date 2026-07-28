import { Link, useLocation, Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Users,
  UserPlus,
  ClipboardList,
  LogOut,
  Home,
  Menu,
  X,
  Phone,
  CalendarDays,
} from "lucide-react";
import { useState } from "react";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout, isAdmin, isSetter } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-foreground border-t-transparent rounded-full" />
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
    // Sprint 4: fase de llamada -- solo ADMIN, el setter no participa de
    // esta fase (ver 02_reglas_de_negocio.md seccion 7). El guard real esta
    // en la pagina (Llamadas.tsx) y en el backend; esto solo oculta el link.
    ...(isAdmin ? [{ href: "/llamadas", label: "Llamadas", icon: Phone }] : []),
    // Sprint 5: integracion con Google Calendar -- a diferencia de
    // /llamadas, esto SI participa el setter (agenda en C/D junto al
    // admin), asi que no va gateado por isAdmin.
    { href: "/calendario", label: "Calendario", icon: CalendarDays },
    // Event Log es una vista de auditoria global — no aporta al centro
    // operativo del setter (su tabla + el detalle de cada lead). Sigue
    // existiendo para ADMIN/MANAGER, solo se saca del nav del setter.
    ...(isSetter ? [] : [{ href: "/event-log", label: "Event Log", icon: ClipboardList }]),
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-sidebar text-sidebar-foreground">
        <div className="p-6 border-b border-sidebar-border">
          <h1 className="text-xl font-bold tracking-tight">OPERAL OS</h1>
          <p className="text-xs text-sidebar-foreground/60 mt-1">Sprint 1 — v0.1</p>
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
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-semibold">
              {user.nombre.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.nombre}</p>
              <p className="text-xs text-sidebar-foreground/60 capitalize">{user.rol.toLowerCase()}</p>
            </div>
            <ThemeToggle className="flex items-center justify-center w-8 h-8 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors flex-shrink-0" />
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 mt-2 text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-sidebar text-sidebar-foreground">
        <div className="flex items-center justify-between p-4">
          <h1 className="text-lg font-bold">OPERAL OS</h1>
          <div className="flex items-center gap-1">
            <ThemeToggle className="flex items-center justify-center w-8 h-8 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors" />
            <button onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
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
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
            <button
              onClick={logout}
              className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/70 w-full"
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesión
            </button>
          </nav>
        )}
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-auto pt-16 md:pt-0 bg-background text-foreground">
        <div className="p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
