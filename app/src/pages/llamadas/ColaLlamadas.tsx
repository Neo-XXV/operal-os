import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { GlassPanel as Card, GlassPanelContent as CardContent } from "@/components/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Phone } from "lucide-react";
import { toast } from "sonner";

type LeadCola = {
  leadId: number;
  nombre: string;
  instagramUsername: string;
  estadoLlamada: "PENDIENTE_LLAMAR" | "PENDIENTE_REAGENDA" | "CERRADO" | "PERDIDO" | null;
  origen: string | null;
  setterId: number | null;
  setterNombre: string | null;
  ultimaLlamada: { numero: number; fecha_call: string } | null;
};

// "2026-07-24" -> "24/07"
function formatearFechaCorta(fechaISO: string) {
  const [, mes, dia] = fechaISO.split("-");
  return `${dia}/${mes}`;
}

function hoyISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function motivoPendiente(lead: LeadCola) {
  if (!lead.ultimaLlamada) return "Nunca llamado";
  return `Reagendar tras llamada ${lead.ultimaLlamada.numero} del ${formatearFechaCorta(lead.ultimaLlamada.fecha_call)}`;
}

export function ColaLlamadas() {
  const utils = trpc.useUtils();
  const { data: cola, isLoading } = trpc.event.leadsParaLlamar.useQuery();
  const [leadSeleccionado, setLeadSeleccionado] = useState<LeadCola | null>(null);

  const registrarLlamada = trpc.event.create.useMutation({
    onSuccess: () => {
      utils.event.leadsParaLlamar.invalidate();
      toast.success(`Llamada registrada para ${leadSeleccionado?.nombre}`);
      setLeadSeleccionado(null);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando...</p>;
  }

  if (!cola || cola.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No hay leads pendientes de llamar.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 font-medium text-muted-foreground">Lead</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Setter / Origen</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Por qué está pendiente</th>
                  <th className="text-right p-3 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {(cola as LeadCola[]).map((lead) => (
                  <tr key={lead.leadId} className="border-b border-border hover:bg-muted/50">
                    <td className="p-3">
                      <p className="font-medium text-foreground">{lead.nombre || "(sin nombre)"}</p>
                      <p className="text-muted-foreground text-xs">@{lead.instagramUsername}</p>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {lead.setterNombre ?? "Sin asignar"}
                      {lead.origen && <span className="text-muted-foreground text-xs ml-1">({lead.origen})</span>}
                    </td>
                    <td className="p-3 text-muted-foreground">{motivoPendiente(lead)}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" onClick={() => setLeadSeleccionado(lead)}>
                        <Phone className="w-3.5 h-3.5 mr-1.5" />
                        Registrar llamada
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {leadSeleccionado && (
        <FormularioLlamada
          lead={leadSeleccionado}
          pendiente={registrarLlamada.isPending}
          onClose={() => setLeadSeleccionado(null)}
          onSubmit={(payload) =>
            registrarLlamada.mutate({
              tipo: "LLAMADA_REGISTRADA",
              leadId: leadSeleccionado.leadId,
              payload,
            })
          }
        />
      )}
    </>
  );
}

function FormularioLlamada({
  lead,
  pendiente,
  onClose,
  onSubmit,
}: {
  lead: LeadCola;
  pendiente: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const numero = (lead.ultimaLlamada?.numero ?? 0) + 1;

  const [fechaCall, setFechaCall] = useState(hoyISO());
  const [sePresento, setSePresento] = useState(false);
  const [califico, setCalifico] = useState(false);
  const [cerro, setCerro] = useState(false);
  const [montoCierre, setMontoCierre] = useState("");
  const [situacion, setSituacion] = useState("");
  const [notas, setNotas] = useState("");
  const [autoevaluacion, setAutoevaluacion] = useState("");
  const [grabacionUrl, setGrabacionUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const montoNumero = Number(montoCierre.replace(",", "."));
    onSubmit({
      numero,
      fecha_call: fechaCall,
      se_presento: sePresento,
      califico: sePresento ? califico : null,
      cerro: sePresento && califico ? cerro : null,
      monto_cierre: sePresento && califico && cerro ? Math.round(montoNumero * 100) : null,
      moneda: sePresento && califico && cerro ? "USD" : null,
      situacion: situacion || undefined,
      notas: notas || undefined,
      autoevaluacion: autoevaluacion || undefined,
      grabacion_url: grabacionUrl || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Registrar llamada — {lead.nombre || `@${lead.instagramUsername}`}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Esta será la llamada N°{numero} de hasta 3.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-muted-foreground">Fecha de la llamada</Label>
            <Input type="date" value={fechaCall} onChange={(e) => setFechaCall(e.target.value)} required />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="se_presento"
              checked={sePresento}
              onCheckedChange={(v) => {
                setSePresento(v === true);
                if (!v) {
                  setCalifico(false);
                  setCerro(false);
                }
              }}
            />
            <Label htmlFor="se_presento" className="text-muted-foreground font-normal">
              Se presentó a la llamada
            </Label>
          </div>

          {sePresento && (
            <div className="flex items-center gap-2 pl-6">
              <Checkbox
                id="califico"
                checked={califico}
                onCheckedChange={(v) => {
                  setCalifico(v === true);
                  if (!v) setCerro(false);
                }}
              />
              <Label htmlFor="califico" className="text-muted-foreground font-normal">
                Calificó (era apto para la oferta)
              </Label>
            </div>
          )}

          {sePresento && califico && (
            <div className="flex items-center gap-2 pl-12">
              <Checkbox id="cerro" checked={cerro} onCheckedChange={(v) => setCerro(v === true)} />
              <Label htmlFor="cerro" className="text-muted-foreground font-normal">
                Cerró
              </Label>
            </div>
          )}

          {sePresento && califico && cerro && (
            <div className="pl-12 space-y-1">
              <Label className="text-muted-foreground">Monto del cierre (USD)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="2500.00"
                value={montoCierre}
                onChange={(e) => setMontoCierre(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">Moneda: USD (único valor válido en esta versión)</p>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-muted-foreground">Situación del lead</Label>
            <Textarea value={situacion} onChange={(e) => setSituacion(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Notas</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Autoevaluación (¿cómo te sentiste? ¿qué mejorarías?)</Label>
            <Textarea value={autoevaluacion} onChange={(e) => setAutoevaluacion(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Grabación (link, opcional)</Label>
            <Input
              type="url"
              placeholder="https://..."
              value={grabacionUrl}
              onChange={(e) => setGrabacionUrl(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pendiente}>
              {pendiente ? "Registrando..." : "Registrar llamada"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
