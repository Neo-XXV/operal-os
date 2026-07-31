import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PeriodoSelector } from "@/components/PeriodoSelector";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { TriangleAlert } from "lucide-react";
import {
  STATUS,
  CHROME,
  TRANSICIONES,
  ETAPAS_TASA,
  formatPct,
  wash,
  CeldaTasa,
  DeltaTasa,
} from "@/lib/embudoDisplay";
import { StatTile } from "@/components/charts/StatTile";
import { Medidor } from "@/components/charts/Medidor";
import { MiniEmbudo } from "@/components/charts/MiniEmbudo";
// Umbrales reales del motor de reglas -- unica fuente (docs/02_reglas_de_negocio
// seccion 9), no se duplican los numeros aca. Vive en contracts/ y no en api/
// porque el frontend NO puede importar de api/ por ruta relativa: esa URL cae
// bajo /api/*, que el router de Hono reclama y responde 404. contracts/ existe
// justo para el codigo que cruza la frontera (tiene alias en ambos lados).
import { ANOMALIA_CONFIG } from "@contracts/anomaliaConfig";

// Mapea cada transicion del embudo a su umbral/objetivo. ABR queda afuera a
// proposito: no existe umbral de tasa para C -> D (ver comentario en el
// render), asi que esa transicion no lleva medidor.
const UMBRAL_POR_TRANSICION: Record<string, { umbral: number; objetivo: number | null } | undefined> = {
  MSR: { umbral: ANOMALIA_CONFIG.conversion.MSR_BAJO.umbral, objetivo: ANOMALIA_CONFIG.conversion.MSR_BAJO.objetivo },
  PRR: { umbral: ANOMALIA_CONFIG.conversion.PRR_BAJO.umbral, objetivo: ANOMALIA_CONFIG.conversion.PRR_BAJO.objetivo },
  CSR: { umbral: ANOMALIA_CONFIG.conversion.CSR_BAJO.umbral, objetivo: ANOMALIA_CONFIG.conversion.CSR_BAJO.objetivo },
  ABR: undefined,
};

// Formato compacto para valores de stat tile (contrato del sistema).
function fmtNum(v: number | undefined) {
  if (v === undefined) return "—";
  return v >= 10000 ? `${(v / 1000).toFixed(1).replace(".", ",")}K` : String(v);
}

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

export default function Dashboard() {
  const { user, isAdmin, isSetter } = useAuth();
  const { data: leads } = trpc.lead.list.useQuery();

  const [periodo, setPeriodo] = useState("mensual");
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");

  const queryHabilitada = isAdmin && (periodo !== "rango" || !!rangoDesde);

  // placeholderData en cada query: al cambiar de periodo la key cambia y,
  // sin esto, react-query descarta el render anterior y la pantalla salta a
  // "Calculando..." (el anti-patron de "skeleton flash on refetch"). Con esto
  // se sostiene el render previo y solo se baja la opacidad mientras llega el
  // dato nuevo -- sin salto de layout. Va inline y no en un objeto compartido
  // porque el tipo del placeholder es el de CADA query.

  const { data: dashboard, isFetching: refrescandoDashboard } = trpc.event.dashboardEjecutivo.useQuery(
    {
      periodo: periodo as "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango",
      desde: periodo === "rango" && rangoDesde ? new Date(rangoDesde) : undefined,
      hasta: periodo === "rango" && rangoHasta ? new Date(rangoHasta) : undefined,
    },
    { enabled: queryHabilitada, placeholderData: (prev) => prev },
  );

  // Sprint 3, punto 2: serie historica — solo tiene sentido para las 4
  // granularidades calendario (lifetime/rango no tienen una unidad de
  // bucket natural que inventar).
  const { data: historico } = trpc.event.dashboardHistorico.useQuery(
    { granularidad: periodo as GranularidadHistorico },
    { enabled: isAdmin && esGranularidadHistorico(periodo), placeholderData: (prev) => prev },
  );

  // Sprint 3, punto 3: comparacion por setter — respeta el mismo periodo
  // que el resto del dashboard (misma logica de habilitacion que dashboardEjecutivo).
  const { data: porSetter } = trpc.event.embudoPorSetter.useQuery(
    {
      periodo: periodo as "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango",
      desde: periodo === "rango" && rangoDesde ? new Date(rangoDesde) : undefined,
      hasta: periodo === "rango" && rangoHasta ? new Date(rangoHasta) : undefined,
    },
    { enabled: queryHabilitada, placeholderData: (prev) => prev },
  );

  // Sprint 3, punto 4: comparacion por origen del lead — mismo periodo.
  const { data: porOrigen } = trpc.event.embudoPorOrigen.useQuery(
    {
      periodo: periodo as "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango",
      desde: periodo === "rango" && rangoDesde ? new Date(rangoDesde) : undefined,
      hasta: periodo === "rango" && rangoHasta ? new Date(rangoHasta) : undefined,
    },
    { enabled: queryHabilitada, placeholderData: (prev) => prev },
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

  // Las etiquetas y el orden de las etapas ahora viven en MiniEmbudo, que es
  // el unico consumidor -- no hacia falta mantenerlos aca duplicados.

  const cuelloDeBotella = dashboard?.cuelloDeBotella;
  const transicionCuelloDeBotella = cuelloDeBotella
    ? TRANSICIONES.find((t) => t.key === cuelloDeBotella.key)
    : null;

  // Serie real para las sparklines de las stat tiles. Devuelve undefined
  // cuando el periodo elegido no tiene serie (lifetime/rango) -- la tile
  // entonces se dibuja sin sparkline, en vez de interpolar una tendencia
  // que el backend no calculo.
  //
  // El gate va contra el PERIODO, no contra `historico`: placeholderData
  // sostiene a proposito el dato de la consulta anterior, asi que al pasar a
  // lifetime `historico` sigue trayendo la serie mensual vieja. Sin este
  // chequeo la tile mostraria un valor lifetime con una tendencia mensual
  // pegada al lado -- que es justo la mentira que se queria evitar.
  const hayserie = esGranularidadHistorico(periodo);
  const serieDe = (kpi: "leadsNuevos" | "activos" | "descartados" | "agendados") =>
    hayserie ? historico?.serie.map((b) => b.kpis[kpi]) : undefined;

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
      <div className="-m-6 p-6 min-h-[calc(100vh-1px)] bg-background text-foreground space-y-6">
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="por-setter">Por setter</TabsTrigger>
          </TabsList>
          <TabsContent value="por-setter" className="mt-4">
            <PorSetterTab />
          </TabsContent>
          {/* Sostiene el render previo con opacidad reducida mientras llega
              el dato del periodo nuevo -- sin salto de layout. */}
          <TabsContent
            value="general"
            className={`mt-4 space-y-6 transition-opacity ${refrescandoDashboard ? "opacity-60" : "opacity-100"}`}
          >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Hola, {user?.nombre}
            </h1>
            <p className="text-muted-foreground mt-1">
              {isAdmin
                ? "Panel de administracion del sistema"
                : "Estos son tus leads asignados"}
            </p>
          </div>

          {isAdmin && (
            <PeriodoSelector
              periodo={periodo}
              onPeriodoChange={setPeriodo}
              rangoDesde={rangoDesde}
              onRangoDesdeChange={setRangoDesde}
              rangoHasta={rangoHasta}
              onRangoHastaChange={setRangoHasta}
            />
          )}
        </div>

        {isAdmin && (
          <>
            {/* Cuello de botella — status de alerta, no una tile decorativa:
                borde + icono en el color de "warning" fijo, nunca color solo. */}
            <div
              className="rounded-2xl p-5"
              style={{ backgroundColor: "hsl(var(--card))", border: `1px solid ${wash(STATUS.warning, 25)}` }}
            >
              {!cuelloDeBotella || !transicionCuelloDeBotella ? (
                <p className="text-sm text-muted-foreground">
                  Todavia no hay suficientes datos en este período para identificar un cuello de botella.
                </p>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-full shrink-0"
                    style={{ backgroundColor: wash(STATUS.warning, 15) }}
                  >
                    <TriangleAlert className="w-6 h-6" style={{ color: STATUS.warning }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: STATUS.warning }}>
                      Cuello de botella
                    </p>
                    <p className="text-lg font-semibold text-foreground mt-0.5">
                      {transicionCuelloDeBotella.label}{" "}
                      <span className="text-muted-foreground font-normal">({transicionCuelloDeBotella.desc})</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl font-semibold text-foreground">
                      {formatPct(cuelloDeBotella.valorActual)}
                    </span>
                    {cuelloDeBotella.tendencia === "sin_datos_previos" ? (
                      <span className="text-xs text-muted-foreground">Sin período anterior para comparar</span>
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
              <StatTile
                label="Leads nuevos"
                value={fmtNum(dashboard?.kpis.actual.leadsNuevos)}
                trend={serieDe("leadsNuevos")}
                delta={dashboard ? { actual: dashboard.kpis.actual.leadsNuevos, anterior: dashboard.kpis.anterior?.leadsNuevos ?? null } : undefined}
              />
              <StatTile
                label="Activos"
                value={fmtNum(dashboard?.kpis.actual.activos)}
                trend={serieDe("activos")}
                delta={dashboard ? { actual: dashboard.kpis.actual.activos, anterior: dashboard.kpis.anterior?.activos ?? null } : undefined}
              />
              <StatTile
                label="Descartados"
                value={fmtNum(dashboard?.kpis.actual.descartados)}
                trend={serieDe("descartados")}
                // Metrica invertida: subir es malo. Solo cambia el color del
                // delta -- el tratamiento visual nunca sugiere que un numero
                // alto aca sea un logro.
                invertido
                delta={dashboard ? { actual: dashboard.kpis.actual.descartados, anterior: dashboard.kpis.anterior?.descartados ?? null } : undefined}
              />
              <StatTile
                label="Agendados"
                value={fmtNum(dashboard?.kpis.actual.agendados)}
                trend={serieDe("agendados")}
                delta={dashboard ? { actual: dashboard.kpis.actual.agendados, anterior: dashboard.kpis.anterior?.agendados ?? null } : undefined}
              />
            </div>
          </>
        )}

        {/* Embudo visual — distribucion actual del pipeline (no depende del periodo) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Embudo comercial</CardTitle>
            <p className="text-sm text-muted-foreground">
              Distribucion de leads por etapa
            </p>
          </CardHeader>
          <CardContent>
            <MiniEmbudo
              conteos={leadsByStage}
              extra={[{ key: "Sin etapa", label: "Sin etapa", valor: leadsByStage["Sin etapa"] ?? 0 }]}
            />
          </CardContent>
        </Card>

        {/* Conversion entre etapas del periodo seleccionado */}
        {isAdmin && dashboard && (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Conversion entre etapas</CardTitle>
              <p className="text-sm text-muted-foreground">
                Que porcentaje de los leads que llegan a una etapa avanzan a la siguiente, en el período seleccionado
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {TRANSICIONES.map((t) => {
                  const valor = dashboard.embudo.actual.tasas[t.key];
                  const valorAnterior = dashboard.embudo.anterior?.tasas[t.key] ?? null;
                  const umbrales = UMBRAL_POR_TRANSICION[t.key];
                  const conteos = dashboard.embudo.actual.conteos;
                  const { num, den } = ETAPAS_TASA[t.key];

                  // ABR (C -> D) no tiene umbral de tasa: por diseno del
                  // dominio la anomalia de C->D es puramente de TIEMPO y
                  // reemplaza a cualquier "ABR bajo" (02_reglas_de_negocio
                  // seccion 9). Sin umbral no hay medidor honesto que
                  // dibujar, asi que esa transicion se muestra como tasa
                  // simple con su delta.
                  if (!umbrales) {
                    return (
                      <div key={t.key} className="rounded-2xl bg-card border border-border shadow-panel p-4">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.label} <span className="text-muted-foreground">({t.key})</span>
                        </span>
                        <p className="text-lg font-semibold text-foreground mt-2 tabular-nums">
                          {formatPct(valor)}
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                            {conteos[num]}/{conteos[den]}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5">Sin umbral: se evalúa por tiempo</p>
                        <div className="mt-2">
                          <DeltaTasa actual={valor} anterior={valorAnterior} />
                        </div>
                      </div>
                    );
                  }

                  return (
                    <Medidor
                      key={t.key}
                      label={`${t.label} (${t.key})`}
                      valor={valor}
                      umbral={umbrales.umbral}
                      objetivo={umbrales.objetivo}
                      conteo={{ num: conteos[num], den: conteos[den] }}
                      descripcion={t.desc}
                    />
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
              <CardTitle className="text-foreground">Evolución histórica</CardTitle>
              <p className="text-sm text-muted-foreground">
                Conversión por etapa a lo largo del tiempo — la línea resaltada es el cuello de botella actual
              </p>
            </CardHeader>
            <CardContent>
              {!esGranularidadHistorico(periodo) ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Elegí un período mensual, trimestral, semestral o anual para ver la evolución histórica.
                </p>
              ) : !datosHistorico ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Calculando...</p>
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
              <CardTitle className="text-foreground">Comparación por setter</CardTitle>
              <p className="text-sm text-muted-foreground">
                Conversión de cada setter en el período seleccionado — cada transición se atribuye a
                quien tenía el lead asignado en ese momento, no al dueño actual
              </p>
            </CardHeader>
            <CardContent>
              {!porSetter ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Calculando...</p>
              ) : porSetter.setters.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No hay setters registrados.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left p-3 font-medium text-muted-foreground">Setter</th>
                        {TRANSICIONES.map((t) => (
                          <th key={t.key} className="text-right p-3 font-medium text-muted-foreground">
                            {t.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {porSetter.setters.map((s) => (
                        <tr
                          key={s.id}
                          className={`border-b border-border ${!s.activo ? "text-muted-foreground" : "text-foreground"}`}
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
              <CardTitle className="text-foreground">Comparación por origen</CardTitle>
              <p className="text-sm text-muted-foreground">
                Qué fuente convierte mejor en el período seleccionado — el origen es fijo desde que se creó el lead
              </p>
            </CardHeader>
            <CardContent>
              {!porOrigen ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Calculando...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left p-3 font-medium text-muted-foreground">Origen</th>
                        {TRANSICIONES.map((t) => (
                          <th key={t.key} className="text-right p-3 font-medium text-muted-foreground">
                            {t.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {porOrigen.origenes.map((o) => (
                        <tr key={o.origen} className="border-b border-border text-foreground">
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
              <CardTitle className="text-foreground">Leads recientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                        Nombre
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                        Instagram
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                        Etapa
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.slice(0, 10).map((lead) => (
                      <tr
                        key={lead.id}
                        className="border-b border-border hover:bg-muted/50"
                      >
                        <td className="py-2 px-3 font-medium text-foreground">
                          {lead.nombre}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">
                          @{lead.instagramUsername}
                        </td>
                        <td className="py-2 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
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
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

// Selector de setter para el admin -- al elegir uno, navega a su dashboard
// individual (ruta propia, /dashboard/setter/:id) en vez de reemplazar este
// contenido -- misma pagina que usa el setter para ver el suyo (ver
// DashboardSetter.tsx).
function PorSetterTab() {
  const navigate = useNavigate();
  const { data: setters } = trpc.user.setters.useQuery();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">Dashboard por setter</CardTitle>
        <p className="text-sm text-muted-foreground">
          Elegí un setter para ver su embudo, su CRM y sus anomalías detectadas
        </p>
      </CardHeader>
      <CardContent>
        <Select onValueChange={(id) => navigate(`/dashboard/setter/${id}`)}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue placeholder="Seleccionar setter" />
          </SelectTrigger>
          <SelectContent>
            {(setters ?? []).map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.nombre}
                {!s.activo && " (inactivo)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
