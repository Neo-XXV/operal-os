import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { PeriodoSelector } from "@/components/PeriodoSelector";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, PhoneCall } from "lucide-react";

// Mismos pasos dark de la paleta categorica validada que ya usa Dashboard.tsx
// (skill dataviz, references/palette.md) -- no se reinventan hex nuevos.
const CAT = {
  blue: "#3987e5",
  orange: "#d95926",
  aqua: "#199e70",
  yellow: "#c98500",
  magenta: "#d55181",
  violet: "#9085e9",
};

function formatUSD(centavos: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(centavos / 100);
}

function formatPct(v: number | null) {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
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

function Tile({
  label,
  value,
  gradient,
  info,
}: {
  label: string;
  value: string;
  gradient: [string, string];
  info?: string;
}) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col justify-between min-h-[110px]"
      style={{ backgroundImage: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}
    >
      <span className="text-sm font-medium text-white/90 flex items-center">
        {label}
        {info && <InfoTip texto={info} />}
      </span>
      <span className="text-3xl font-bold text-white">{value}</span>
    </div>
  );
}

function TileSecundaria({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col justify-between min-h-[90px]"
      style={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
    >
      <span className="text-xs font-medium text-muted-foreground flex items-center">
        {label}
        {info && <InfoTip texto={info} />}
      </span>
      <span className="text-xl font-semibold text-foreground">{value}</span>
    </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile
              label="Close Rate"
              value={formatPct(data.closeRate)}
              gradient={[CAT.violet, CAT.magenta]}
              info="Cerrados / calificados. El KPI principal de la fase de llamada — mide qué tan bien cierra el closer sobre leads que sí eran aptos."
            />
            <Tile
              label="Cash Collected"
              value={formatUSD(data.cashCollected)}
              gradient={[CAT.blue, CAT.aqua]}
              info="Suma de los pagos registrados con fecha de cobro en este período. Un plan de pagos puede hacer que una cuota de un cierre de otro mes entre acá."
            />
            <Tile
              label="Clientes cerrados"
              value={String(data.clientesCerrados)}
              gradient={[CAT.orange, CAT.yellow]}
            />
            <Tile
              label="Show Up Rate"
              value={formatPct(data.showUpRate)}
              gradient={[CAT.aqua, CAT.blue]}
              info={'Se presentaron / llamadas totales de este período. "Llamadas totales" acá NO es lo mismo que "Agendados" del dashboard del setter (ese cuenta leads que llegaron a D, este cuenta llamadas realizadas) — son ejes de tiempo distintos, no deberían compararse entre sí.'}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <TileSecundaria
              label="Llamadas totales / calificadas"
              value={`${data.llamadasTotales} / ${data.llamadasCalificadas}`}
              info="Cantidad de llamadas registradas en el período y cuántas de esas calificaban al lead."
            />
            <TileSecundaria
              label="AOV (Call Efectiva)"
              value={formatUSD(data.aovCallEfectiva ?? 0)}
              info="Cash collected del período / llamadas efectivas (se presentaron) del período — no necesariamente son los mismos leads que generaron ese cash, por los planes de pago. Puede salir alto un mes con muchas cuotas viejas y pocas llamadas nuevas."
            />
            <TileSecundaria
              label="AOV (Trato Cerrado)"
              value={formatUSD(data.aovTratoCerrado ?? 0)}
              info="Cash collected del período / clientes cerrados del período — misma salvedad que el AOV de arriba: numerador y denominador pueden hablar de leads distintos."
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
