// Extraido de Dashboard.tsx (Sprint 3) para reusar en el dashboard individual
// por setter (DashboardSetter.tsx) sin duplicar la matematica de formato ni
// los colores -- mismo criterio que ya se aplico con PeriodoSelector.tsx.
import { Minus, TrendingUp, TrendingDown } from "lucide-react";

// Paleta categorica validada (skill dataviz, references/palette.md), leida
// por variable CSS -- NO hex fijo. Antes esto tenia hardcodeados los pasos
// OSCUROS y los usaba tambien en modo claro, o sea: en claro los graficos
// estaban pintados con colores calibrados para fondo oscuro. Ahora cada modo
// usa sus propios pasos (ver index.css) y el toggle de tema los invierte solo,
// igual que ya hacia CHROME.
export const CAT = {
  blue: "var(--chart-blue)",
  orange: "var(--chart-orange)",
  aqua: "var(--chart-aqua)",
  yellow: "var(--chart-yellow)",
  magenta: "var(--chart-magenta)",
  green: "var(--chart-green)",
  violet: "var(--chart-violet)",
  red: "var(--chart-red)",
};

// Ramp ordinal (una hue, claro->oscuro) para escalas CON orden natural --
// el embudo A->MS->B->C->D. No aplicar a categorias nominales: ahi va un
// solo color para todas las barras.
export const ORDINAL = [
  "var(--chart-ord-1)",
  "var(--chart-ord-2)",
  "var(--chart-ord-3)",
  "var(--chart-ord-4)",
  "var(--chart-ord-5)",
];

// Status: fijo, nunca tematizado, y deliberadamente distinto de los slots
// categoricos. `critical` antes usaba #e66767, que es el ROJO CATEGORICO
// oscuro (slot 8) -- un color de serie haciendo de color de estado, que el
// sistema marca como anti-patron. Ahora apunta al critical real.
export const STATUS = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
};

// Version translucida de cualquier color del sistema. Reemplaza al patron
// viejo de concatenar alpha en hex (`${STATUS.warning}1a`), que dejo de
// funcionar al pasar los colores a variables CSS. color-mix ademas mantiene
// el resultado atado al token: si el color cambia por tema, el wash tambien.
export function wash(color: string, pct: number) {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
// Referencias a las variables CSS del tema (no hex fijo) -- el grid y el
// texto de los ejes tienen que invertirse entre claro/oscuro, a diferencia
// de los colores categoricos/de status (decorativos, fijos en ambos modos).
export const CHROME = {
  gridline: "hsl(var(--border))",
  muted: "hsl(var(--muted-foreground))",
};

export const TRANSICIONES = [
  { key: "MSR", label: "A → MS", desc: "Respondio al primer mensaje" },
  { key: "PRR", label: "MS → B", desc: "Recibio el pitch" },
  { key: "CSR", label: "B → C", desc: "Agendo en el calendario" },
  { key: "ABR", label: "C → D", desc: "Confirmo el calendario" },
] as const;

// Numerador/denominador de cada tasa, en terminos de las etapas de conteos —
// para mostrar el volumen (n/d) junto al porcentaje en las tablas comparativas.
// Sin esto, un "100%" con 1 solo lead se lee igual que un "100%" con 50.
export const ETAPAS_TASA: Record<(typeof TRANSICIONES)[number]["key"], { num: "A" | "MS" | "B" | "C" | "D"; den: "A" | "MS" | "B" | "C" | "D" }> = {
  MSR: { num: "MS", den: "A" },
  PRR: { num: "B", den: "MS" },
  CSR: { num: "C", den: "B" },
  ABR: { num: "D", den: "C" },
};

export function formatPct(v: number | null) {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export function CeldaTasa({
  valor,
  conteos,
  transicion,
  resaltada,
}: {
  valor: number | null;
  conteos: Record<"A" | "MS" | "B" | "C" | "D", number>;
  transicion: (typeof TRANSICIONES)[number]["key"];
  resaltada: boolean;
}) {
  const { num, den } = ETAPAS_TASA[transicion];
  return (
    <td
      className={`text-right p-3 tabular-nums ${
        resaltada ? "font-semibold" : "text-muted-foreground"
      }`}
      style={resaltada ? { backgroundColor: wash(STATUS.warning, 10), color: STATUS.warning } : undefined}
      title={
        valor !== null && valor > 1
          ? "Puede superar 100%: cuenta leads que llegaron a esta etapa dentro de este grupo, aunque hayan llegado a la etapa anterior fuera de el (ej. reasignación en el medio)."
          : undefined
      }
    >
      {formatPct(valor)}
      <span className="text-muted-foreground text-xs ml-1 font-normal">
        ({conteos[num]}/{conteos[den]})
      </span>
    </td>
  );
}

export function DeltaVisual({
  delta,
  invertido,
  texto,
  onGradient = false,
}: {
  delta: number;
  invertido: boolean;
  texto: string;
  onGradient?: boolean;
}) {
  if (delta === 0) {
    return (
      <span className={`text-xs flex items-center gap-1 ${onGradient ? "text-white/70" : "text-muted-foreground"}`}>
        <Minus className="w-3 h-3" />
        Sin cambio
      </span>
    );
  }
  const esBueno = invertido ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={`text-xs flex items-center gap-1 font-medium ${onGradient ? "text-white/85" : ""}`}
      style={onGradient ? undefined : { color: esBueno ? STATUS.good : STATUS.critical }}
    >
      <Icon className="w-3 h-3" />
      {texto} vs. período anterior
    </span>
  );
}

export function DeltaTasa({ actual, anterior }: { actual: number | null; anterior: number | null }) {
  if (actual === null || anterior === null) {
    return <span className="text-xs text-muted-foreground">Sin dato previo</span>;
  }
  const deltaPuntos = Math.round((actual - anterior) * 100);
  return <DeltaVisual delta={deltaPuntos} invertido={false} texto={`${deltaPuntos > 0 ? "+" : ""}${deltaPuntos}pp`} />;
}
