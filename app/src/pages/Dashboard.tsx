import { useState } from "react";
import { Navigate } from "react-router";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Users, Activity, UserX, CalendarCheck, TrendingUp, TrendingDown, Minus, TriangleAlert } from "lucide-react";

// Paleta dark (skill dataviz, references/palette.md) -- pasos dark de la
// paleta categorica validada + los colores de status fijos. Se usan tal
// cual, no se reinventan hex nuevos.
const CAT = {
  blue: "#3987e5",
  orange: "#d95926",
  aqua: "#199e70",
  yellow: "#c98500",
  magenta: "#d55181",
  violet: "#9085e9",
  red: "#e66767",
};
const STATUS = {
  warning: "#fab219",
  critical: "#e66767",
  good: "#0ca30c",
};
const CHROME = {
  gridline: "#2c2838",
  muted: "#8b87a3",
};

// Forma "emphasis" (skill dataviz): una serie es el punto, el resto es
// contexto — 1 hue de acento + gris, no 4 colores categoricos. El acento es
// el color de "warning" (status fijo, no categorico) porque el cuello de
// botella es semanticamente un estado de alerta, no una serie mas; cual de
// las 4 transiciones lo lleva se decide en runtime (cuelloDeBotella.key),
// nunca hardcodeado.
const COLOR_ACENTO = STATUS.warning;
const COLOR_CONTEXTO = CHROME.muted;

const GRANULARIDADES_HISTORICO = ["mensual", "trimestral", "semestral", "anual"] as const;
type GranularidadHistorico = (typeof GRANULARIDADES_HISTORICO)[number];

function esGranularidadHistorico(periodo: string): periodo is GranularidadHistorico {
  return (GRANULARIDADES_HISTORICO as readonly string[]).includes(periodo);
}

function formatearEtiquetaBucket(desde: string | Date, granularidad: GranularidadHistorico) {
  const d = new Date(desde);
  if (granularidad === "mensual") {
    return d.toLocaleDateString("es-AR", { month: "short", year: "2-digit" });
  }
  if (granularidad === "trimestral") {
    return `T${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  }
  if (granularidad === "semestral") {
    return `S${d.getMonth() < 6 ? 1 : 2} ${d.getFullYear()}`;
  }
  return `${d.getFullYear()}`;
}

const ORIGEN_LABELS: Record<string, string> = {
  SCRAPING: "Scraping",
  MANUAL: "Manual",
  RPP: "RPP",
};

const PERIODOS = [
  { value: "lifetime", label: "Todo el historial" },
  { value: "mensual", label: "Este mes" },
  { value: "trimestral", label: "Este trimestre" },
  { value: "semestral", label: "Este semestre" },
  { value: "anual", label: "Este año" },
  { value: "rango", label: "Rango personalizado" },
];

const TRANSICIONES = [
  { key: "MSR", label: "A → MS", desc: "Respondio al primer mensaje" },
  { key: "PRR", label: "MS → B", desc: "Recibio el pitch" },
  { key: "CSR", label: "B → C", desc: "Agendo en el calendario" },
  { key: "ABR", label: "C → D", desc: "Confirmo el calendario" },
] as const;

// Numerador/denominador de cada tasa, en terminos de las etapas de conteos —
// para mostrar el volumen (n/d) junto al porcentaje en las tablas comparativas.
// Sin esto, un "100%" con 1 solo lead se lee igual que un "100%" con 50.
const ETAPAS_TASA: Record<(typeof TRANSICIONES)[number]["key"], { num: "A" | "MS" | "B" | "C" | "D"; den: "A" | "MS" | "B" | "C" | "D" }> = {
  MSR: { num: "MS", den: "A" },
  PRR: { num: "B", den: "MS" },
  CSR: { num: "C", den: "B" },
  ABR: { num: "D", den: "C" },
};

function formatPct(v: number | null) {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function CeldaTasa({
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
        resaltada ? "font-semibold" : "text-slate-300"
      }`}
      style={resaltada ? { backgroundColor: `${STATUS.warning}1a`, color: STATUS.warning } : undefined}
      title={
        valor !== null && valor > 1
          ? "Puede superar 100%: cuenta leads que llegaron a esta etapa dentro de este grupo, aunque hayan llegado a la etapa anterior fuera de el (ej. reasignación en el medio)."
          : undefined
      }
    >
      {formatPct(valor)}
      <span className="text-slate-500 text-xs ml-1 font-normal">
        ({conteos[num]}/{conteos[den]})
      </span>
    </td>
  );
}

// invertido=true significa "menos es mejor" (ej: descartados). El resto de
// las metricas del dashboard son "mas es mejor". onGradient=true renuncia al
// color good/critical (contraste no garantizado contra un gradiente saturado
// arbitrario) y usa blanco + el icono de direccion, que ya alcanza para leer
// "subio/bajo" sin necesitar el color como canal.
function DeltaConteo({
  actual,
  anterior,
  invertido = false,
  onGradient = false,
}: {
  actual: number;
  anterior: number | null;
  invertido?: boolean;
  onGradient?: boolean;
}) {
  if (anterior === null) {
    return <span className={`text-xs ${onGradient ? "text-white/70" : "text-slate-400"}`}>Sin dato previo</span>;
  }
  const delta = actual - anterior;
  return <DeltaVisual delta={delta} invertido={invertido} texto={`${delta > 0 ? "+" : ""}${delta}`} onGradient={onGradient} />;
}

function DeltaTasa({ actual, anterior }: { actual: number | null; anterior: number | null }) {
  if (actual === null || anterior === null) {
    return <span className="text-xs text-slate-400">Sin dato previo</span>;
  }
  const deltaPuntos = Math.round((actual - anterior) * 100);
  return <DeltaVisual delta={deltaPuntos} invertido={false} texto={`${deltaPuntos > 0 ? "+" : ""}${deltaPuntos}pp`} />;
}

function DeltaVisual({
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
      <span className={`text-xs flex items-center gap-1 ${onGradient ? "text-white/70" : "text-slate-400"}`}>
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

// Tile decorativa de KPI: numero unico, no una serie comparativa -- el
// gradiente es marca, no codifica dato, asi que no requiere el gate CVD que
// si aplica a las lineas/barras reales de abajo (skill dataviz, "choosing a
// form": un stat tile no es un chart).
function KpiTile({
  label,
  icon: Icon,
  value,
  gradient,
  delta,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  value: number | string;
  gradient?: [string, string];
  delta?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col justify-between min-h-[132px]"
      style={
        gradient
          ? { backgroundImage: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }
          : { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }
      }
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium ${gradient ? "text-white/90" : "text-slate-400"}`}>{label}</span>
        <Icon className={`w-5 h-5 ${gradient ? "text-white/80" : ""}`} style={!gradient ? { color: STATUS.critical } : undefined} />
      </div>
      <div>
        <span className={`text-4xl font-bold ${gradient ? "text-white" : "text-white"}`}>{value}</span>
        {delta && <div className="mt-2">{delta}</div>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, isAdmin, isSetter } = useAuth();
  const { data: leads } = trpc.lead.list.useQuery();

  const [periodo, setPeriodo] = useState("mensual");
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");

  const queryHabilitada = isAdmin && (periodo !== "rango" || !!rangoDesde);
  const { data: dashboard, isLoading: cargandoDashboard } = trpc.event.dashboardEjecutivo.useQuery(
    {
      periodo: periodo as "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango",
      desde: periodo === "rango" && rangoDesde ? new Date(rangoDesde) : undefined,
      hasta: periodo === "rango" && rangoHasta ? new Date(rangoHasta) : undefined,
    },
    { enabled: queryHabilitada },
  );

  // Sprint 3, punto 2: serie historica — solo tiene sentido para las 4
  // granularidades calendario (lifetime/rango no tienen una unidad de
  // bucket natural que inventar).
  const { data: historico } = trpc.event.dashboardHistorico.useQuery(
    { granularidad: periodo as GranularidadHistorico },
    { enabled: isAdmin && esGranularidadHistorico(periodo) },
  );

  // Sprint 3, punto 3: comparacion por setter — respeta el mismo periodo
  // que el resto del dashboard (misma logica de habilitacion que dashboardEjecutivo).
  const { data: porSetter } = trpc.event.embudoPorSetter.useQuery(
    {
      periodo: periodo as "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango",
      desde: periodo === "rango" && rangoDesde ? new Date(rangoDesde) : undefined,
      hasta: periodo === "rango" && rangoHasta ? new Date(rangoHasta) : undefined,
    },
    { enabled: queryHabilitada },
  );

  // Sprint 3, punto 4: comparacion por origen del lead — mismo periodo.
  const { data: porOrigen } = trpc.event.embudoPorOrigen.useQuery(
    {
      periodo: periodo as "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango",
      desde: periodo === "rango" && rangoDesde ? new Date(rangoDesde) : undefined,
      hasta: periodo === "rango" && rangoHasta ? new Date(rangoHasta) : undefined,
    },
    { enabled: queryHabilitada },
  );

  // Sprint 2: la tabla de leads es el centro operativo del setter — no un
  // dashboard de KPIs al que se llega navegando.
  if (isSetter) {
    return <Navigate to="/leads" replace />;
  }

  // Proyeccion: leads por etapa (snapshot actual, no depende del periodo —
  // es la distribucion del pipeline hoy, no una metrica historica)
  const leadsByStage: Record<string, number> = {};
  leads?.forEach((l) => {
    const stage = l.etapaActual ?? "Sin etapa";
    leadsByStage[stage] = (leadsByStage[stage] ?? 0) + 1;
  });

  const stageNames: Record<string, string> = {
    A: "Primer mensaje",
    MS: "Respondio",
    B: "Pitch enviado",
    C: "Agendado",
    D: "Confirmado",
    "Sin etapa": "Sin etapa",
  };

  const stageOrder = ["A", "MS", "B", "C", "D", "Sin etapa"];

  const cuelloDeBotella = dashboard?.cuelloDeBotella;
  const transicionCuelloDeBotella = cuelloDeBotella
    ? TRANSICIONES.find((t) => t.key === cuelloDeBotella.key)
    : null;

  const datosHistorico = historico?.serie.map((b) => ({
    etiqueta: formatearEtiquetaBucket(b.desde, historico.granularidad as GranularidadHistorico),
    MSR: b.embudo.tasas.MSR !== null ? Math.round(b.embudo.tasas.MSR * 100) : null,
    PRR: b.embudo.tasas.PRR !== null ? Math.round(b.embudo.tasas.PRR * 100) : null,
    CSR: b.embudo.tasas.CSR !== null ? Math.round(b.embudo.tasas.CSR * 100) : null,
    ABR: b.embudo.tasas.ABR !== null ? Math.round(b.embudo.tasas.ABR * 100) : null,
  }));

  const chartConfigHistorico: ChartConfig = Object.fromEntries(
    TRANSICIONES.map((t) => [
      t.key,
      { label: `${t.label} (${t.key})`, color: t.key === cuelloDeBotella?.key ? COLOR_ACENTO : COLOR_CONTEXTO },
    ]),
  );

  return (
    <Layout>
      <div className="dark -m-6 p-6 min-h-[calc(100vh-1px)] bg-background text-foreground space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Hola, {user?.nombre}
            </h1>
            <p className="text-slate-400 mt-1">
              {isAdmin
                ? "Panel de administracion del sistema"
                : "Estos son tus leads asignados"}
            </p>
          </div>

          {isAdmin && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <Select value={periodo} onValueChange={setPeriodo}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODOS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {periodo === "rango" && (
                <div className="flex items-center gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">Desde</Label>
                    <Input
                      type="date"
                      value={rangoDesde}
                      onChange={(e) => setRangoDesde(e.target.value)}
                      className="w-36"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">Hasta</Label>
                    <Input
                      type="date"
                      value={rangoHasta}
                      onChange={(e) => setRangoHasta(e.target.value)}
                      className="w-36"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {isAdmin && (
          <>
            {/* Cuello de botella — status de alerta, no una tile decorativa:
                borde + icono en el color de "warning" fijo, nunca color solo. */}
            <div
              className="rounded-2xl p-5"
              style={{ backgroundColor: "hsl(var(--card))", border: `1px solid ${STATUS.warning}40` }}
            >
              {cargandoDashboard ? (
                <p className="text-sm text-slate-400">Calculando...</p>
              ) : !cuelloDeBotella || !transicionCuelloDeBotella ? (
                <p className="text-sm text-slate-400">
                  Todavia no hay suficientes datos en este período para identificar un cuello de botella.
                </p>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-full shrink-0"
                    style={{ backgroundColor: `${STATUS.warning}26` }}
                  >
                    <TriangleAlert className="w-6 h-6" style={{ color: STATUS.warning }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: STATUS.warning }}>
                      Cuello de botella
                    </p>
                    <p className="text-lg font-semibold text-white mt-0.5">
                      {transicionCuelloDeBotella.label}{" "}
                      <span className="text-slate-400 font-normal">({transicionCuelloDeBotella.desc})</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl font-semibold text-white">
                      {formatPct(cuelloDeBotella.valorActual)}
                    </span>
                    {cuelloDeBotella.tendencia === "sin_datos_previos" ? (
                      <span className="text-xs text-slate-400">Sin período anterior para comparar</span>
                    ) : (
                      <DeltaTasa actual={cuelloDeBotella.valorActual} anterior={cuelloDeBotella.valorAnterior} />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* KPIs del periodo -- gradiente en las 3 metricas "mas es
                mejor"; Descartados es una metrica invertida (menos es mejor)
                y NO lleva gradiente celebratorio, solo un icono en el color
                critical fijo -- el tratamiento visual no debe sugerir que un
                numero alto ahi es un logro. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiTile
                label="Leads nuevos"
                icon={Users}
                value={dashboard?.kpis.actual.leadsNuevos ?? "—"}
                gradient={[CAT.violet, CAT.magenta]}
                delta={dashboard && <DeltaConteo actual={dashboard.kpis.actual.leadsNuevos} anterior={dashboard.kpis.anterior?.leadsNuevos ?? null} onGradient />}
              />
              <KpiTile
                label="Activos"
                icon={Activity}
                value={dashboard?.kpis.actual.activos ?? "—"}
                gradient={[CAT.blue, CAT.aqua]}
                delta={dashboard && <DeltaConteo actual={dashboard.kpis.actual.activos} anterior={dashboard.kpis.anterior?.activos ?? null} onGradient />}
              />
              <KpiTile
                label="Descartados"
                icon={UserX}
                value={dashboard?.kpis.actual.descartados ?? "—"}
                delta={dashboard && <DeltaConteo actual={dashboard.kpis.actual.descartados} anterior={dashboard.kpis.anterior?.descartados ?? null} invertido />}
              />
              <KpiTile
                label="Agendados"
                icon={CalendarCheck}
                value={dashboard?.kpis.actual.agendados ?? "—"}
                gradient={[CAT.orange, CAT.yellow]}
                delta={dashboard && <DeltaConteo actual={dashboard.kpis.actual.agendados} anterior={dashboard.kpis.anterior?.agendados ?? null} onGradient />}
              />
            </div>
          </>
        )}

        {/* Embudo visual — distribucion actual del pipeline (no depende del periodo) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-white">Embudo comercial</CardTitle>
            <p className="text-sm text-slate-400">
              Distribucion de leads por etapa
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stageOrder.map((stage) => {
                const count = leadsByStage[stage] ?? 0;
                const maxCount = Math.max(...Object.values(leadsByStage), 1);
                const pct = (count / maxCount) * 100;
                return (
                  <div key={stage} className="flex items-center gap-4">
                    <div className="w-32 text-sm font-medium text-slate-300">
                      {stageNames[stage] ?? stage}
                    </div>
                    <div className="flex-1 h-8 bg-white/5 rounded-lg overflow-hidden">
                      <div
                        className="h-full rounded-lg flex items-center px-3 transition-all"
                        style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: CAT.blue }}
                      >
                        <span className="text-white text-sm font-semibold">
                          {count}
                        </span>
                      </div>
                    </div>
                    <div className="w-12 text-right text-sm text-slate-400">
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Conversion entre etapas del periodo seleccionado */}
        {isAdmin && dashboard && (
          <Card>
            <CardHeader>
              <CardTitle className="text-white">Conversion entre etapas</CardTitle>
              <p className="text-sm text-slate-400">
                Que porcentaje de los leads que llegan a una etapa avanzan a la siguiente, en el período seleccionado
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {TRANSICIONES.map((t) => {
                  const valor = dashboard.embudo.actual.tasas[t.key];
                  const valorAnterior = dashboard.embudo.anterior?.tasas[t.key] ?? null;
                  const esCuelloDeBotella = t.key === cuelloDeBotella?.key;
                  return (
                    <div
                      key={t.key}
                      className="rounded-lg p-4"
                      style={
                        esCuelloDeBotella
                          ? { border: `1px solid ${STATUS.warning}40`, backgroundColor: `${STATUS.warning}14` }
                          : { border: "1px solid hsl(var(--border))" }
                      }
                    >
                      <p className="text-xs font-medium text-slate-400">
                        {t.label} <span className="text-slate-500">({t.key})</span>
                      </p>
                      <p className="text-2xl font-semibold text-white mt-1">
                        {formatPct(valor)}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{t.desc}</p>
                      <div className="mt-2">
                        <DeltaTasa actual={valor} anterior={valorAnterior} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Evolucion historica — Sprint 3, punto 2 */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-white">Evolución histórica</CardTitle>
              <p className="text-sm text-slate-400">
                Conversión por etapa a lo largo del tiempo — la línea resaltada es el cuello de botella actual
              </p>
            </CardHeader>
            <CardContent>
              {!esGranularidadHistorico(periodo) ? (
                <p className="text-sm text-slate-400 py-8 text-center">
                  Elegí un período mensual, trimestral, semestral o anual para ver la evolución histórica.
                </p>
              ) : !datosHistorico ? (
                <p className="text-sm text-slate-400 py-8 text-center">Calculando...</p>
              ) : (
                <ChartContainer config={chartConfigHistorico} className="h-72 w-full">
                  <LineChart data={datosHistorico} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHROME.gridline} />
                    <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={8} stroke={CHROME.muted} />
                    <YAxis
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(v) => `${v}%`}
                      stroke={CHROME.muted}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    {[...TRANSICIONES]
                      .sort((a, b) => (a.key === cuelloDeBotella?.key ? 1 : b.key === cuelloDeBotella?.key ? -1 : 0))
                      .map((t) => (
                      <Line
                        key={t.key}
                        dataKey={t.key}
                        type="monotone"
                        stroke={`var(--color-${t.key})`}
                        strokeWidth={2}
                        dot={{ r: 4, fill: `var(--color-${t.key})` }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        )}

        {/* Comparacion por setter — Sprint 3, punto 3 */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-white">Comparación por setter</CardTitle>
              <p className="text-sm text-slate-400">
                Conversión de cada setter en el período seleccionado — cada transición se atribuye a
                quien tenía el lead asignado en ese momento, no al dueño actual
              </p>
            </CardHeader>
            <CardContent>
              {!porSetter ? (
                <p className="text-sm text-slate-400 py-8 text-center">Calculando...</p>
              ) : porSetter.setters.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">No hay setters registrados.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="text-left p-3 font-medium text-slate-400">Setter</th>
                        {TRANSICIONES.map((t) => (
                          <th key={t.key} className="text-right p-3 font-medium text-slate-400">
                            {t.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {porSetter.setters.map((s) => (
                        <tr
                          key={s.id}
                          className={`border-b border-white/5 ${!s.activo ? "text-slate-500" : "text-white"}`}
                        >
                          <td className="p-3 font-medium">
                            {s.nombre}
                            {!s.activo && <span className="text-xs ml-2 font-normal">(inactivo)</span>}
                          </td>
                          {TRANSICIONES.map((t) => {
                            const valor = s.tasas[t.key];
                            const valorEquipo = dashboard?.embudo.actual.tasas[t.key] ?? null;
                            const esDebil =
                              s.activo &&
                              t.key === cuelloDeBotella?.key &&
                              valor !== null &&
                              valorEquipo !== null &&
                              valor < valorEquipo;
                            return (
                              <CeldaTasa
                                key={t.key}
                                valor={valor}
                                conteos={s.conteos}
                                transicion={t.key}
                                resaltada={esDebil}
                              />
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Comparacion por origen — Sprint 3, punto 4 */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-white">Comparación por origen</CardTitle>
              <p className="text-sm text-slate-400">
                Qué fuente convierte mejor en el período seleccionado — el origen es fijo desde que se creó el lead
              </p>
            </CardHeader>
            <CardContent>
              {!porOrigen ? (
                <p className="text-sm text-slate-400 py-8 text-center">Calculando...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="text-left p-3 font-medium text-slate-400">Origen</th>
                        {TRANSICIONES.map((t) => (
                          <th key={t.key} className="text-right p-3 font-medium text-slate-400">
                            {t.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {porOrigen.origenes.map((o) => (
                        <tr key={o.origen} className="border-b border-white/5 text-white">
                          <td className="p-3 font-medium">{ORIGEN_LABELS[o.origen] ?? o.origen}</td>
                          {TRANSICIONES.map((t) => {
                            const valor = o.tasas[t.key];
                            const valorEquipo = dashboard?.embudo.actual.tasas[t.key] ?? null;
                            const esDebil =
                              t.key === cuelloDeBotella?.key &&
                              valor !== null &&
                              valorEquipo !== null &&
                              valor < valorEquipo;
                            return (
                              <CeldaTasa
                                key={t.key}
                                valor={valor}
                                conteos={o.conteos}
                                transicion={t.key}
                                resaltada={esDebil}
                              />
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Ultimos leads */}
        {leads && leads.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-white">Leads recientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-2 px-3 font-medium text-slate-400">
                        Nombre
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-slate-400">
                        Instagram
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-slate-400">
                        Etapa
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-slate-400">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.slice(0, 10).map((lead) => (
                      <tr
                        key={lead.id}
                        className="border-b border-white/5 hover:bg-white/5"
                      >
                        <td className="py-2 px-3 font-medium text-white">
                          {lead.nombre}
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          @{lead.instagramUsername}
                        </td>
                        <td className="py-2 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white/10 text-slate-200">
                            {lead.etapaActual ?? "Sin etapa"}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {lead.descartado ? (
                            <span className="text-xs font-medium" style={{ color: STATUS.critical }}>
                              {lead.motivoDescarte}
                            </span>
                          ) : (
                            <span className="text-xs font-medium" style={{ color: STATUS.good }}>
                              Activo
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
