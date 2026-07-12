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
import { ArrowLeft, Plus, Send, MessageSquare, AlertTriangle, StickyNote } from "lucide-react";

const EVENT_TYPES = [
  { value: "ESTADO_CAMBIADO", label: "Cambio de estado", icon: Send },
  { value: "SEGUIMIENTO_ENVIADO", label: "Seguimiento enviado", icon: Send },
  { value: "RESPUESTA_RECIBIDA", label: "Respuesta recibida", icon: MessageSquare },
  { value: "OBJECION_REGISTRADA", label: "Objecion registrada", icon: AlertTriangle },
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

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useAuth(); // hook disponible para uso futuro
  const leadId = parseInt(id ?? "0");
  const utils = trpc.useUtils();

  const { data: lead } = trpc.lead.getById.useQuery({ id: leadId });
  const { data: timeline } = trpc.event.timeline.useQuery({ leadId });

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
