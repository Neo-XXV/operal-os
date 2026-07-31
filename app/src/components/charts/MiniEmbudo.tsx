import { ORDINAL } from "@/lib/embudoDisplay";

// Mini embudo: barras horizontales del pipeline A -> MS -> B -> C -> D.
//
// Usa el ramp ORDINAL (una sola hue, claro->oscuro) y no colores
// categoricos, porque las etapas SI tienen orden natural. El sistema prohibe
// el ramp de valor sobre categorias nominales (equipos, productos), pero un
// embudo es exactamente el caso donde el ramp ordenado corresponde.
//
// Specs del sistema: barra <=24px de alto, punta redondeada de 4px, arranca
// de una linea base unica, y la separacion entre barras es aire, no borde.

const ETAPAS = [
  { key: "A", label: "Primer mensaje" },
  { key: "MS", label: "Respondió" },
  { key: "B", label: "Pitch enviado" },
  { key: "C", label: "Agendado" },
  { key: "D", label: "Confirmado" },
] as const;

export type MiniEmbudoProps = {
  conteos: Record<string, number>;
  /** Etapas extra a mostrar al final (ej. "Sin etapa" del pipeline actual). */
  extra?: { key: string; label: string; valor: number }[];
};

export function MiniEmbudo({ conteos, extra }: MiniEmbudoProps) {
  const filas = [
    ...ETAPAS.map((e, i) => ({ ...e, valor: conteos[e.key] ?? 0, color: ORDINAL[i] })),
    ...(extra ?? []).map((e) => ({ ...e, color: "hsl(var(--muted))" })),
  ];
  const max = Math.max(...filas.map((f) => f.valor), 1);

  return (
    <div className="space-y-2">
      {filas.map((f) => {
        const pct = (f.valor / max) * 100;
        return (
          <div key={f.key} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs text-muted-foreground truncate" title={f.label}>
              {f.label}
            </span>
            <div className="flex-1 min-w-0">
              <div
                className="h-4 rounded-r-[4px] transition-[width]"
                style={{
                  // Minimo visible para que una etapa en 0 siga leyendose como
                  // fila, sin fingir volumen: el numero de la derecha manda.
                  width: `${Math.max(pct, f.valor > 0 ? 2 : 0)}%`,
                  backgroundColor: f.color,
                }}
              />
            </div>
            {/* Etiqueta directa siempre visible -- no queda ningun valor
                accesible solo por tooltip. */}
            <span className="w-12 shrink-0 text-right text-sm text-foreground tabular-nums">
              {f.valor}
            </span>
          </div>
        );
      })}
    </div>
  );
}
