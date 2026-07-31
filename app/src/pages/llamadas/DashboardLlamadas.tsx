import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { PeriodoSelector } from "@/components/PeriodoSelector";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, PhoneCall } from "lucide-react";
import { StatTile, HeroFigure } from "@/components/charts/StatTile";
import { Medidor } from "@/components/charts/Medidor";
import { formatPct } from "@/lib/embudoDisplay";

function formatUSD(centavos: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(centavos / 100);
}

function InfoTip({ texto }: { texto: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground cursor-help inline ml-1" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">{texto}</TooltipContent>
    </Tooltip>
  );
}

export function DashboardLlamadas() {
  const [periodo, setPeriodo] = useState("mensual");
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");

  const habilitada = periodo !== "rango" || !!rangoDesde;
  const { data, isLoading } = trpc.event.dashboardLlamadas.useQuery(
    {
      periodo: periodo as "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango",
      desde: periodo === "rango" && rangoDesde ? new Date(rangoDesde) : undefined,
      hasta: periodo === "rango" && rangoHasta ? new Date(rangoHasta) : undefined,
    },
    { enabled: habilitada },
  );

  return (
    <div className="space-y-6">
      <PeriodoSelector
        periodo={periodo}
        onPeriodoChange={setPeriodo}
        rangoDesde={rangoDesde}
        onRangoDesdeChange={setRangoDesde}
        rangoHasta={rangoHasta}
        onRangoHastaChange={setRangoHasta}
      />

      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Calculando...</p>
      ) : (
        <>
          {/* Jerarquia: Close Rate es el KPI principal declarado de la fase
              de cierre (06_sprint_4.md), asi que va como hero figure -- uno
              solo por vista. Cash collected lo acompana como segunda lectura.
              Ninguno lleva delta ni sparkline: dashboardLlamadas devuelve
              solo escalares, sin periodo anterior ni serie. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <HeroFigure
              label="Close Rate"
              value={formatPct(data.closeRate)}
              sub={
                <span className="flex items-center">
                  {data.clientesCerrados} cerrados sobre {data.llamadasCalificadas} calificadas
                  <InfoTip texto="Cerrados / calificados. El KPI principal de la fase de llamada — mide qué tan bien cierra el closer sobre leads que sí eran aptos." />
                </span>
              }
            />
            <StatTile
              label="Cash Collected"
              value={formatUSD(data.cashCollected)}
              info={
                <InfoTip texto="Suma de los pagos registrados con fecha de cobro en este período. Un plan de pagos puede hacer que una cuota de un cierre de otro mes entre acá." />
              }
            />
            <StatTile label="Clientes cerrados" value={String(data.clientesCerrados)} />
          </div>

          {/* Show Up Rate es una razon, pero el sistema NO define un umbral
              para ella (a diferencia de MSR/PRR/CSR). El medidor cae a
              escala 0-100% con color neutro: sin limite contra el cual
              comparar no hay "bueno" ni "malo" que afirmar. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Medidor
              label="Show Up Rate"
              valor={data.showUpRate}
              // showUpRate = sePresentaron / llamadasTotales, asi que el
              // numerador se reconstruye exacto; el endpoint no lo devuelve
              // por separado.
              conteo={
                data.showUpRate !== null
                  ? { num: Math.round(data.showUpRate * data.llamadasTotales), den: data.llamadasTotales }
                  : undefined
              }
              descripcion="Se presentaron sobre llamadas del período"
            />
            <StatTile
              label="Llamadas totales / calificadas"
              value={`${data.llamadasTotales} / ${data.llamadasCalificadas}`}
              info={
                <InfoTip texto="Cantidad de llamadas registradas en el período y cuántas de esas calificaban al lead." />
              }
            />
            <StatTile
              label="AOV (Call Efectiva)"
              value={formatUSD(data.aovCallEfectiva ?? 0)}
              info={
                <InfoTip texto="Cash collected del período / llamadas efectivas (se presentaron) del período — no necesariamente son los mismos leads que generaron ese cash, por los planes de pago. Puede salir alto un mes con muchas cuotas viejas y pocas llamadas nuevas." />
              }
            />
            <StatTile
              label="AOV (Trato Cerrado)"
              value={formatUSD(data.aovTratoCerrado ?? 0)}
              info={
                <InfoTip texto="Cash collected del período / clientes cerrados del período — misma salvedad que el AOV de arriba: numerador y denominador pueden hablar de leads distintos." />
              }
            />
          </div>

          {(data.llamadasTotales === 0 && data.cashCollected === 0) && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <PhoneCall className="w-4 h-4" />
              Sin actividad de llamadas ni pagos en este período.
            </p>
          )}
        </>
      )}
    </div>
  );
}
