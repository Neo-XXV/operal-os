// Extraido de Dashboard.tsx (Sprint 3) para reusar en el dashboard individual
// por setter (DashboardSetter.tsx) sin duplicar la matematica de formato ni
// los colores -- mismo criterio que ya se aplico con PeriodoSelector.tsx.
import { Minus, TrendingUp, TrendingDown } from "lucide-react";

// Paleta dark (skill dataviz, references/palette.md) -- pasos dark de la
// paleta categorica validada + los colores de status fijos. Se usan tal
// cual, no se reinventan hex nuevos.
export const CAT = {
  blue: "#3987e5",
  orange: "#d95926",
  aqua: "#199e70",
  yellow: "#c98500",
  magenta: "#d55181",
  violet: "#9085e9",
  red: "#e66767",
};
export const STATUS = {
  warning: "#fab219",
  critical: "#e66767",
  good: "#0ca30c",
};
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
      style={resaltada ? { backgroundColor: `${STATUS.warning}1a`, color: STATUS.warning } : undefined}
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
