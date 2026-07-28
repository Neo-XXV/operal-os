import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

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
          <p className="text-sm text-slate-400">Próximamente: agenda de llamadas.</p>
        )}
      </div>
    </Layout>
  );
}
