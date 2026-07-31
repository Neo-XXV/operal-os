import { Link, useLocation, Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  Sparkles,
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
    // Dashboards individuales: el setter ve el suyo (02_reglas_de_negocio.md
    // seccion 10) -- la landing sigue siendo /leads, esto es un link nuevo,
    // no un reemplazo.
    ...(isSetter && user ? [{ href: `/dashboard/setter/${user.id}`, label: "Mi Dashboard", icon: Home }] : []),
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
    // Fase B: UI de la capa de IA -- solo ADMIN, igual que los 4 endpoints
    // que consume (docs/10_arquitectura_ia.md: el unico consumidor es el admin).
    ...(isAdmin ? [{ href: "/ia", label: "Inteligencia", icon: Sparkles }] : []),
    // Event Log es una vista de auditoria global — no aporta al centro
    // operativo del setter (su tabla + el detalle de cada lead). Sigue
    // existiendo para ADMIN/MANAGER, solo se saca del nav del setter.
    ...(isSetter ? [] : [{ href: "/event-log", label: "Event Log", icon: ClipboardList }]),
  ];

  return (
    // Sin bg-background: el contenedor tiene que ser transparente para que
    // se vea la malla de gradientes del body, que es lo que el
    // backdrop-blur de los paneles desenfoca.
    <div className="flex h-screen">
      {/* Sidebar compacta icon-first (desktop). El label vive en el tooltip,
          no en la barra: la navegacion no compite por ancho con el contenido
          operativo, que es lo que el usuario mira. */}
      <aside className="glass hidden md:flex flex-col items-center w-16 shrink-0 text-sidebar-foreground rounded-none border-y-0 border-l-0">
        <Link
          to="/"
          className="mt-4 mb-2 w-10 h-10 rounded-xl bg-brand text-brand-foreground flex items-center justify-center font-semibold text-sm shrink-0"
          aria-label="OPERAL OS"
          title="OPERAL OS"
        >
          O
        </Link>

        <nav className="flex-1 flex flex-col items-center gap-1 py-2">
          {navItems.map((item) => {
            const active = location.pathname === item.href;
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    to={item.href}
                    aria-label={item.label}
                    aria-current={active ? "page" : undefined}
                    // Estado activo: navy solido con texto blanco -- el unico
                    // uso "fuerte" del acento de marca en toda la interfaz.
                    className={`flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
                      active
                        ? "bg-brand text-brand-foreground"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    }`}
                  >
                    <item.icon className="w-[18px] h-[18px]" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <div className="flex flex-col items-center gap-1 py-3 border-t border-sidebar-border w-full">
          <ThemeToggle className="flex items-center justify-center w-10 h-10 rounded-xl text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={logout}
                aria-label="Cerrar sesión"
                className="flex items-center justify-center w-10 h-10 rounded-xl text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              >
                <LogOut className="w-[18px] h-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Cerrar sesión</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="mt-1 w-8 h-8 rounded-full bg-sidebar-accent text-sidebar-accent-foreground flex items-center justify-center text-xs font-semibold cursor-default"
                aria-label={`${user.nombre} (${user.rol.toLowerCase()})`}
              >
                {user.nombre.charAt(0).toUpperCase()}
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              {user.nombre} · <span className="capitalize">{user.rol.toLowerCase()}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="glass md:hidden fixed top-0 left-0 right-0 z-50 text-sidebar-foreground rounded-none border-x-0 border-t-0">
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
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${
                    active
                      ? "bg-brand text-brand-foreground"
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

      {/* Main content -- transparente, deja pasar la malla del body */}
      <main className="flex-1 overflow-auto pt-16 md:pt-0 text-foreground">
        <div className="p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
