import type { Empresa } from '../types';

export type Modulo = 'crm' | 'marketing';

/** Módulos que a empresa contratou. Empresas antigas (sem o campo) seguem
 * com tudo liberado, exceto as cadastradas só no Marketing. */
export function modulosDaEmpresa(e: Empresa | null | undefined): Modulo[] {
  if (e?.modulos && e.modulos.length > 0) return e.modulos;
  if (e?.produto === 'marketing') return ['marketing'];
  return ['crm', 'marketing'];
}

/** Módulo a que cada rota pertence. */
export function moduloDaRota(caminho: string): Modulo {
  return caminho.startsWith('/marketing') ? 'marketing' : 'crm';
}
