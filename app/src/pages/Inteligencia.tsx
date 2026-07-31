import { useState } from "react";
import { Navigate } from "react-router";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { PanelIA } from "@/components/ia/PanelIA";
import { PeriodoSelector } from "@/components/PeriodoSelector";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPct } from "@/lib/embudoDisplay";

// Primera UI de la capa de IA (docs/10_arquitectura_ia.md). Los 4 endpoints
// ya existian sin pantalla. Todo es adminQuery en el backend; el guard de
// ruta de aca es solo UX, la barrera real esta del otro lado.
//
// Las 4 son mutations aunque "consulten": cada invocacion llama a un
// proveedor externo de pago, no es idempotente ni gratis, y no debe
// dispararse sola por refetch de react-query.

const MOTIVOS_DESCARTE = [
  { value: "SIN_RESPUESTA", label: "Sin respuesta" },
  { value: "RECHAZO_EXPLICITO", label: "Rechazo explicito" },
  { value: "NO_CALIFICA", label: "No califica" },
  { value: "DUPLICADO", label: "Duplicado" },
  { value: "ERROR_CARGA", label: "Error de carga" },
  { value: "HISTORICO", label: "Histórico (importación)" },
];

const TIPOS_CONVERSION = ["MSR_BAJO", "PRR_BAJO", "CSR_BAJO"];

const ANOMALIA_LABELS: Record<string, string> = {
  MSR_BAJO: "Tasa de respuesta baja (A → MS)",
  PRR_BAJO: "Tasa de pitch baja (MS → B)",
  CSR_BAJO: "Tasa de agendado baja (B → C)",
};

export default function Inteligencia() {
  const { isAdmin, isLoading } = useAuth();

  // ─── 1. Top-3 acciones del dia (sin input) ───────────────────────
  const top3 = trpc.ia.top3AccionesDelDia.useMutation();

  // ─── 2. Explicar anomalia de conversion ──────────────────────────
  // Se elige primero el setter y despues cual de SUS anomalias de
  // conversion explicar: no existe un endpoint que liste todas las
  // anomalias del sistema, y el que hay (listarPorSetter) pide setterId.
  const [setterElegido, setSetterElegido] = useState<string>("");
  const { data: setters } = trpc.user.setters.useQuery(undefined, { enabled: isAdmin });
  const { data: anomalias } = trpc.anomalia.listarPorSetter.useQuery(
    { setterId: Number(setterElegido) },
    { enabled: isAdmin && !!setterElegido },
  );
  const anomaliasConversion = (anomalias ?? []).filter((a) =>
    TIPOS_CONVERSION.includes((a.payload as { tipo_anomalia: string }).tipo_anomalia),
  );
  const [anomaliaElegida, setAnomaliaElegida] = useState<string>("");
  const explicar = trpc.ia.explicarAnomaliaConversion.useMutation();

  // ─── 3. Resumen de objeciones ────────────────────────────────────
  const [periodoObj, setPeriodoObj] = useState("lifetime");
  const [objDesde, setObjDesde] = useState("");
  const [objHasta, setObjHasta] = useState("");
  const objeciones = trpc.ia.resumirObjeciones.useMutation();

  // ─── 4. Analisis de leads ────────────────────────────────────────
  const [alcance, setAlcance] = useState<"recientes" | "descartados">("recientes");
  const [limite, setLimite] = useState("20");
  const [motivo, setMotivo] = useState("");
  const analizar = trpc.ia.analizarLeads.useMutation();

  if (isLoading) return null;
  if (!isAdmin) return <Navigate to="/leads" replace />;

  return (
    <Layout>
      <div className="-m-6 p-6 min-h-[calc(100vh-1px)] text-foreground space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inteligencia</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            Análisis en lenguaje natural sobre datos que el sistema ya calculó. La IA no lee la base directamente
            ni recalcula números: recibe los KPIs y anomalías ya computados, y solo los interpreta.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <PanelIA
            titulo="Top-3 acciones del día"
            descripcion="Prioriza qué atender hoy, según las anomalías activas y los KPIs del mes contra sus umbrales."
            onAnalizar={() => top3.mutate()}
            cargando={top3.isPending}
            respuesta={top3.data?.respuesta}
            advertencia={top3.data?.advertencia}
            error={top3.error?.message ?? null}
          />

          <PanelIA
            titulo="Explicar una anomalía de conversión"
            descripcion="Toma una anomalía ya detectada por el motor de reglas y explica qué la disparó."
            controles={
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Setter</Label>
                  <Select
                    value={setterElegido}
                    onValueChange={(v) => {
                      setSetterElegido(v);
                      setAnomaliaElegida("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Elegir setter" />
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
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Anomalía</Label>
                  <Select value={anomaliaElegida} onValueChange={setAnomaliaElegida} disabled={!setterElegido}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !setterElegido
                            ? "Elegí un setter primero"
                            : anomaliasConversion.length === 0
                              ? "Sin anomalías de conversión"
                              : "Elegir anomalía"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {anomaliasConversion.map((a) => {
                        const p = a.payload as { tipo_anomalia: string; tasa_medida: number | null };
                        return (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {ANOMALIA_LABELS[p.tipo_anomalia] ?? p.tipo_anomalia} · {formatPct(p.tasa_medida)}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            }
            onAnalizar={() => explicar.mutate({ anomaliaId: Number(anomaliaElegida) })}
            cargando={explicar.isPending}
            deshabilitado={!anomaliaElegida}
            respuesta={explicar.data?.respuesta}
            advertencia={explicar.data?.advertencia}
            error={explicar.error?.message ?? null}
          />

          <PanelIA
            titulo="Resumen de objeciones"
            descripcion="Objeciones más frecuentes, patrones en el texto libre y qué sugiere para el guion."
            controles={
              <PeriodoSelector
                periodo={periodoObj}
                onPeriodoChange={setPeriodoObj}
                rangoDesde={objDesde}
                onRangoDesdeChange={setObjDesde}
                rangoHasta={objHasta}
                onRangoHastaChange={setObjHasta}
              />
            }
            onAnalizar={() =>
              objeciones.mutate({
                periodo: periodoObj as "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango",
                desde: periodoObj === "rango" && objDesde ? new Date(objDesde) : undefined,
                hasta: periodoObj === "rango" && objHasta ? new Date(objHasta) : undefined,
              })
            }
            cargando={objeciones.isPending}
            deshabilitado={periodoObj === "rango" && !objDesde}
            respuesta={objeciones.data?.respuesta}
            advertencia={objeciones.data?.advertencia}
            error={objeciones.error?.message ?? null}
          />

          <PanelIA
            titulo="Análisis de leads"
            descripcion="Dónde se caen y qué diferencia a los que avanzan. Con más de 30 leads el análisis pasa a agregados por segmento, no lead por lead."
            controles={
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Alcance</Label>
                  <Select value={alcance} onValueChange={(v) => setAlcance(v as "recientes" | "descartados")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recientes">Leads recientes</SelectItem>
                      <SelectItem value="descartados">Descartados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {alcance === "recientes" ? (
                  <div className="w-full sm:w-32 space-y-1">
                    <Label className="text-xs text-muted-foreground">Cantidad</Label>
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={limite}
                      onChange={(e) => setLimite(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Motivo (opcional)</Label>
                    <Select value={motivo} onValueChange={setMotivo}>
                      <SelectTrigger>
                        <SelectValue placeholder="Todos los motivos" />
                      </SelectTrigger>
                      <SelectContent>
                        {MOTIVOS_DESCARTE.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            }
            onAnalizar={() =>
              analizar.mutate({
                alcance,
                limite: Math.min(500, Math.max(1, Number(limite) || 20)),
                motivoDescarte: alcance === "descartados" && motivo ? motivo : undefined,
              })
            }
            cargando={analizar.isPending}
            respuesta={
              analizar.data
                ? `[modo ${analizar.data.modo}]\n\n${analizar.data.respuesta}`
                : undefined
            }
            advertencia={analizar.data?.advertencia}
            error={analizar.error?.message ?? null}
          />
        </div>
      </div>
    </Layout>
  );
}
