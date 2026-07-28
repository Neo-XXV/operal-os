import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

// El icono muestra el modo AL QUE se cambiaria al hacer click (convencion
// GitHub/Twitter), no el modo activo -- en claro se ve la Luna, en oscuro
// el Sol. Sin guard de "montado": esta es una SPA sin SSR (Vite + CSR
// puro), no hay HTML de servidor con el que desajustarse -- next-themes
// resuelve resolvedTheme en el mismo tick del montaje del provider.
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const esOscuro = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(esOscuro ? "light" : "dark")}
      aria-label={esOscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={esOscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={
        className ??
        "flex items-center justify-center w-9 h-9 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
      }
    >
      {esOscuro ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
