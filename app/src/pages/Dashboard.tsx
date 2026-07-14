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

// Forma "emphasis" (skill dataviz): una serie es el punto, el resto es
// contexto — 1 hue de acento + gris, no 4 colores categoricos. El acento es
// el mismo ambar de "status" ya usado en esta pagina para el cuello de
// botella; cual de las 4 series lo lleva se decide en runtime (cuelloDeBotella.key),
// nunca hardcodeado.
const COLOR_ACENTO = "#d97706"; // amber-600
const COLOR_CONTEXTO = "#94a3b8"; // slate-400

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

function formatPct(v: number | null) {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

// invertido=true significa "menos es mejor" (ej: descartados). El resto de
// las metricas del dashboard son "mas es mejor".
function DeltaConteo({ actual, anterior, invertido = false }: { actual: number; anterior: number | null; invertido?: boolean }) {
  if (anterior === null) {
    return <span className="text-xs text-slate-400">Sin dato previo</span>;
  }
  const delta = actual - anterior;
  return <DeltaVisual delta={delta} invertido={invertido} texto={`${delta > 0 ? "+" : ""}${delta}`} />;
}

function DeltaTasa({ actual, anterior }: { actual: number | null; anterior: number | null }) {
  if (actual === null || anterior === null) {
    return <span className="text-xs text-slate-400">Sin dato previo</span>;
  }
  const deltaPuntos = Math.round((actual - anterior) * 100);
  return <DeltaVisual delta={deltaPuntos} invertido={false} texto={`${deltaPuntos > 0 ? "+" : ""}${deltaPuntos}pp`} />;
}

function DeltaVisual({ delta, invertido, texto }: { delta: number; invertido: boolean; texto: string }) {
  if (delta === 0) {
    return (
      <span className="text-xs text-slate-400 flex items-center gap-1">
        <Minus className="w-3 h-3" />
        Sin cambio
      </span>
    );
  }
  const esBueno = invertido ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`text-xs flex items-center gap-1 font-medium ${esBueno ? "text-green-600" : "text-red-600"}`}>
      <Icon className="w-3 h-3" />
      {texto} vs. período anterior
    </span>
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
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Hola, {user?.nombre}
            </h1>
            <p className="text-slate-500 mt-1">
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
                    <Label className="text-xs">Desde</Label>
                    <Input
                      type="date"
                      value={rangoDesde}
                      onChange={(e) => setRangoDesde(e.target.value)}
                      className="w-36"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Hasta</Label>
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
            {/* Cuello de botella — el corazon del dashboard */}
            <Card className="border-amber-300 bg-amber-50">
              <CardContent className="p-5">
                {cargandoDashboard ? (
                  <p className="text-sm text-slate-500">Calculando...</p>
                ) : !cuelloDeBotella || !transicionCuelloDeBotella ? (
                  <p className="text-sm text-slate-500">
                    Todavia no hay suficientes datos en este período para identificar un cuello de botella.
                  </p>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 shrink-0">
                      <TriangleAlert className="w-6 h-6 text-amber-700" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                        Cuello de botella
                      </p>
                      <p className="text-lg font-semibold text-slate-900 mt-0.5">
                        {transicionCuelloDeBotella.label}{" "}
                        <span className="text-slate-500 font-normal">({transicionCuelloDeBotella.desc})</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-3xl font-semibold text-slate-900">
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
              </CardContent>
            </Card>

            {/* KPIs del periodo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500">Leads nuevos</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-slate-400" />
                    <span className="text-3xl font-bold">{dashboard?.kpis.actual.leadsNuevos ?? "—"}</span>
                  </div>
                  {dashboard && (
                    <div className="mt-2">
                      <DeltaConteo actual={dashboard.kpis.actual.leadsNuevos} anterior={dashboard.kpis.anterior?.leadsNuevos ?? null} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500">Activos</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-green-500" />
                    <span className="text-3xl font-bold">{dashboard?.kpis.actual.activos ?? "—"}</span>
                  </div>
                  {dashboard && (
                    <div className="mt-2">
                      <DeltaConteo actual={dashboard.kpis.actual.activos} anterior={dashboard.kpis.anterior?.activos ?? null} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500">Descartados</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <UserX className="w-5 h-5 text-red-400" />
                    <span className="text-3xl font-bold">{dashboard?.kpis.actual.descartados ?? "—"}</span>
                  </div>
                  {dashboard && (
                    <div className="mt-2">
                      <DeltaConteo
                        actual={dashboard.kpis.actual.descartados}
                        anterior={dashboard.kpis.anterior?.descartados ?? null}
                        invertido
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500">Agendados</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <CalendarCheck className="w-5 h-5 text-blue-400" />
                    <span className="text-3xl font-bold">{dashboard?.kpis.actual.agendados ?? "—"}</span>
                  </div>
                  {dashboard && (
                    <div className="mt-2">
                      <DeltaConteo actual={dashboard.kpis.actual.agendados} anterior={dashboard.kpis.anterior?.agendados ?? null} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Embudo visual — distribucion actual del pipeline (no depende del periodo) */}
        <Card>
          <CardHeader>
            <CardTitle>Embudo comercial</CardTitle>
            <p className="text-sm text-slate-500">
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
                    <div className="w-32 text-sm font-medium text-slate-600">
                      {stageNames[stage] ?? stage}
                    </div>
                    <div className="flex-1 h-8 bg-slate-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-slate-800 rounded-lg flex items-center px-3 transition-all"
                        style={{ width: `${Math.max(pct, 5)}%` }}
                      >
                        <span className="text-white text-sm font-semibold">
                          {count}
                        </span>
                      </div>
                    </div>
                    <div className="w-12 text-right text-sm text-slate-500">
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
              <CardTitle>Conversion entre etapas</CardTitle>
              <p className="text-sm text-slate-500">
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
                      className={`rounded-lg border p-4 ${
                        esCuelloDeBotella
                          ? "border-amber-300 bg-amber-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <p className="text-xs font-medium text-slate-500">
                        {t.label} <span className="text-slate-400">({t.key})</span>
                      </p>
                      <p className="text-2xl font-semibold text-slate-900 mt-1">
                        {formatPct(valor)}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">{t.desc}</p>
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
              <CardTitle>Evolución histórica</CardTitle>
              <p className="text-sm text-slate-500">
                Conversión por etapa a lo largo del tiempo — la línea resaltada es el cuello de botella actual
              </p>
            </CardHeader>
            <CardContent>
              {!esGranularidadHistorico(periodo) ? (
                <p className="text-sm text-slate-500 py-8 text-center">
                  Elegí un período mensual, trimestral, semestral o anual para ver la evolución histórica.
                </p>
              ) : !datosHistorico ? (
                <p className="text-sm text-slate-500 py-8 text-center">Calculando...</p>
              ) : (
                <ChartContainer config={chartConfigHistorico} className="h-72 w-full">
                  <LineChart data={datosHistorico} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(v) => `${v}%`}
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

        {/* Ultimos leads */}
        {leads && leads.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Leads recientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-3 font-medium text-slate-500">
                        Nombre
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-slate-500">
                        Instagram
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-slate-500">
                        Etapa
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-slate-500">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.slice(0, 10).map((lead) => (
                      <tr
                        key={lead.id}
                        className="border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="py-2 px-3 font-medium">
                          {lead.nombre}
                        </td>
                        <td className="py-2 px-3 text-slate-500">
                          @{lead.instagramUsername}
                        </td>
                        <td className="py-2 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                            {lead.etapaActual ?? "Sin etapa"}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {lead.descartado ? (
                            <span className="text-red-600 text-xs font-medium">
                              {lead.motivoDescarte}
                            </span>
                          ) : (
                            <span className="text-green-600 text-xs font-medium">
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
