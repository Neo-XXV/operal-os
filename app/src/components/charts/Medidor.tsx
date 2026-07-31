import { CAT, STATUS, formatPct, wash } from "@/lib/embudoDisplay";

// Medidor: "una razon contra su limite" (skill dataviz, choosing-a-form).
// Es la forma correcta para tasa-vs-umbral -- un donut de 2 gajos para lo
// mismo es anti-patron explicito del sistema.
//
// El relleno lleva la severidad (good / warning / critical) y el riel es un
// paso mas claro del MISMO color, para que el estado se lea a lo largo de
// toda la barra y no solo en la parte llena.
//
// Los umbrales no se inventan: vienen de anomaliaConfig.ts, la misma fuente
// que usa el motor de reglas para decidir si algo es una anomalia.

export type MedidorProps = {
  label: string;
  /** Tasa 0..1, o null si no hay denominador. */
  valor: number | null;
  /**
   * Por debajo de esto el motor de reglas lo marca como anomalia. OPCIONAL:
   * hay razones que el sistema muestra pero para las que no define ningun
   * limite (Close Rate, Show Up Rate). Sin umbral el medidor cae a escala
   * 0-100% y color NEUTRO -- los colores de status significan bueno/malo, y
   * sin un limite contra el cual comparar no hay bueno ni malo que afirmar.
   */
  umbral?: number;
  /** Objetivo del negocio (opcional; se dibuja como marca en el riel). */
  objetivo?: number | null;
  /** Numerador/denominador reales, para no mostrar un % sin volumen. */
  conteo?: { num: number; den: number };
  descripcion?: string;
};

// Escala del medidor: el maximo visible es el objetivo (o el umbral si no hay
// objetivo), con aire arriba para que llegar al objetivo no sea la barra
// llena al 100% -- si no, "cumpli el objetivo" y "el maximo posible" se
// confunden visualmente.
function escala(umbral: number, objetivo?: number | null) {
  const techo = Math.max(umbral, objetivo ?? 0);
  return techo * 1.35;
}

function severidad(valor: number | null, umbral: number, objetivo?: number | null): "good" | "warning" | "critical" {
  if (valor === null) return "warning";
  if (valor < umbral) return "critical";
  if (objetivo != null && valor < objetivo) return "warning";
  return "good";
}

export function Medidor({ label, valor, umbral, objetivo, conteo, descripcion }: MedidorProps) {
  const sinUmbral = umbral === undefined;
  // Sin umbral la escala es la razon completa (0-100%): el "limite" pasa a
  // ser el maximo posible, que es lo unico honesto que se puede afirmar.
  const max = sinUmbral ? 1 : escala(umbral, objetivo);
  const color = sinUmbral ? CAT.blue : STATUS[severidad(valor, umbral, objetivo)];

  const pctBarra = valor === null ? 0 : Math.min(100, (valor / max) * 100);
  const pctUmbral = sinUmbral ? null : Math.min(100, (umbral / max) * 100);
  const pctObjetivo = objetivo != null ? Math.min(100, (objetivo / max) * 100) : null;

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {/* El valor va SIEMPRE visible, nunca solo en tooltip: tres hues de
            la paleta quedan sub-3:1 en claro, y la regla de relieve del
            sistema exige etiqueta directa o tabla. */}
        <span className="text-lg font-semibold text-foreground tabular-nums">{formatPct(valor)}</span>
      </div>

      <div className="mt-2.5 relative h-2 rounded-full" style={{ backgroundColor: wash(color, 15) }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width]"
          style={{ width: `${pctBarra}%`, backgroundColor: color }}
        />
        {/* Marcas de umbral y objetivo: hairline del color de superficie, que
            corta el riel sin sumar tinta de dato. */}
        {pctUmbral !== null && (
          <span
            className="absolute inset-y-0 w-0.5 bg-[hsl(var(--glass))]"
            style={{ left: `${pctUmbral}%` }}
            aria-hidden="true"
          />
        )}
        {pctObjetivo !== null && (
          <span
            className="absolute -inset-y-1 w-0.5 bg-foreground/40"
            style={{ left: `${pctObjetivo}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {conteo ? `${conteo.num}/${conteo.den}` : " "}
        </span>
        <span className="tabular-nums">
          {sinUmbral
            ? "sin umbral definido"
            : `umbral ${formatPct(umbral)}${objetivo != null ? ` · objetivo ${formatPct(objetivo)}` : ""}`}
        </span>
      </div>

      {descripcion && <p className="mt-1.5 text-xs text-muted-foreground">{descripcion}</p>}
    </div>
  );
}
