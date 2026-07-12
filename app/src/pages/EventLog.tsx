import { useState } from "react";
import { Layout } from "@/components/Layout";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardList } from "lucide-react";

const EVENT_TYPE_LABELS: Record<string, string> = {
  LEAD_CREADO: "Lead creado",
  LEAD_ASIGNADO: "Lead asignado",
  ESTADO_CAMBIADO: "Estado cambiado",
  SEGUIMIENTO_ENVIADO: "Seguimiento enviado",
  RESPUESTA_RECIBIDA: "Respuesta recibida",
  OBJECION_REGISTRADA: "Objecion registrada",
  LEAD_DESCARTADO: "Lead descartado",
  NOTA_AGREGADA: "Nota agregada",
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

export default function EventLog() {
  const [tipo, setTipo] = useState<string>("");

  const { data: events, isLoading } = trpc.event.list.useQuery(
    { tipo: tipo || undefined, limit: 100 }
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Event Log</h1>
            <p className="text-slate-500 mt-1">
              Registro completo de eventos del sistema
            </p>
          </div>
          <div className="w-48">
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger>
                <SelectValue placeholder="Filtrar por tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos los tipos</SelectItem>
                {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-slate-500">
            Cargando eventos...
          </div>
        ) : !events || events.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-slate-500 flex flex-col items-center gap-2">
              <ClipboardList className="w-8 h-8 text-slate-300" />
              No hay eventos registrados
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => (
              <Card key={ev.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            eventColors[ev.tipo] ?? "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {EVENT_TYPE_LABELS[ev.tipo] ?? ev.tipo}
                        </span>
                        {ev.lead && (
                          <span className="text-xs text-slate-500">
                            {ev.lead.nombre} (@{ev.lead.instagramUsername})
                          </span>
                        )}
                        <span className="text-xs text-slate-400">
                          por {ev.actor?.nombre ?? ev.actorTipo}
                        </span>
                      </div>
                      <pre className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg overflow-x-auto">
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    </div>
                    <span className="text-xs text-slate-400 whitespace-nowrap">
                      {ev.timestamp
                        ? new Date(ev.timestamp).toLocaleString("es-AR")
                        : ""}
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
