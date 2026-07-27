import { Navigate } from "react-router";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ColaLlamadas } from "./llamadas/ColaLlamadas";
import { DashboardLlamadas } from "./llamadas/DashboardLlamadas";

// Sprint 4, Fase 5: pantalla de la fase de llamada, solo ADMIN. Guard de
// ruta inline -- mismo patron que ya usa Dashboard.tsx para setters. No es
// la unica barrera: el backend (event.leadsParaLlamar, dashboardLlamadas,
// y las validaciones de LLAMADA_REGISTRADA/PAGO_REGISTRADO en event.create)
// ya rechaza a cualquier rol distinto de ADMIN de punta a punta (Fase 3/4).
export default function Llamadas() {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) return null;
  if (!isAdmin) {
    return <Navigate to="/leads" replace />;
  }

  return (
    <Layout>
      <div className="dark -m-6 p-6 min-h-[calc(100vh-1px)] bg-background text-foreground space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Llamadas</h1>
          <p className="text-slate-400 mt-1">
            Fase de cierre — a partir de que el setter agenda (D), hasta 3 llamadas por lead
          </p>
        </div>

        <Tabs defaultValue="cola">
          <TabsList>
            <TabsTrigger value="cola">Cola de llamadas</TabsTrigger>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          </TabsList>
          <TabsContent value="cola" className="mt-4">
            <ColaLlamadas />
          </TabsContent>
          <TabsContent value="dashboard" className="mt-4">
            <DashboardLlamadas />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
