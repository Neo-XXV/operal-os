import { CAT, CHROME, STATUS, DeltaVisual } from "@/lib/embudoDisplay";

// Stat tile del sistema de diseno (skill dataviz, marks-and-anatomy):
//   label · value · delta (opcional) · trend (opcional)
//
// Reemplaza a las tiles con gradiente saturado + icono decorativo: un
// gradiente grande es "thick saturated block" (anti-patron explicito) y el
// icono no codificaba ningun dato.
//
// `trend` es OPCIONAL a proposito: hay dashboards del sistema cuyo endpoint
// devuelve solo escalares (llamadas, setter). Una tile sin sparkline es una
// forma valida del sistema, no una tile rota -- es la alternativa honesta a
// fabricar una serie que el backend no tiene.

export type StatTileProps = {
  label: string;
  value: string;
  /** true = la metrica es mejor cuando BAJA (ej. descartados). */
  invertido?: boolean;
  delta?: { actual: number; anterior: number | null };
  /** Serie cronologica (viejo -> nuevo). Omitir si no hay dato real. */
  trend?: number[];
  /** Destaca la tile como KPI principal de la vista (principio de jerarquia). */
  destacada?: boolean;
  info?: React.ReactNode;
};

const SPARK_W = 120;
const SPARK_H = 32;

// Sparkline: linea de 2px en gris de de-enfasis + punto final >=8px en el
// azul de SERIE. Nunca usa el acento de marca (navy): ese es chrome, y no
// entra al area de ploteo.
function Sparkline({ datos }: { datos: number[] }) {
  const puntos = datos.filter((d) => Number.isFinite(d));
  if (puntos.length < 2) return null;

  const min = Math.min(...puntos);
  const max = Math.max(...puntos);
  const rango = max - min || 1;
  // Margen vertical para que el punto final (r=4 + anillo 2px) no se corte.
  const pad = 5;
  const alto = SPARK_H - pad * 2;

  const coords = puntos.map((v, i) => {
    const x = (i / (puntos.length - 1)) * SPARK_W;
    const y = pad + alto - ((v - min) / rango) * alto;
    return [x, y] as const;
  });

  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const [ux, uy] = coords[coords.length - 1];

  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="overflow-visible"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} fill="none" stroke={CHROME.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* Anillo del color de superficie: separa el punto de la linea sin
          dibujarle un borde de "tinta de dato" alrededor. */}
      <circle cx={ux} cy={uy} r={6} fill="hsl(var(--card))" />
      <circle cx={ux} cy={uy} r={4} fill={CAT.blue} />
    </svg>
  );
}

export function StatTile({ label, value, invertido, delta, trend, destacada, info }: StatTileProps) {
  return (
    <div
      className={`rounded-2xl bg-card border border-border flex flex-col justify-between ${
        destacada ? "p-6 shadow-raised" : "p-5 shadow-panel"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground flex items-center">
          {label}
          {info}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {/* Sin tabular-nums a proposito: en un numero grande y suelto los
              digitos de ancho fijo se ven flojos. tabular-nums se reserva
              para columnas que tienen que alinearse (tablas, ticks de eje). */}
          <span
            className={`font-semibold text-foreground ${destacada ? "text-5xl" : "text-3xl"}`}
          >
            {value}
          </span>
          {delta && (
            <div className="mt-1.5">
              {delta.anterior === null ? (
                <span className="text-xs text-muted-foreground">Sin dato previo</span>
              ) : (
                <DeltaVisual
                  delta={delta.actual - delta.anterior}
                  invertido={!!invertido}
                  texto={`${delta.actual - delta.anterior > 0 ? "+" : ""}${delta.actual - delta.anterior}`}
                />
              )}
            </div>
          )}
        </div>
        {trend && trend.length >= 2 && (
          <div className="shrink-0">
            <Sparkline datos={trend} />
          </div>
        )}
      </div>
    </div>
  );
}

// Exportado para que las vistas que muestran un unico KPI dominante (ej. el
// Close Rate de la fase de llamada) puedan usarlo como hero figure: >=48px,
// mismo sans que todo lo demas, exactamente uno por vista.
export function HeroFigure({
  label,
  value,
  sub,
  estado,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  estado?: "good" | "warning" | "critical";
}) {
  return (
    <div className="rounded-2xl bg-card border border-border shadow-raised p-6 flex flex-col justify-between">
      <span className="text-sm font-medium text-muted-foreground flex items-center">{label}</span>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-5xl font-semibold text-foreground">{value}</span>
        {estado && (
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: STATUS[estado] }}
            aria-hidden="true"
          />
        )}
      </div>
      {sub && <div className="mt-2 text-sm text-muted-foreground">{sub}</div>}
    </div>
  );
}
