import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Send, MessageSquare, AlertTriangle, StickyNote, XCircle } from "lucide-react";

type LlamadaPayload = {
  numero: number;
  fecha_call: string;
  se_presento: boolean;
  califico: boolean | null;
  cerro: boolean | null;
  monto_cierre: number | null;
  moneda: string | null;
  situacion?: string;
  notas?: string;
  autoevaluacion?: string;
  grabacion_url?: string;
};

type PagoPayload = { monto: number; moneda: string; fecha_pago: string; nota?: string };

function hoyISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatUSD(centavos: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(centavos / 100);
}

const ESTADO_LLAMADA_LABELS: Record<string, string> = {
  PENDIENTE_LLAMAR: "Pendiente de llamar",
  PENDIENTE_REAGENDA: "Pendiente de reagenda",
  CERRADO: "Cerrado",
  PERDIDO: "Perdido (3 llamadas sin cierre)",
};

const ESTADO_LLAMADA_COLORS: Record<string, string> = {
  PENDIENTE_LLAMAR: "bg-amber-50 text-amber-700",
  PENDIENTE_REAGENDA: "bg-orange-50 text-orange-700",
  CERRADO: "bg-green-50 text-green-700",
  PERDIDO: "bg-red-50 text-red-700",
};

const EVENT_TYPES = [
  { value: "ESTADO_CAMBIADO", label: "Cambio de estado", icon: Send },
  { value: "SEGUIMIENTO_ENVIADO", label: "Seguimiento enviado", icon: Send },
  { value: "RESPUESTA_RECIBIDA", label: "Respuesta recibida", icon: MessageSquare },
  { value: "OBJECION_REGISTRADA", label: "Objecion registrada", icon: AlertTriangle },
  { value: "LEAD_DESCARTADO", label: "Lead descartado", icon: XCircle },
  { value: "NOTA_AGREGADA", label: "Nota agregada", icon: StickyNote },
];

const ETAPAS = ["A", "MS", "B", "C", "D"];

const TIPOS_OBJECION = [
  { value: "PRECIO", label: "Precio" },
  { value: "DESCONFIANZA", label: "Desconfianza" },
  { value: "TIEMPO", label: "Tiempo" },
  { value: "EXPERIENCIA_PREVIA_SIMILAR", label: "Ya intentó algo parecido antes" },
  { value: "YA_TIENE_PROVEEDOR", label: "Ya tiene proveedor" },
  { value: "YA_PAGO_MENTOR", label: "Ya le pagó a un mentor/coach" },
  { value: "OTRA", label: "Otra" },
];

const MOTIVOS_DESCARTE = [
  { value: "SIN_RESPUESTA", label: "Sin respuesta" },
  { value: "RECHAZO_EXPLICITO", label: "Rechazo explicito" },
  { value: "NO_CALIFICA", label: "No califica" },
  { value: "DUPLICADO", label: "Duplicado" },
  { value: "ERROR_CARGA", label: "Error de carga" },
];

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const leadId = parseInt(id ?? "0");
  const utils = trpc.useUtils();

  const { data: lead } = trpc.lead.getById.useQuery({ id: leadId });
  const { data: timeline } = trpc.event.timeline.useQuery({ leadId });

  // Sprint 4: proyecciones de la fase de llamada -- ADMIN/MANAGER (adminQuery)
  // pueden leerlas; el rechazo literal a MANAGER en la mutacion de pago lo
  // resuelve el backend (mismo patron que ColaLlamadas.tsx: no se duplica esa
  // distincion en el frontend, se deja que el backend la rechace).
  const { data: estadoLlamadaData } = trpc.event.estadoLlamada.useQuery({ leadId }, { enabled: isAdmin });
  const { data: cierre } = trpc.event.cierre.useQuery({ leadId }, { enabled: isAdmin });
  const { data: cashCollectedData } = trpc.event.cashCollected.useQuery({ leadId }, { enabled: isAdmin });

  const llamadas = (timeline ?? [])
    .filter((ev) => ev.tipo === "LLAMADA_REGISTRADA")
    .map((ev) => ({ ...ev, payload: ev.payload as LlamadaPayload }))
    .sort((a, b) => a.payload.fecha_call.localeCompare(b.payload.fecha_call) || a.id - b.id);

  const pagos = (timeline ?? [])
    .filter((ev) => ev.tipo === "PAGO_REGISTRADO")
    .map((ev) => ({ ...ev, payload: ev.payload as PagoPayload }))
    .sort((a, b) => a.payload.fecha_pago.localeCompare(b.payload.fecha_pago) || a.id - b.id);

  const [pagoOpen, setPagoOpen] = useState(false);
  const [montoPago, setMontoPago] = useState("");
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [notaPago, setNotaPago] = useState("");
  const [errorPago, setErrorPago] = useState("");

  const registrarPago = trpc.event.create.useMutation({
    onSuccess: () => {
      utils.event.cashCollected.invalidate({ leadId });
      utils.event.timeline.invalidate({ leadId });
      setPagoOpen(false);
      setMontoPago("");
      setFechaPago(hoyISO());
      setNotaPago("");
      setErrorPago("");
    },
    onError: (err) => setErrorPago(err.message),
  });

  const handleSubmitPago = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorPago("");
    const montoNumero = Number(montoPago.replace(",", "."));
    if (!montoNumero || montoNumero <= 0) {
      setErrorPago("Ingresa un monto valido");
      return;
    }
    registrarPago.mutate({
      tipo: "PAGO_REGISTRADO",
      leadId,
      payload: {
        monto: Math.round(montoNumero * 100),
        moneda: "USD",
        fecha_pago: fechaPago,
        nota: notaPago || undefined,
      },
    });
  };

  const [open, setOpen] = useState(false);
  const [eventType, setEventType] = useState("ESTADO_CAMBIADO");
  const [estadoNuevo, setEstadoNuevo] = useState("");
  const [etapa, setEtapa] = useState("");
  const [numero, setNumero] = useState("1");
  const [tipoObjecion, setTipoObjecion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [contexto, setContexto] = useState("");
  const [error, setError] = useState("");

  const createEvent = trpc.event.create.useMutation({
    onSuccess: () => {
      utils.event.timeline.invalidate({ leadId });
      utils.lead.getById.invalidate({ id: leadId });
      utils.lead.list.invalidate();
      setOpen(false);
      resetForm();
    },
    onError: (err) => setError(err.message),
  });

  const resetForm = () => {
    setEventType("ESTADO_CAMBIADO");
    setEstadoNuevo("");
    setEtapa("");
    setNumero("1");
    setTipoObjecion("");
    setMotivo("");
    setDetalle("");
    setContexto("");
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    let payload: Record<string, any> = {};

    switch (eventType) {
      case "ESTADO_CAMBIADO":
        if (!estadoNuevo) { setError("Selecciona el nuevo estado"); return; }
        payload = { estado_anterior: lead?.etapaActual ?? null, estado_nuevo: estadoNuevo };
        break;
      case "SEGUIMIENTO_ENVIADO":
        if (!etapa) { setError("Selecciona la etapa"); return; }
        payload = { etapa, numero: parseInt(numero) || 1 };
        break;
      case "RESPUESTA_RECIBIDA":
        payload = { contexto };
        break;
      case "OBJECION_REGISTRADA":
        if (!tipoObjecion) { setError("Selecciona el tipo de objecion"); return; }
        payload = { tipo: tipoObjecion, detalle, es_nueva: true };
        break;
      case "LEAD_DESCARTADO":
        if (!motivo) { setError("Selecciona el motivo"); return; }
        payload = { motivo, detalle };
        break;
      case "NOTA_AGREGADA":
        if (!detalle) { setError("Escribe la nota"); return; }
        payload = { texto: detalle };
        break;
    }

    createEvent.mutate({ tipo: eventType as any, leadId, payload });
  };

  const etapaColors: Record<string, string> = {
    A: "bg-slate-100 text-slate-700",
    MS: "bg-blue-50 text-blue-700",
    B: "bg-amber-50 text-amber-700",
    C: "bg-purple-50 text-purple-700",
    D: "bg-green-50 text-green-700",
  };

  const eventColors: Record<string, string> = {
    LEAD_CREADO: "bg-slate-100 text-slate-700",
    LEAD_ASIGNADO: "bg-indigo-50 text-indigo-700",
    ESTADO_CAMBIADO: "bg-blue-50 text-blue-700",
    SEGUIMIENTO_ENVIADO: "bg-amber-50 text-amber-700",
    RESPUESTA_RECIBIDA: "bg-green-50 text-green-700",
    OBJECION_REGISTRADA: "bg-orange-50 text-orange-700",
    LEAD_DESCARTADO: "bg-red-50 text-red-700",
    NOTA_AGREGADA: "bg-gray-50 text-gray-700",
  };

  if (!lead) {
    return (
      <Layout>
        <div className="text-center py-12 text-slate-500">
          Lead no encontrado o no tienes acceso
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate("/leads")} className="mb-2">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver a leads
        </Button>

        {/* Lead header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-slate-900 flex items-center justify-center text-xl font-bold text-white">
              {lead.nombre.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{lead.nombre}</h1>
              <p className="text-slate-500">@{lead.instagramUsername}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${
              etapaColors[lead.etapaActual ?? "A"] ?? "bg-slate-100 text-slate-700"
            }`}>
              Etapa: {lead.etapaActual ?? "Sin etapa"}
            </span>
            {lead.descartado && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-red-50 text-red-700">
                {lead.motivoDescarte}
              </span>
            )}
          </div>
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-slate-500 uppercase font-medium">Setter asignado</p>
              <p className="text-lg font-semibold mt-1">
                {lead.setterActual ? `ID: ${lead.setterActual}` : "Sin asignar"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-slate-500 uppercase font-medium">Estado</p>
              <p className={`text-lg font-semibold mt-1 ${lead.descartado ? "text-red-600" : "text-green-600"}`}>
                {lead.descartado ? "Descartado" : "Activo"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-slate-500 uppercase font-medium">Eventos</p>
              <p className="text-lg font-semibold mt-1">{timeline?.length ?? 0}</p>
            </CardContent>
          </Card>
        </div>

        {/* Fase de llamada -- Sprint 4, solo ADMIN/MANAGER, solo si el lead
            llego a D (02_reglas_de_negocio.md seccion 7). El setter no
            participa de esta fase y no ve esta seccion en absoluto. */}
        {isAdmin && estadoLlamadaData?.estado && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Fase de llamada</h2>
              <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${
                ESTADO_LLAMADA_COLORS[estadoLlamadaData.estado] ?? "bg-slate-100 text-slate-700"
              }`}>
                {ESTADO_LLAMADA_LABELS[estadoLlamadaData.estado] ?? estadoLlamadaData.estado}
              </span>
            </div>

            {cierre?.cerrado && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500 uppercase font-medium">Monto del cierre</p>
                    <p className="text-lg font-semibold mt-1">
                      {cierre.montoCierre != null ? formatUSD(cierre.montoCierre) : "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs text-slate-500 uppercase font-medium">Cash collected</p>
                      <p className="text-lg font-semibold mt-1">
                        {formatUSD(cashCollectedData?.montoTotal ?? 0)}
                      </p>
                    </div>
                    <Dialog open={pagoOpen} onOpenChange={setPagoOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">Registrar pago</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>Registrar pago</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleSubmitPago} className="space-y-4 mt-2">
                          <div className="space-y-2">
                            <Label>Monto (USD)</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="2500.00"
                              value={montoPago}
                              onChange={(e) => setMontoPago(e.target.value)}
                              required
                            />
                            <p className="text-xs text-slate-500">Moneda: USD (único valor válido en esta versión)</p>
                          </div>
                          <div className="space-y-2">
                            <Label>Fecha del pago</Label>
                            <Input
                              type="date"
                              value={fechaPago}
                              onChange={(e) => setFechaPago(e.target.value)}
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Nota (opcional)</Label>
                            <Textarea value={notaPago} onChange={(e) => setNotaPago(e.target.value)} rows={2} />
                          </div>
                          {errorPago && (
                            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                              {errorPago}
                            </p>
                          )}
                          <Button type="submit" className="w-full" disabled={registrarPago.isPending}>
                            {registrarPago.isPending ? "Registrando..." : "Registrar pago"}
                          </Button>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </CardContent>
                </Card>
              </div>
            )}

            {llamadas.length > 0 && (
              <div className="space-y-2">
                {llamadas.map((ev) => (
                  <Card key={ev.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-slate-900">Llamada N°{ev.payload.numero}</span>
                        <span className="text-xs text-slate-400">{ev.payload.fecha_call}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs mb-2">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${
                          ev.payload.se_presento ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        }`}>
                          {ev.payload.se_presento ? "Se presentó" : "No se presentó"}
                        </span>
                        {ev.payload.se_presento && (
                          <span className={`px-2 py-0.5 rounded-full font-medium ${
                            ev.payload.califico ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-700"
                          }`}>
                            {ev.payload.califico ? "Calificó" : "No calificó"}
                          </span>
                        )}
                        {ev.payload.califico && (
                          <span className={`px-2 py-0.5 rounded-full font-medium ${
                            ev.payload.cerro ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-700"
                          }`}>
                            {ev.payload.cerro ? "Cerró" : "No cerró"}
                          </span>
                        )}
                      </div>
                      {(ev.payload.situacion || ev.payload.notas || ev.payload.autoevaluacion) && (
                        <div className="text-sm text-slate-600 space-y-1">
                          {ev.payload.situacion && (
                            <p><span className="font-medium">Situación:</span> {ev.payload.situacion}</p>
                          )}
                          {ev.payload.notas && (
                            <p><span className="font-medium">Notas:</span> {ev.payload.notas}</p>
                          )}
                          {ev.payload.autoevaluacion && (
                            <p><span className="font-medium">Autoevaluación:</span> {ev.payload.autoevaluacion}</p>
                          )}
                        </div>
                      )}
                      {ev.payload.grabacion_url && (
                        <a
                          href={ev.payload.grabacion_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                        >
                          Ver grabación
                        </a>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {pagos.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">Pagos registrados</h3>
                {pagos.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                    <span className="font-medium text-slate-900">
                      {formatUSD(ev.payload.monto)} — {ev.payload.fecha_pago}
                    </span>
                    {ev.payload.nota && <span className="text-slate-500 text-xs">{ev.payload.nota}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Historial de eventos</h2>
          {!lead.descartado && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Registrar evento
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Registrar evento</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 mt-2">
                  <div className="space-y-2">
                    <Label>Tipo de evento</Label>
                    <Select value={eventType} onValueChange={setEventType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_TYPES.map((et) => (
                          <SelectItem key={et.value} value={et.value}>
                            {et.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {eventType === "ESTADO_CAMBIADO" && (
                    <div className="space-y-2">
                      <Label>Nuevo estado</Label>
                      <Select value={estadoNuevo} onValueChange={setEstadoNuevo}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar estado" />
                        </SelectTrigger>
                        <SelectContent>
                          {ETAPAS.map((e) => (
                            <SelectItem key={e} value={e}>{e}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {eventType === "SEGUIMIENTO_ENVIADO" && (
                    <>
                      <div className="space-y-2">
                        <Label>Etapa</Label>
                        <Select value={etapa} onValueChange={setEtapa}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar etapa" />
                          </SelectTrigger>
                          <SelectContent>
                            {ETAPAS.slice(0, -1).map((e) => (
                              <SelectItem key={e} value={e}>{e}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Numero de seguimiento</Label>
                        <Input
                          type="number"
                          min={1}
                          max={4}
                          value={numero}
                          onChange={(e) => setNumero(e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  {eventType === "RESPUESTA_RECIBIDA" && (
                    <div className="space-y-2">
                      <Label>Contexto (opcional)</Label>
                      <Textarea
                        value={contexto}
                        onChange={(e) => setContexto(e.target.value)}
                        placeholder="Que respondio el lead..."
                      />
                    </div>
                  )}

                  {eventType === "OBJECION_REGISTRADA" && (
                    <>
                      <div className="space-y-2">
                        <Label>Tipo de objecion</Label>
                        <Select value={tipoObjecion} onValueChange={setTipoObjecion}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar tipo" />
                          </SelectTrigger>
                          <SelectContent>
                            {TIPOS_OBJECION.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Detalle de la objecion</Label>
                        <Textarea
                          value={detalle}
                          onChange={(e) => setDetalle(e.target.value)}
                          placeholder="Describe la objecion..."
                        />
                      </div>
                    </>
                  )}

                  {eventType === "LEAD_DESCARTADO" && (
                    <>
                      <div className="space-y-2">
                        <Label>Motivo</Label>
                        <Select value={motivo} onValueChange={setMotivo}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar motivo" />
                          </SelectTrigger>
                          <SelectContent>
                            {MOTIVOS_DESCARTE.map((m) => (
                              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Detalle (opcional)</Label>
                        <Textarea
                          value={detalle}
                          onChange={(e) => setDetalle(e.target.value)}
                          placeholder="Contexto adicional del descarte..."
                        />
                      </div>
                    </>
                  )}

                  {eventType === "NOTA_AGREGADA" && (
                    <div className="space-y-2">
                      <Label>Nota</Label>
                      <Textarea
                        value={detalle}
                        onChange={(e) => setDetalle(e.target.value)}
                        placeholder="Escribe tu nota..."
                      />
                    </div>
                  )}

                  {error && (
                    <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                      {error}
                    </p>
                  )}
                  <Button type="submit" className="w-full" disabled={createEvent.isPending}>
                    {createEvent.isPending ? "Registrando..." : "Registrar evento"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {!timeline || timeline.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-slate-500">
              No hay eventos registrados para este lead
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {timeline.map((ev) => (
              <Card key={ev.id} className="border-l-4 border-l-slate-300">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          eventColors[ev.tipo] ?? "bg-slate-100 text-slate-700"
                        }`}>
                          {ev.tipo}
                        </span>
                        <span className="text-xs text-slate-400">
                          {ev.actor?.nombre ?? ev.actorTipo}
                        </span>
                      </div>
                      <pre className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg overflow-x-auto">
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    </div>
                    <span className="text-xs text-slate-400 ml-4 whitespace-nowrap">
                      {ev.timestamp ? new Date(ev.timestamp).toLocaleString("es-AR") : ""}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
