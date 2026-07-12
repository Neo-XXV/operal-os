import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserPlus, ClipboardList, Activity } from "lucide-react";

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const { data: leads } = trpc.lead.list.useQuery();
  const { data: allEvents } = trpc.event.list.useQuery(
    { limit: 100 },
    { enabled: isAdmin }
  );
  const { data: myEvents } = trpc.event.list.useQuery(
    { limit: 100 },
    { enabled: !isAdmin }
  );

  const events = isAdmin ? allEvents : myEvents;

  const totalLeads = leads?.length ?? 0;
  const activeLeads = leads?.filter((l) => !l.descartado).length ?? 0;
  const discardedLeads = leads?.filter((l) => l.descartado).length ?? 0;
  const totalEvents = events?.length ?? 0;

  // Proyeccion: leads por etapa
  const leadsByStage: Record<string, number> = {};
  leads?.forEach((l) => {
    const stage = l.etapaActual ?? "Sin etapa";
    leadsByStage[stage] = (leadsByStage[stage] ?? 0) + 1;
  });

  const stageNames: Record<string, string> = {
    A: "Primer mensaje",
    MS: "Respondio",
    B: "Pitch enviado",
    C: "Agendado",
    D: "Confirmado",
    "Sin etapa": "Sin etapa",
  };

  const stageOrder = ["A", "MS", "B", "C", "D", "Sin etapa"];

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Hola, {user?.nombre}
          </h1>
          <p className="text-slate-500 mt-1">
            {isAdmin
              ? "Panel de administracion del sistema"
              : "Estos son tus leads asignados"}
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">
                Total Leads
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-slate-400" />
                <span className="text-3xl font-bold">{totalLeads}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">
                Leads Activos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-green-500" />
                <span className="text-3xl font-bold">{activeLeads}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">
                Descartados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-red-400" />
                <span className="text-3xl font-bold">{discardedLeads}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">
                Eventos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-blue-400" />
                <span className="text-3xl font-bold">{totalEvents}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Embudo visual */}
        <Card>
          <CardHeader>
            <CardTitle>Embudo comercial</CardTitle>
            <p className="text-sm text-slate-500">
              Distribucion de leads por etapa
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stageOrder.map((stage) => {
                const count = leadsByStage[stage] ?? 0;
                const maxCount = Math.max(...Object.values(leadsByStage), 1);
                const pct = (count / maxCount) * 100;
                return (
                  <div key={stage} className="flex items-center gap-4">
                    <div className="w-32 text-sm font-medium text-slate-600">
                      {stageNames[stage] ?? stage}
                    </div>
                    <div className="flex-1 h-8 bg-slate-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-slate-800 rounded-lg flex items-center px-3 transition-all"
                        style={{ width: `${Math.max(pct, 5)}%` }}
                      >
                        <span className="text-white text-sm font-semibold">
                          {count}
                        </span>
                      </div>
                    </div>
                    <div className="w-12 text-right text-sm text-slate-500">
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Ultimos leads */}
        {leads && leads.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Leads recientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-3 font-medium text-slate-500">
                        Nombre
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-slate-500">
                        Instagram
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-slate-500">
                        Etapa
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-slate-500">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.slice(0, 10).map((lead) => (
                      <tr
                        key={lead.id}
                        className="border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="py-2 px-3 font-medium">
                          {lead.nombre}
                        </td>
                        <td className="py-2 px-3 text-slate-500">
                          @{lead.instagramUsername}
                        </td>
                        <td className="py-2 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                            {lead.etapaActual ?? "Sin etapa"}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {lead.descartado ? (
                            <span className="text-red-600 text-xs font-medium">
                              {lead.motivoDescarte}
                            </span>
                          ) : (
                            <span className="text-green-600 text-xs font-medium">
                              Activo
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
