import { useState } from "react";
import { Layout } from "@/components/Layout";
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
import { Plus, UserCheck, UserX } from "lucide-react";

export default function Usuarios() {
  const utils = trpc.useUtils();
  const { data: users, isLoading } = trpc.user.list.useQuery();
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<string>("SETTER");
  const [error, setError] = useState("");

  const createUser = trpc.user.create.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      setOpen(false);
      setNombre("");
      setEmail("");
      setPassword("");
      setRol("SETTER");
      setError("");
    },
    onError: (err) => setError(err.message),
  });

  const toggleActive = trpc.user.toggleActive.useMutation({
    onSuccess: () => utils.user.list.invalidate(),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!nombre || !email || !password) {
      setError("Complete todos los campos");
      return;
    }
    createUser.mutate({ nombre, email, password, rol: rol as "SETTER" | "MANAGER" | "ADMIN" });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Usuarios</h1>
            <p className="text-slate-500 mt-1">
              Gestion de usuarios del sistema
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Nuevo usuario
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear usuario</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Nombre</Label>
                  <Input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Nombre completo"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@operal.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Contrasena</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimo 6 caracteres"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rol</Label>
                  <Select value={rol} onValueChange={setRol}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SETTER">Setter</SelectItem>
                      <SelectItem value="MANAGER">Manager</SelectItem>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createUser.isPending}
                >
                  {createUser.isPending ? "Creando..." : "Crear usuario"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-slate-500">
                Cargando usuarios...
              </div>
            ) : !users || users.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No hay usuarios registrados
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left py-3 px-4 font-medium text-slate-500">
                        Nombre
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-slate-500">
                        Email
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-slate-500">
                        Rol
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-slate-500">
                        Estado
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-slate-500">
                        Registro
                      </th>
                      <th className="text-right py-3 px-4 font-medium text-slate-500">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="py-3 px-4 font-medium">{u.nombre}</td>
                        <td className="py-3 px-4 text-slate-500">{u.email}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                            {u.rol.toLowerCase()}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {u.activo ? (
                            <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                              <UserCheck className="w-3 h-3" />
                              Activo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium">
                              <UserX className="w-3 h-3" />
                              Inactivo
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-400 text-xs">
                          {u.createdAt
                            ? new Date(u.createdAt).toLocaleDateString("es-AR")
                            : "-"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleActive.mutate({ id: u.id })}
                            disabled={toggleActive.isPending}
                          >
                            {u.activo ? "Desactivar" : "Activar"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
