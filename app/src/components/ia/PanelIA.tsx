import { GlassPanel } from "@/components/GlassPanel";
import { Button } from "@/components/ui/button";
import { STATUS, wash } from "@/lib/embudoDisplay";
import { Sparkles, TriangleAlert, Loader2 } from "lucide-react";

// Panel de una funcionalidad de IA: encabezado, controles propios, boton de
// disparo y area de respuesta. Centraliza el renderizado de la respuesta para
// que la regla de seguridad viva en UN solo lugar y no dependa de que cada
// pantalla se acuerde.
//
// ─────────────────────────────────────────────────────────────────────
// SEGURIDAD — la respuesta del modelo se renderiza SIEMPRE como TEXTO PLANO.
//
// `{respuesta}` como hijo de React queda escapado por defecto: cualquier
// <script>, <img onerror=...> o markup que venga en el texto se muestra como
// caracteres, no se ejecuta. Esto NO es decorativo: el resumen de objeciones
// le manda al modelo texto libre escrito por setters (docs/10_arquitectura_ia.md
// seccion 3), asi que la salida puede contener lo que un usuario haya tipeado.
//
// PROHIBIDO en este archivo y en cualquier consumidor:
//   - dangerouslySetInnerHTML sobre la salida del modelo
//   - pasarla a un renderer de Markdown que permita HTML embebido
//   - inyectarla en un innerHTML/insertAdjacentHTML
// Si algun dia se quiere formato (negritas, listas), hay que parsear a nodos
// de React con una lista blanca -- nunca convertir el string a HTML.
// ─────────────────────────────────────────────────────────────────────

export type PanelIAProps = {
  titulo: string;
  descripcion: string;
  /** Controles propios de esta funcionalidad (selectores, rangos). */
  controles?: React.ReactNode;
  onAnalizar: () => void;
  cargando: boolean;
  /** Deshabilita el disparo cuando faltan datos para poder consultar. */
  deshabilitado?: boolean;
  respuesta?: string;
  /** Aviso del validador determinista cuando cita un numero no verificable. */
  advertencia?: string | null;
  error?: string | null;
};

export function PanelIA({
  titulo,
  descripcion,
  controles,
  onAnalizar,
  cargando,
  deshabilitado,
  respuesta,
  advertencia,
  error,
}: PanelIAProps) {
  return (
    <GlassPanel className="gap-4">
      <div className="px-6 flex flex-col gap-1">
        <h2 className="font-semibold text-foreground">{titulo}</h2>
        <p className="text-sm text-muted-foreground">{descripcion}</p>
      </div>

      {controles && <div className="px-6">{controles}</div>}

      <div className="px-6">
        <Button onClick={onAnalizar} disabled={cargando || deshabilitado} size="sm">
          {cargando ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analizando...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Analizar
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="px-6">
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
        </div>
      )}

      {advertencia && (
        <div className="px-6">
          <div
            className="flex items-start gap-2 rounded-xl p-3 border"
            style={{ borderColor: wash(STATUS.warning, 35), backgroundColor: wash(STATUS.warning, 8) }}
          >
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" style={{ color: STATUS.warning }} />
            {/* Tambien texto plano: la advertencia incluye los numeros que el
                modelo escribio y no se pudieron verificar. */}
            <p className="text-sm text-foreground">{advertencia}</p>
          </div>
        </div>
      )}

      {respuesta && (
        <div className="px-6">
          {/* whitespace-pre-wrap conserva los saltos de linea del modelo sin
              interpretar nada como markup. */}
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{respuesta}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Generado por IA sobre datos ya calculados por el sistema. Es una lectura para decidir, no una acción
            ejecutada: la IA no modifica nada.
          </p>
        </div>
      )}
    </GlassPanel>
  );
}
