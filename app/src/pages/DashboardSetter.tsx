import { useState } from "react";
import { useParams, Navigate, Link } from "react-router";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import {
  GlassPanel as Card,
  GlassPanelContent as CardContent,
  GlassPanelHeader as CardHeader,
  GlassPanelTitle as CardTitle,
} from "@/components/GlassPanel";
import { Button } from "@/components/ui/button";
import { PeriodoSelector } from "@/components/PeriodoSelector";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { STATUS, TRANSICIONES, ETAPAS_TASA, formatPct, wash } from "@/lib/embudoDisplay";
import { Medidor } from "@/components/charts/Medidor";
import { MiniEmbudo } from "@/components/charts/MiniEmbudo";
// Mismos umbrales reales que usa el ejecutivo y el motor de reglas.
import { ANOMALIA_CONFIG } from "@contracts/anomaliaConfig";

const UMBRAL_POR_TRANSICION: Record<string, { umbral: number; objetivo: number | null } | undefined> = {
  MSR: { umbral: ANOMALIA_CONFIG.conversion.MSR_BAJO.umbral, objetivo: ANOMALIA_CONFIG.conversion.MSR_BAJO.objetivo },
  PRR: { umbral: ANOMALIA_CONFIG.conversion.PRR_BAJO.umbral, objetivo: ANOMALIA_CONFIG.conversion.PRR_BAJO.objetivo },
  CSR: { umbral: ANOMALIA_CONFIG.conversion.CSR_BAJO.umbral, objetivo: ANOMALIA_CONFIG.conversion.CSR_BAJO.objetivo },
  ABR: undefined,
};
import { XCircle, UserCog, TriangleAlert } from "lucide-react";

// Mismos motivos/colores que Leads.tsx -- no se extraen (son chicos, no vale
// tocar un archivo que ya funciona y ya diverge en dos variantes de tabla
// para reusar 6-10 lineas). Ver plan tecnico.
const MOTIVOS_DESCARTE = [
  { value: "SIN_RESPUESTA", label: "Sin respuesta" },
  { value: "RECHAZO_EXPLICITO", label: "Rechazo explicito" },
  { value: "NO_CALIFICA", label: "No califica" },
  { value: "DUPLICADO", label: "Duplicado" },
  { value: "ERROR_CARGA", label: "Error de carga" },
];

const etapaColors: Record<string, string> = {
  A: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  MS: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  B: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  C: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  D: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
};

const ANOMALIA_LABELS: Record<string, string> = {
  MSR_BAJO: "Tasa de respuesta baja (A → MS)",
  PRR_BAJO: "Tasa de pitch baja (MS → B)",
  CSR_BAJO: "Tasa de agendado baja (B → C, equipo)",
  TIEMPO_A_MS: "Lead sin responder",
  TIEMPO_MS_B: "Pitch demorado",
  TIEMPO_B_C: "Seguimiento demorado",
  TIEMPO_C_D: "Confirmación demorada",
};

type AnomaliaConversion = {
  tipo_anomalia: string;
  tasa_medida: number | null;
  umbral_anomalia: number;
  objetivo: number | null;
  numerador: number;
  denominador: number;
};
type AnomaliaTiempo = {
  tipo_anomalia: string;
  atribuible_a: "LEAD" | "SETTER";
  horas_transcurridas: number;
  umbral_horas: number;
};

// Dashboard individual por setter — 02_reglas_de_negocio.md seccion 10.
// Reusa embudoPorSetter (Sprint 3) filtrado a un setter, lead.list filtrado
// por setterId, y es la primera UI de ANOMALIA_DETECTADA. Las unicas
// acciones disponibles son descartar y reasignar -- todo lo demas sigue
// siendo exclusivo de LeadDetail (ver seccion 10 para el porque).
export default function DashboardSetter() {
  const { id } = useParams();
  const { user, isAdmin, isSetter, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const setterId = Number(id);
  const idValido = Number.isFinite(setterId);

  const [periodo, setPeriodo] = useState("mensual");
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [reasignando, setReasignando] = useState<{
    leadId: number;
    nombreLead: string;
    setterNuevoId: number;
    setterNuevoNombre: string;
  } | null>(null);
  const [discarding, setDiscarding] = useState<Set<number>>(new Set());

  const { data: embudo, isLoading: cargandoEmbudo } = trpc.event.embudoPorSetter.useQuery(
    {
      periodo: periodo as "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango",
      desde: periodo === "rango" && rangoDesde ? new Date(rangoDesde) : undefined,
      hasta: periodo === "rango" && rangoHasta ? new Date(rangoHasta) : undefined,
      setterId,
    },
    { enabled: idValido },
  );

  const { data: anomalias } = trpc.anomalia.listarPorSetter.useQuery(
    { setterId },
    { enabled: idValido },
  );

  const { data: leads } = trpc.lead.list.useQuery({ setterId }, { enabled: idValido });

  const { data: settersActivos } = trpc.user.setters.useQuery(undefined, { enabled: isAdmin });

  const createEvent = trpc.event.create.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const assignLead = trpc.lead.assign.useMutation({
    onSuccess: () => {
      utils.lead.list.invalidate();
      if (reasignando) toast.success(`${reasignando.nombreLead} reasignado a ${reasignando.setterNuevoNombre}`);
      setReasignando(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setReasignando(null);
    },
  });

  const handleDescartar = async (leadId: number, nombre: string, motivo: string) => {
    setDiscarding((prev) => new Set(prev).add(leadId));
    try {
      await createEvent.mutateAsync({ tipo: "LEAD_DESCARTADO", leadId, payload: { motivo } });
      toast.success(`${nombre} descartado`);
      utils.lead.list.invalidate();
    } catch {
      // el toast de error ya lo muestra onError de la mutation
    } finally {
      setDiscarding((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  };

  if (authLoading) return null;
  if (!idValido) return <Navigate to="/" replace />;
  // Un SETTER solo puede ver el propio -- se corrige a su id en vez de
  // expulsarlo, la intencion "ver un dashboard" seguia siendo valida.
  if (isSetter && user && setterId !== user.id) {
    return <Navigate to={`/dashboard/setter/${user.id}`} replace />;
  }

  const settersActivosParaReasignar = (settersActivos ?? []).filter((s) => s.activo);
  const setterInfo = embudo?.setters[0];

  return (
    <Layout>
      <div className="-m-6 p-6 min-h-[calc(100vh-1px)] text-foreground space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {setterInfo ? `Dashboard de ${setterInfo.nombre}` : "Dashboard del setter"}
              {setterInfo && !setterInfo.activo && (
                <span className="text-sm font-normal text-muted-foreground ml-2">(inactivo)</span>
              )}
            </h1>
            <p className="text-muted-foreground mt-1">Embudo, leads y anomalías propias</p>
          </div>
          <PeriodoSelector
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            rangoDesde={rangoDesde}
            onRangoDesdeChange={setRangoDesde}
            rangoHasta={rangoHasta}
            onRangoHastaChange={setRangoHasta}
          />
        </div>

        {!cargandoEmbudo && !setterInfo && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No se encontró ningún setter con ese id.
            </CardContent>
          </Card>
        )}

        {setterInfo && (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Embudo comercial</CardTitle>
              <p className="text-sm text-muted-foreground">
                Conversión en el período seleccionado — atribuida por intervalo de tiempo (a quién tenía el
                lead asignado en el momento de cada transición)
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {TRANSICIONES.map((t) => {
                  const valor = setterInfo.tasas[t.key];
                  const { num, den } = ETAPAS_TASA[t.key];
                  const conteo = {
                    num: setterInfo.conteos[num],
                    den: setterInfo.conteos[den],
                  };
                  const umbrales = UMBRAL_POR_TRANSICION[t.key];

                  // Igual que en el ejecutivo: ABR no tiene umbral de tasa
                  // (la anomalia de C -> D es de tiempo, no de conversion),
                  // asi que se muestra como tasa simple en vez de inventarle
                  // un limite contra el cual medirla.
                  if (!umbrales) {
                    return (
                      <div key={t.key} className="glass rounded-2xl p-4">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.label} <span className="text-muted-foreground">({t.key})</span>
                        </span>
                        <p className="text-lg font-semibold text-foreground mt-2 tabular-nums">
                          {formatPct(valor)}
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                            {conteo.num}/{conteo.den}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5">Sin umbral: se evalúa por tiempo</p>
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
                      conteo={conteo}
                      descripcion={t.desc}
                    />
                  );
                })}
              </div>

              {/* Volumen por etapa del setter: el medidor cuenta la tasa,
                  esto cuenta cuantos leads llego a mover en cada punto. */}
              <MiniEmbudo conteos={setterInfo.conteos} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Anomalías detectadas</CardTitle>
            <p className="text-sm text-muted-foreground">
              Registradas automáticamente por el motor de reglas — ver `02_reglas_de_negocio.md` sección 9
            </p>
          </CardHeader>
          <CardContent>
            {!anomalias ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Calculando...</p>
            ) : anomalias.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sin anomalías detectadas.</p>
            ) : (
              <div className="space-y-3">
                {anomalias.map((a) => {
                  const esTiempo = (a.payload as { tipo_anomalia: string }).tipo_anomalia.startsWith("TIEMPO_");
                  const label = ANOMALIA_LABELS[(a.payload as { tipo_anomalia: string }).tipo_anomalia] ?? (a.payload as { tipo_anomalia: string }).tipo_anomalia;
                  return (
                    <div
                      key={a.id}
                      className="glass rounded-2xl p-4 flex items-start justify-between gap-4"
                      style={{ borderColor: wash(STATUS.warning, 35) }}
                    >
                      <div className="flex items-start gap-3">
                        <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" style={{ color: STATUS.warning }} />
                        <div>
                          <p className="text-sm font-semibold text-foreground">{label}</p>
                          {esTiempo ? (
                            <TiempoDetalle payload={a.payload as AnomaliaTiempo} leadId={a.leadId} leadNombre={a.lead?.nombre ?? null} />
                          ) : (
                            <ConversionDetalle payload={a.payload as AnomaliaConversion} />
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(a.timestamp).toLocaleDateString("es-AR")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Leads</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!leads ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Cargando...</p>
            ) : leads.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sin leads asignados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left p-3 font-medium text-muted-foreground">Nombre</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Instagram</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Etapa</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Último contacto</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr key={lead.id} className="border-b border-border hover:bg-muted/50">
                        <td className="p-3">
                          <Link to={`/leads/${lead.id}`} className="font-medium text-foreground hover:underline">
                            {lead.nombre || "(sin nombre)"}
                          </Link>
                        </td>
                        <td className="p-3 text-muted-foreground">@{lead.instagramUsername}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              etapaColors[lead.etapaActual ?? "A"] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {lead.descartado ? lead.motivoDescarte : lead.etapaActual ?? "Sin etapa"}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">
                          {lead.ultimoContacto ? new Date(lead.ultimoContacto).toLocaleString("es-AR") : "-"}
                        </td>
                        <td className="p-1">
                          <div className="flex items-center justify-end gap-1">
                            {!lead.descartado && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" disabled={discarding.has(lead.id)} title="Descartar">
                                    <XCircle className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {MOTIVOS_DESCARTE.map((m) => (
                                    <DropdownMenuItem key={m.value} onClick={() => handleDescartar(lead.id, lead.nombre, m.value)}>
                                      {m.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            {isAdmin && !lead.descartado && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" title="Reasignar">
                                    <UserCog className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {settersActivosParaReasignar.filter((s) => s.id !== setterId).length === 0 ? (
                                    <DropdownMenuItem disabled>No hay otros setters activos</DropdownMenuItem>
                                  ) : (
                                    settersActivosParaReasignar
                                      .filter((s) => s.id !== setterId)
                                      .map((s) => (
                                        <DropdownMenuItem
                                          key={s.id}
                                          onClick={() =>
                                            setReasignando({
                                              leadId: lead.id,
                                              nombreLead: lead.nombre,
                                              setterNuevoId: s.id,
                                              setterNuevoNombre: s.nombre,
                                            })
                                          }
                                        >
                                          {s.nombre}
                                        </DropdownMenuItem>
                                      ))
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!reasignando} onOpenChange={(o) => !o && setReasignando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reasignar lead</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Reasignar <strong>{reasignando?.nombreLead}</strong> a <strong>{reasignando?.setterNuevoNombre}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={assignLead.isPending}
              onClick={() => {
                if (reasignando) {
                  assignLead.mutate({ leadId: reasignando.leadId, setterId: reasignando.setterNuevoId });
                }
              }}
            >
              {assignLead.isPending ? "Reasignando..." : "Reasignar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

function TiempoDetalle({ payload, leadId, leadNombre }: { payload: AnomaliaTiempo; leadId: number | null; leadNombre: string | null }) {
  return (
    <p className="text-sm text-muted-foreground mt-1">
      {Math.round(payload.horas_transcurridas)}h transcurridas (umbral: {Math.round(payload.umbral_horas)}h) —{" "}
      {payload.atribuible_a === "LEAD" ? "anomalía del lead" : "anomalía del setter"}
      {leadId && (
        <>
          {" — "}
          <Link to={`/leads/${leadId}`} className="underline">
            {leadNombre ?? `lead #${leadId}`}
          </Link>
        </>
      )}
    </p>
  );
}

function ConversionDetalle({ payload }: { payload: AnomaliaConversion }) {
  return (
    <p className="text-sm text-muted-foreground mt-1">
      {formatPct(payload.tasa_medida)} medido (umbral: {formatPct(payload.umbral_anomalia)}
      {payload.objetivo !== null ? `, objetivo: ${formatPct(payload.objetivo)}` : ""}) — {payload.numerador}/{payload.denominador}
    </p>
  );
}
