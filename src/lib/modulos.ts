import type { Empresa } from '../types';

export type Modulo = 'crm' | 'marketing' | 'chat' | 'erp' | 'prospect';

/** Módulos individuais: nunca entram no "vincular tudo" (não misturam abas nem dados com os outros). */
export const MODULOS_SEPARADOS: Modulo[] = ['erp', 'prospect'];

/** Módulos que a empresa contratou. Empresas antigas (sem o campo) seguem
 * com tudo liberado, exceto as cadastradas só no Marketing. */
/** Empresas com o Prospect liberado direto pela plataforma (além do que a tela Módulos grava). */
const PROSPECT_LIBERADO_PARA = ['Kb5nOo3SK0dAi3SsHk20Y0Oa1aE3']; // Carla Fidelis

export function modulosDaEmpresa(e: Empresa | null | undefined): Modulo[] {
  const base = modulosBase(e);
  return e?.id && PROSPECT_LIBERADO_PARA.includes(e.id) && !base.includes('prospect') ? [...base, 'prospect'] : base;
}

export function modulosBase(e: Empresa | null | undefined): Modulo[] {
  if (e?.modulos && e.modulos.length > 0) return e.modulos;
  if (e?.produto === 'marketing') return ['marketing'];
  return ['crm', 'marketing'];
}

/** Módulo a que cada rota pertence. O Chat só é um módulo à parte (aba própria, vendável sozinho)
 * quando a empresa o contratou explicitamente; antes disso ele continua dentro do CRM, como sempre foi. */
export function moduloDaRota(caminho: string, modulos: Modulo[] = []): Modulo {
  if (caminho.startsWith('/marketing')) return 'marketing';
  if (caminho.startsWith('/erp')) return 'erp';
  if (caminho.startsWith('/prospect')) return 'prospect';
  if (caminho.startsWith('/chat')) return modulos.includes('chat') ? 'chat' : 'crm';
  return 'crm';
}

/** Tela inicial de cada módulo. */
export function rotaInicial(m: Modulo): string {
  return m === 'marketing' ? '/marketing' : m === 'chat' ? '/chat' : m === 'erp' ? '/erp/inicio' : m === 'prospect' ? '/prospect' : '/dashboard';
}
