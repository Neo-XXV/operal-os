import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { GlassPanel as Card, GlassPanelContent as CardContent } from "@/components/GlassPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Video } from "lucide-react";
import { toast } from "sonner";
import { format, parse, startOfWeek, startOfMonth, endOfMonth, getDay } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";

// Lunes como inicio de semana (convencion local, no domingo).
function inicioSemana(d: Date) {
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  const inicio = new Date(d);
  inicio.setDate(d.getDate() + diff);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { locale: es }),
  getDay,
  locales: { es },
});

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

type EventoLocalCalendario = {
  title: string;
  start: Date;
  end: Date;
  resource: { leadId: number; leadNombre: string; googleEventId: string | null; enlace: string | null };
};

// Render custom del bloque de evento -- agrega el icono de enlace (si el
// evento tiene uno) sin reemplazar el click normal del bloque (que navega
// al lead, ver onSelectEvent). stopPropagation en el <a> para que clickear
// el icono abra el link en pestaña nueva en vez de disparar esa navegacion.
function EventoConEnlace({ event }: { event: EventoLocalCalendario }) {
  return (
    <span className="flex items-center gap-1 min-w-0">
      <span className="truncate flex-1 min-w-0">{event.title}</span>
      {event.resource.enlace && (
        <a
          href={event.resource.enlace}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Unirse a la llamada"
          className="shrink-0 hover:opacity-70"
        >
          <Video className="w-3 h-3" />
        </a>
      )}
    </span>
  );
}

// Agenda propia de OPERAL OS -- lee calendar.listarEventosLocales, nunca
// llama a Google. Es el evento canonico (docs/02_reglas_de_negocio (1).md
// seccion 8), asi que esta pestaña funciona con o sin conexion.
function AgendaOperal() {
  const navigate = useNavigate();
  const [rango, setRango] = useState(() => ({
    desde: startOfMonth(new Date()),
    hasta: endOfMonth(new Date()),
  }));
  const [vista, setVista] = useState<View>("week");

  const { data: eventosLocales, isLoading, error } = trpc.calendar.listarEventosLocales.useQuery({
    desde: rango.desde.toISOString(),
    hasta: rango.hasta.toISOString(),
  });

  const eventosCalendario: EventoLocalCalendario[] = useMemo(
    () =>
      (eventosLocales ?? []).map((ev) => ({
        title: ev.titulo,
        start: new Date(ev.fechaHoraInicio),
        end: new Date(ev.fechaHoraFin),
        resource: { leadId: ev.leadId, leadNombre: ev.leadNombre, googleEventId: ev.googleEventId, enlace: ev.enlace },
      })),
    [eventosLocales],
  );

  const handleRangeChange = (range: Date[] | { start: Date; end: Date }) => {
    if (Array.isArray(range)) {
      if (range.length === 0) return;
      setRango({ desde: range[0], hasta: range[range.length - 1] });
    } else {
      setRango({ desde: range.start, hasta: range.end });
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {isLoading && <p className="text-sm text-muted-foreground">Cargando agenda...</p>}
      {/* react-big-calendar trae su CSS pensado para pagina clara y no usa
          variables, asi que hay que reescribirle el chrome. Todo lo de abajo
          va con los tokens del tema (sin bloques separados claro/oscuro: los
          tokens ya cambian solos), y busca que el contraste este en el
          CONTENIDO y no en los separadores. */}
      <style>{`
        .operal-calendar { color: hsl(var(--foreground)); }

        /* rbc trae bordes #ddd hardcodeados en una docena de clases (el
           borde izquierdo del header, el derecho del time-view, etc.), que
           en modo oscuro se ven como lineas blancas. Catch-all sobre todo
           lo que empiece con rbc-, en :where() para que tenga especificidad
           0 y las reglas de abajo lo puedan pisar. */
        .operal-calendar :where([class^="rbc-"], [class*=" rbc-"]) {
          border-color: hsl(var(--border) / 0.6);
        }

        /* ── Lineas de hora: hairline y mucho mas tenues ──────────────
           Antes competian con los eventos. La media hora casi desaparece:
           sirve de guia, no de dato. */
        .operal-calendar .rbc-time-content,
        .operal-calendar .rbc-time-view,
        .operal-calendar .rbc-month-view,
        .operal-calendar .rbc-agenda-view table.rbc-agenda-table {
          border-color: hsl(var(--border) / 0.6);
        }
        .operal-calendar .rbc-timeslot-group { border-color: hsl(var(--border) / 0.5); }
        /* Este lo declara rbc con dos clases (0,2,0), asi que el catch-all de
           arriba no le gana: necesita regla propia. */
        .operal-calendar .rbc-time-header.rbc-overflowing {
          border-right-color: hsl(var(--border) / 0.6);
        }
        .operal-calendar .rbc-time-slot { border-color: hsl(var(--border) / 0.25); }
        .operal-calendar .rbc-day-bg + .rbc-day-bg,
        .operal-calendar .rbc-month-row + .rbc-month-row,
        .operal-calendar .rbc-time-content > * + * > * {
          border-color: hsl(var(--border) / 0.45);
        }

        /* ── Header de dias: separado del cuerpo de horas ─────────────
           Fondo propio, tipografia mas chica en mayusculas y una linea
           inferior mas marcada que el resto de la grilla. */
        .operal-calendar .rbc-time-header,
        .operal-calendar .rbc-month-header {
          background-color: hsl(var(--muted) / 0.5);
        }
        .operal-calendar .rbc-header {
          padding: 8px 4px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: hsl(var(--muted-foreground));
          border-color: hsl(var(--border) / 0.5);
        }
        .operal-calendar .rbc-time-header-content,
        .operal-calendar .rbc-month-header {
          border-bottom: 1px solid hsl(var(--border));
        }
        .operal-calendar .rbc-time-gutter .rbc-timeslot-group {
          color: hsl(var(--muted-foreground));
          font-size: 11px;
        }

        /* ── Dia actual: destacado, no una celda mas ──────────────────
           Lavado del acento de marca en toda la columna + el numero del
           dia en una pastilla navy, para que se ubique de un vistazo. */
        .operal-calendar .rbc-today {
          background-color: hsl(var(--brand) / 0.07);
        }
        .operal-calendar .rbc-header.rbc-today {
          color: hsl(var(--brand-ink));
          background-color: hsl(var(--brand) / 0.12);
        }
        /* rbc envuelve el numero del dia en <a> o en <button.rbc-button-link>
           segun la version/config de drilldown -- se cubren los dos. */
        .operal-calendar .rbc-date-cell.rbc-now > a,
        .operal-calendar .rbc-date-cell.rbc-now > button {
          background-color: hsl(var(--brand));
          color: hsl(var(--brand-foreground));
          border-radius: 999px;
          padding: 2px 7px;
          display: inline-block;
          font-weight: 600;
        }
        .operal-calendar .rbc-current-time-indicator {
          background-color: hsl(var(--brand-ink));
          height: 2px;
        }

        /* ── Eventos: bloques con profundidad, no texto plano ─────────
           Mismo lenguaje que las tarjetas pero a escala chica: color de
           serie translucido, borde con brillo, sombra suave y una barra
           lateral solida que ancla el bloque. */
        .operal-calendar .rbc-event {
          background-color: color-mix(in srgb, var(--chart-blue) 82%, transparent);
          border: 1px solid color-mix(in srgb, var(--chart-blue) 55%, transparent);
          border-left: 3px solid var(--chart-blue);
          border-radius: 8px;
          padding: 2px 6px;
          font-size: 12px;
          line-height: 1.35;
          color: #fff;
          box-shadow: 0 1px 2px rgb(0 0 0 / 0.10), 0 4px 10px -3px rgb(0 0 0 / 0.18);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
        }
        .operal-calendar .rbc-event:focus { outline: 2px solid hsl(var(--ring)); outline-offset: 1px; }
        .operal-calendar .rbc-event.rbc-selected {
          background-color: var(--chart-blue);
          box-shadow: 0 2px 4px rgb(0 0 0 / 0.14), 0 8px 18px -4px rgb(0 0 0 / 0.24);
        }
        /* Un evento sin sincronizar con Google se distingue por color de
           serie distinto, no solo por el badge de la lista. */
        .operal-calendar .rbc-event.evento-sin-sync {
          background-color: color-mix(in srgb, var(--chart-violet) 82%, transparent);
          border-color: color-mix(in srgb, var(--chart-violet) 55%, transparent);
          border-left-color: var(--chart-violet);
        }

        /* ── Fuera de rango y toolbar ─────────────────────────────────── */
        .operal-calendar .rbc-off-range-bg { background-color: hsl(var(--muted) / 0.35); }
        .operal-calendar .rbc-off-range { color: hsl(var(--muted-foreground) / 0.7); }
        .operal-calendar .rbc-toolbar-label,
        .operal-calendar .rbc-date-cell { color: hsl(var(--foreground)); }
        .operal-calendar .rbc-toolbar button {
          border-radius: 8px;
          color: hsl(var(--foreground));
          border-color: hsl(var(--border));
          background-color: hsl(var(--card));
        }
        .operal-calendar .rbc-toolbar button:hover { background-color: hsl(var(--accent)); }
        .operal-calendar .rbc-toolbar button.rbc-active,
        .operal-calendar .rbc-toolbar button.rbc-active:hover {
          background-color: hsl(var(--brand));
          color: hsl(var(--brand-foreground));
          border-color: hsl(var(--brand));
        }
        .operal-calendar .rbc-show-more { color: hsl(var(--brand-ink)); background-color: transparent; }
      `}</style>
      {/* La grilla vive sobre un panel glass: sobre el fondo plano, sin panel
          debajo, la grilla queda flotando sin borde de contencion. */}
      <div className="operal-calendar glass rounded-2xl p-3" style={{ height: 650 }}>
        <BigCalendar
          localizer={localizer}
          culture="es"
          events={eventosCalendario}
          startAccessor="start"
          endAccessor="end"
          views={["month", "week", "day"]}
          view={vista}
          onView={setVista}
          onRangeChange={handleRangeChange}
          onSelectEvent={(event) => navigate(`/leads/${event.resource.leadId}`)}
          // Clase, no style inline: el estilo inline le gana a la regla CSS del
          // bloque de arriba y dejaria el bloque plano, sin borde ni sombra.
          eventPropGetter={(event) => ({
            className: event.resource.googleEventId ? undefined : "evento-sin-sync",
          })}
          components={{ event: EventoConEnlace }}
          messages={{
            next: "Sig.",
            previous: "Ant.",
            today: "Hoy",
            month: "Mes",
            week: "Semana",
            day: "Día",
            noEventsInRange: "Sin eventos agendados en este rango.",
            showMore: (total) => `+${total} más`,
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm"
          style={{ backgroundColor: "var(--chart-violet)" }}
        />
        Sin sincronizar con Google
      </p>
    </div>
  );
}

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
          <h1 className="text-2xl font-bold text-foreground">Calendario</h1>
          <p className="text-muted-foreground mt-1">
            Agenda de llamadas — el calendario de OPERAL OS es siempre la fuente confiable; Google Calendar es un espejo opcional
          </p>
        </div>

        <Card>
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Verificando conexion...</p>
            ) : estado?.conectado ? (
              <div className="flex items-center gap-2 text-sm text-foreground">
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                Conectado por {estado.conectadoPor.nombre} el{" "}
                {new Date(estado.conectadoEn).toLocaleDateString("es-AR")}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <XCircle className="w-4 h-4 text-muted-foreground" />
                Google Calendar no esta conectado — la agenda de OPERAL OS funciona igual
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

        <Tabs defaultValue="operal">
          <TabsList>
            <TabsTrigger value="operal">Agenda OPERAL</TabsTrigger>
            <TabsTrigger value="google">Google Calendar</TabsTrigger>
          </TabsList>

          <TabsContent value="operal" className="mt-4">
            <AgendaOperal />
          </TabsContent>

          <TabsContent value="google" className="mt-4">
            {!estado?.conectado ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    Conecta Google Calendar para ver esta vista.
                  </p>
                </CardContent>
              </Card>
            ) : (
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
                  <p className="text-sm text-muted-foreground">
                    {format(inicio, "d 'de' MMMM", { locale: es })} —{" "}
                    {format(new Date(fin.getTime() - 1), "d 'de' MMMM", { locale: es })}
                  </p>
                </div>

                {agendaLoading ? (
                  <p className="text-sm text-muted-foreground">Cargando agenda...</p>
                ) : agendaError ? (
                  <Card>
                    <CardContent className="py-10 text-center">
                      <p className="text-sm text-destructive">{agendaError.message}</p>
                    </CardContent>
                  </Card>
                ) : porDia.length === 0 ? (
                  <Card>
                    <CardContent className="py-10 text-center">
                      <p className="text-sm text-muted-foreground">Sin eventos agendados esta semana.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {porDia.map(([dia, eventosDia]) => (
                      <div key={dia}>
                        <h3 className="text-sm font-semibold text-foreground mb-2 capitalize">
                          {format(new Date(`${dia}T00:00:00`), "EEEE d 'de' MMMM", { locale: es })}
                        </h3>
                        <div className="space-y-2">
                          {eventosDia.map((ev) => (
                            <Card key={ev.id}>
                              <CardContent className="p-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                                    {format(new Date(ev.inicio), "HH:mm")}–{format(new Date(ev.fin), "HH:mm")}
                                  </span>
                                  <span className="text-sm font-medium text-foreground truncate">{ev.titulo}</span>
                                </div>
                                {ev.esOperalLead && ev.leadId ? (
                                  <Link
                                    to={`/leads/${ev.leadId}`}
                                    className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900 whitespace-nowrap"
                                  >
                                    {ev.leadNombre}
                                  </Link>
                                ) : (
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
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
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
