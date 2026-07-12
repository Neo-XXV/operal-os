import { useState } from "react";
import { useNavigate } from "react-router";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, ExternalLink } from "lucide-react";

export default function Leads() {
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

  const etapaColors: Record<string, string> = {
    A: "bg-slate-100 text-slate-700",
    MS: "bg-blue-50 text-blue-700",
    B: "bg-amber-50 text-amber-700",
    C: "bg-purple-50 text-purple-700",
    D: "bg-green-50 text-green-700",
  };

  return (
    <Layout>
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
    </Layout>
  );
}
