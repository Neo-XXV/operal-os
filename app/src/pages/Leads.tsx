import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, ExternalLink, ArrowRight, XCircle } from "lucide-react";

const MOTIVOS_DESCARTE = [
  { value: "SIN_RESPUESTA", label: "Sin respuesta" },
  { value: "RECHAZO_EXPLICITO", label: "Rechazo explicito" },
  { value: "NO_CALIFICA", label: "No califica" },
  { value: "DUPLICADO", label: "Duplicado" },
  { value: "ERROR_CARGA", label: "Error de carga" },
];

const ETAPA_ORDEN = ["A", "MS", "B", "C", "D"] as const;
const SIGUIENTE_ETAPA: Record<string, string | undefined> = {
  A: "MS",
  MS: "B",
  B: "C",
  C: "D",
};

const etapaColors: Record<string, string> = {
  A: "bg-slate-100 text-slate-700",
  MS: "bg-blue-50 text-blue-700",
  B: "bg-amber-50 text-amber-700",
  C: "bg-purple-50 text-purple-700",
  D: "bg-green-50 text-green-700",
};

export default function Leads() {
  const { isSetter } = useAuth();

  return <Layout>{isSetter ? <TablaSetter /> : <VistaAdmin />}</Layout>;
}

// ─── Vista de la tabla de carga rapida (setter) — Sprint 2, punto 1 ──────

function EditableCell({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  // Sin useEffect para sincronizar con `value`: el llamador remonta este
  // componente con key={value} cuando el dato externo cambia.
  const [local, setLocal] = useState(value);

  return (
    <input
      className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-slate-400 rounded px-2 py-1 text-sm outline-none"
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function TablaSetter() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: leads, isLoading } = trpc.lead.list.useQuery();

  type LeadRow = NonNullable<typeof leads>[number];

  const [search, setSearch] = useState("");
  const [filtroEtapa, setFiltroEtapa] = useState<string>("");
  const [quickUsername, setQuickUsername] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [advancing, setAdvancing] = useState<Set<number>>(new Set());
  const [discarding, setDiscarding] = useState<Set<number>>(new Set());
  const [batchPending, setBatchPending] = useState(false);

  const createLead = trpc.lead.create.useMutation({
    onSuccess: () => {
      utils.lead.list.invalidate();
      setQuickUsername("");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => utils.lead.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const createEvent = trpc.event.create.useMutation();

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const username = quickUsername.trim();
    if (!username) return;
    createLead.mutate({ instagramUsername: username });
  };

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAvanzar = async (lead: LeadRow) => {
    const siguiente = lead.etapaActual ? SIGUIENTE_ETAPA[lead.etapaActual] : undefined;
    if (!siguiente) return;
    setAdvancing((prev) => new Set(prev).add(lead.id));
    try {
      await createEvent.mutateAsync({
        tipo: "ESTADO_CAMBIADO",
        leadId: lead.id,
        payload: { estado_anterior: lead.etapaActual, estado_nuevo: siguiente },
      });
      utils.lead.list.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al avanzar etapa");
    } finally {
      setAdvancing((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  };

  const handleDescartar = async (lead: LeadRow, motivo: string) => {
    setDiscarding((prev) => new Set(prev).add(lead.id));
    try {
      await createEvent.mutateAsync({
        tipo: "LEAD_DESCARTADO",
        leadId: lead.id,
        payload: { motivo },
      });
      utils.lead.list.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al descartar");
    } finally {
      setDiscarding((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  };

  const handleRegistrarLote = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBatchPending(true);
    const resultados = await Promise.allSettled(
      ids.map((leadId) =>
        createEvent.mutateAsync({ tipo: "SEGUIMIENTO_ENVIADO", leadId, payload: {} }),
      ),
    );
    const exitos = resultados.filter((r) => r.status === "fulfilled").length;
    const fallos = resultados.length - exitos;
    if (fallos === 0) {
      toast.success(`${exitos} seguimiento(s) registrado(s)`);
    } else {
      toast.error(`${exitos} registrados, ${fallos} con error`);
    }
    setSelected(new Set());
    setBatchPending(false);
    utils.lead.list.invalidate();
  };

  const filtered = (leads ?? []).filter((l) => {
    const q = search.toLowerCase();
    const matchSearch =
      l.nombre.toLowerCase().includes(q) || l.instagramUsername.toLowerCase().includes(q);
    const matchEtapa = !filtroEtapa || l.etapaActual === filtroEtapa;
    return matchSearch && matchEtapa;
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
        <p className="text-slate-500 mt-1">Tus leads asignados</p>
      </div>

      {/* Fila rapida de carga */}
      <Card>
        <CardContent className="p-3">
          <form onSubmit={handleQuickAdd} className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Pegar username de Instagram y Enter..."
              value={quickUsername}
              onChange={(e) => setQuickUsername(e.target.value)}
              disabled={createLead.isPending}
            />
            <Button type="submit" disabled={!quickUsername.trim() || createLead.isPending}>
              <Plus className="w-4 h-4 mr-2" />
              {createLead.isPending ? "Creando..." : "Iniciar"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Busqueda + filtro + accion de lote */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filtroEtapa} onValueChange={setFiltroEtapa}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Todas las etapas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todas las etapas</SelectItem>
            {ETAPA_ORDEN.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected.size > 0 && (
          <Button onClick={handleRegistrarLote} disabled={batchPending} variant="secondary">
            {batchPending ? "Registrando..." : `Registrar seguimiento (${selected.size})`}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-slate-500">Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              {leads && leads.length > 0
                ? "No hay leads con ese filtro"
                : "Todavia no tenes leads — pega un username arriba para arrancar"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="w-10 p-3"></th>
                    <th className="text-left p-3 font-medium text-slate-500">Nombre</th>
                    <th className="text-left p-3 font-medium text-slate-500">Instagram</th>
                    <th className="text-left p-3 font-medium text-slate-500">Estado</th>
                    <th className="text-left p-3 font-medium text-slate-500">Seguimientos</th>
                    <th className="text-left p-3 font-medium text-slate-500">Ultimo contacto</th>
                    <th className="text-left p-3 font-medium text-slate-500">Responsable</th>
                    <th className="text-left p-3 font-medium text-slate-500">Ultima nota</th>
                    <th className="text-right p-3 font-medium text-slate-500">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((lead) => {
                    const siguiente = lead.etapaActual ? SIGUIENTE_ETAPA[lead.etapaActual] : undefined;
                    return (
                      <tr key={lead.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-3">
                          <Checkbox
                            checked={selected.has(lead.id)}
                            onCheckedChange={() => toggleSelected(lead.id)}
                            disabled={lead.descartado}
                          />
                        </td>
                        <td className="p-1">
                          <EditableCell
                            key={lead.nombre}
                            value={lead.nombre}
                            placeholder="Sin nombre"
                            onCommit={(v) => updateLead.mutate({ id: lead.id, nombre: v })}
                          />
                        </td>
                        <td className="p-1">
                          <EditableCell
                            key={lead.instagramUsername}
                            value={lead.instagramUsername}
                            onCommit={(v) => {
                              if (v) updateLead.mutate({ id: lead.id, instagramUsername: v });
                            }}
                          />
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              etapaColors[lead.etapaActual ?? "A"] ?? "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {lead.descartado ? lead.motivoDescarte : lead.etapaActual ?? "Sin etapa"}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600">{lead.seguimientosCount}</td>
                        <td className="p-3 text-slate-500 text-xs whitespace-nowrap">
                          {lead.ultimoContacto ? new Date(lead.ultimoContacto).toLocaleString("es-AR") : "-"}
                        </td>
                        <td className="p-3 text-slate-600">{user?.nombre ?? "-"}</td>
                        <td
                          className="p-3 text-slate-500 text-xs max-w-[180px] truncate"
                          title={lead.ultimaNota ?? ""}
                        >
                          {lead.ultimaNota ?? "-"}
                        </td>
                        <td className="p-1">
                          <div className="flex items-center justify-end gap-1">
                            {!lead.descartado && siguiente && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleAvanzar(lead)}
                                disabled={advancing.has(lead.id)}
                                title={`Avanzar a ${siguiente}`}
                              >
                                <ArrowRight className="w-4 h-4" />
                                {siguiente}
                              </Button>
                            )}
                            {!lead.descartado && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" disabled={discarding.has(lead.id)} title="Descartar">
                                    <XCircle className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {MOTIVOS_DESCARTE.map((m) => (
                                    <DropdownMenuItem key={m.value} onClick={() => handleDescartar(lead, m.value)}>
                                      {m.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/leads/${lead.id}`)}
                              title="Ver detalle"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Vista admin (Sprint 1, sin cambios) ─────────────────────────────────

function VistaAdmin() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const utils = trpc.useUtils();
  const { data: leads, isLoading } = trpc.lead.list.useQuery();
  const { data: setters } = trpc.user.setters.useQuery(undefined, {
    enabled: isAdmin,
  });

  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [igUsername, setIgUsername] = useState("");
  const [setterId, setSetterId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const createLead = trpc.lead.create.useMutation({
    onSuccess: () => {
      utils.lead.list.invalidate();
      setOpen(false);
      setNombre("");
      setIgUsername("");
      setSetterId("");
      setError("");
    },
    onError: (err) => setError(err.message),
  });

  const filteredLeads = leads?.filter((l) => {
    const q = search.toLowerCase();
    return (
      l.nombre.toLowerCase().includes(q) ||
      l.instagramUsername.toLowerCase().includes(q)
    );
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!nombre || !igUsername) {
      setError("Nombre e Instagram son requeridos");
      return;
    }
    createLead.mutate({
      nombre,
      instagramUsername: igUsername,
      setterId: setterId ? parseInt(setterId) : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
          <p className="text-slate-500 mt-1">
            {isAdmin ? "Gestion de todos los leads" : "Tus leads asignados"}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-48"
            />
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Nuevo lead
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear lead</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Nombre</Label>
                  <Input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Nombre del prospecto"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Instagram Username</Label>
                  <Input
                    value={igUsername}
                    onChange={(e) => setIgUsername(e.target.value)}
                    placeholder="sin @"
                  />
                </div>
                {isAdmin && (
                  <div className="space-y-2">
                    <Label>Asignar a setter (opcional)</Label>
                    <Select
                      value={setterId}
                      onValueChange={setSetterId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar setter" />
                      </SelectTrigger>
                      <SelectContent>
                        {setters?.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createLead.isPending}
                >
                  {createLead.isPending ? "Creando..." : "Crear lead"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-500">
          Cargando leads...
        </div>
      ) : !filteredLeads || filteredLeads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            {search
              ? "No se encontraron leads con ese criterio"
              : "No hay leads registrados"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredLeads.map((lead) => (
            <Card
              key={lead.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/leads/${lead.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
                      {lead.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">
                        {lead.nombre}
                      </p>
                      <p className="text-sm text-slate-500">
                        @{lead.instagramUsername}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        etapaColors[lead.etapaActual ?? "A"] ??
                        "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {lead.etapaActual ?? "Sin etapa"}
                    </span>
                    {lead.descartado && (
                      <span className="text-xs text-red-600 font-medium bg-red-50 px-2 py-1 rounded-full">
                        {lead.motivoDescarte}
                      </span>
                    )}
                    <ExternalLink className="w-4 h-4 text-slate-300" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
