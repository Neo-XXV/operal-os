import { cn } from "@/lib/utils";

// Panel de vidrio esmerilado. Existe como componente propio en vez de
// parchear ui/card.tsx: ese es un primitivo vendored de shadcn y la
// convencion del repo es extenderlo por composicion, no editarlo. Ademas
// evita pelear con la cascada -- Card trae `bg-card` y aca el fondo lo pone
// la clase .glass.
//
// Espeja la API de Card (header/title/content) para que cambiar uno por otro
// en las pantallas sea un reemplazo directo.

export function GlassPanel({
  className,
  raised,
  ...props
}: React.ComponentProps<"div"> & { raised?: boolean }) {
  return (
    <div
      className={cn(
        raised ? "glass-raised" : "glass",
        "text-card-foreground flex flex-col gap-6 rounded-2xl py-6",
        className,
      )}
      {...props}
    />
  );
}

export function GlassPanelHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 px-6", className)} {...props} />;
}

export function GlassPanelTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("leading-none font-semibold text-foreground", className)} {...props} />;
}

export function GlassPanelContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-6", className)} {...props} />;
}
