// Interfaz minima de desacople de proveedor -- docs/10_arquitectura_ia.md
// seccion 7. Las 4 funcionalidades de V1 son todas la misma operacion
// (prompt de sistema + contexto + pregunta -> texto), asi que un solo
// metodo alcanza. Sin streaming, sin tool-use, sin gestion de sesion --
// nada de eso esta en alcance (la IA es de solo lectura, nunca ejecuta).
export interface AIProvider {
  completar(
    promptSistema: string,
    contexto: string,
    pregunta: string,
    temperatura?: number,
  ): Promise<string>;
}
