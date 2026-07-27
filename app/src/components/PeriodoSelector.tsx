import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Extraido de Dashboard.tsx (Sprint 3) para reusar en el dashboard de
// llamadas (Sprint 4, Fase 5) sin duplicar el componente ni la lista de
// periodos -- un solo lugar si algun dia cambia una etiqueta o se agrega
// un periodo nuevo.
export const PERIODOS = [
  { value: "lifetime", label: "Todo el historial" },
  { value: "mensual", label: "Este mes" },
  { value: "trimestral", label: "Este trimestre" },
  { value: "semestral", label: "Este semestre" },
  { value: "anual", label: "Este año" },
  { value: "rango", label: "Rango personalizado" },
] as const;

export type Periodo = (typeof PERIODOS)[number]["value"];

export function PeriodoSelector({
  periodo,
  onPeriodoChange,
  rangoDesde,
  onRangoDesdeChange,
  rangoHasta,
  onRangoHastaChange,
}: {
  periodo: string;
  onPeriodoChange: (p: string) => void;
  rangoDesde: string;
  onRangoDesdeChange: (v: string) => void;
  rangoHasta: string;
  onRangoHastaChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
      <Select value={periodo} onValueChange={onPeriodoChange}>
        <SelectTrigger className="w-full sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIODOS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {periodo === "rango" && (
        <div className="flex items-center gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-slate-400">Desde</Label>
            <Input
              type="date"
              value={rangoDesde}
              onChange={(e) => onRangoDesdeChange(e.target.value)}
              className="w-36"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-400">Hasta</Label>
            <Input
              type="date"
              value={rangoHasta}
              onChange={(e) => onRangoHastaChange(e.target.value)}
              className="w-36"
            />
          </div>
        </div>
      )}
    </div>
  );
}
