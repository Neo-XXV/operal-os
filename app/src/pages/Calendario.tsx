import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, CheckCircle2, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

// Lunes como inicio de semana (convencion local, no domingo).
function inicioSemana(d: Date) {
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  const inicio = new Date(d);
  inicio.setDate(d.getDate() + diff);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

const MENSAJES_ERROR: Record<string, string> = {
  unauthorized: "Tu sesion no es valida. Volve a iniciar sesion e intenta de nuevo.",
  forbidden: "Solo un ADMIN o MANAGER puede conectar Google Calendar.",
  invalid_state: "La conexion expiro o no es valida. Intenta de nuevo.",
  missing_params: "Google no devolvio los datos esperados. Intenta de nuevo.",
  no_refresh_token: "Google no devolvio un token reutilizable. Intenta de nuevo (puede hacer falta revocar el acceso previo en myaccount.google.com/permissions).",
  scope_incompleto: "El permiso otorgado no incluye Calendar. Intenta de nuevo y acepta el permiso solicitado.",
  token_exchange_failed: "No se pudo completar la conexion con Google. Intenta de nuevo.",
  denied: "Cancelaste la conexion con Google.",
};

export default function Calendario() {
  const { isAdmin } = useAuth();
  const utils = trpc.useUtils();
  const { data: estado, isLoading } = trpc.calendar.estado.useQuery();

  const desconectar = trpc.calendar.desconectar.useMutation({
    onSuccess: () => {
      toast.success("Google Calendar desconectado");
      utils.calendar.estado.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      toast.success("Google Calendar conectado");
      utils.calendar.estado.invalidate();
      window.history.replaceState({}, "", "/calendario");
    } else if (error) {
      toast.error(MENSAJES_ERROR[error] ?? "No se pudo conectar Google Calendar.");
      window.history.replaceState({}, "", "/calendario");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conectar = () => {
    const token = localStorage.getItem("operal_token");
    window.location.href = `/api/auth/google?token=${encodeURIComponent(token ?? "")}`;
  };

  const [semanaOffset, setSemanaOffset] = useState(0);
  const inicio = useMemo(() => {
    const base = inicioSemana(new Date());
    base.setDate(base.getDate() + semanaOffset * 7);
    return base;
  }, [semanaOffset]);
  const fin = useMemo(() => {
    const f = new Date(inicio);
    f.setDate(f.getDate() + 7);
    return f;
  }, [inicio]);

  const { data: agenda, isLoading: agendaLoading, error: agendaError } = trpc.calendar.listarEventos.useQuery(
    { desde: inicio.toISOString(), hasta: fin.toISOString() },
    { enabled: !!estado?.conectado },
  );

  const porDia = useMemo(() => {
    const eventosAgenda = agenda?.eventos ?? [];
    const grupos = new Map<string, typeof eventosAgenda>();
    for (const ev of eventosAgenda) {
      const key = format(new Date(ev.inicio), "yyyy-MM-dd");
      const lista = grupos.get(key);
      if (lista) lista.push(ev);
      else grupos.set(key, [ev]);
    }
    return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [agenda]);

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendario</h1>
          <p className="text-slate-500 mt-1">
            Agenda de llamadas — sincronizada con Google Calendar
          </p>
        </div>

        <Card>
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            {isLoading ? (
              <p className="text-sm text-slate-500">Verificando conexion...</p>
            ) : estado?.conectado ? (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Conectado por {estado.conectadoPor.nombre} el{" "}
                {new Date(estado.conectadoEn).toLocaleDateString("es-AR")}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <XCircle className="w-4 h-4 text-slate-400" />
                Google Calendar no esta conectado
              </div>
            )}

            {isAdmin && (
              <div className="flex gap-2">
                {estado?.conectado ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => desconectar.mutate()}
                    disabled={desconectar.isPending}
                  >
                    {desconectar.isPending ? "Desconectando..." : "Desconectar"}
                  </Button>
                ) : (
                  <Button size="sm" onClick={conectar}>
                    <CalendarDays className="w-4 h-4 mr-2" />
                    Conectar Google Calendar
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {estado?.conectado && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSemanaOffset((s) => s - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSemanaOffset(0)} disabled={semanaOffset === 0}>
                  Hoy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSemanaOffset((s) => s + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-sm text-slate-500">
                {format(inicio, "d 'de' MMMM", { locale: es })} —{" "}
                {format(new Date(fin.getTime() - 1), "d 'de' MMMM", { locale: es })}
              </p>
            </div>

            {agendaLoading ? (
              <p className="text-sm text-slate-500">Cargando agenda...</p>
            ) : agendaError ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <p className="text-sm text-red-600">{agendaError.message}</p>
                </CardContent>
              </Card>
            ) : porDia.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <p className="text-sm text-slate-400">Sin eventos agendados esta semana.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {porDia.map(([dia, eventosDia]) => (
                  <div key={dia}>
                    <h3 className="text-sm font-semibold text-slate-700 mb-2 capitalize">
                      {format(new Date(`${dia}T00:00:00`), "EEEE d 'de' MMMM", { locale: es })}
                    </h3>
                    <div className="space-y-2">
                      {eventosDia.map((ev) => (
                        <Card key={ev.id}>
                          <CardContent className="p-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-sm text-slate-500 whitespace-nowrap">
                                {format(new Date(ev.inicio), "HH:mm")}–{format(new Date(ev.fin), "HH:mm")}
                              </span>
                              <span className="text-sm font-medium text-slate-900 truncate">{ev.titulo}</span>
                            </div>
                            {ev.esOperalLead && ev.leadId ? (
                              <Link
                                to={`/leads/${ev.leadId}`}
                                className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap"
                              >
                                {ev.leadNombre}
                              </Link>
                            ) : (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">
                                Externo
                              </span>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
