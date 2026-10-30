import type { Empresa } from '../types';

export type Modulo = 'crm' | 'marketing' | 'chat' | 'erp' | 'prospect';

/** Módulos individuais: nunca entram no "vincular tudo" (não misturam abas nem dados com os outros). */
export const MODULOS_SEPARADOS: Modulo[] = ['erp', 'prospect'];

/** Módulos que a empresa contratou. Empresas antigas (sem o campo) seguem
 * com tudo liberado, exceto as cadastradas só no Marketing. */
/** Módulos liberados direto pela plataforma para empresas antigas (além do que a tela Módulos grava). */
const LIBERADOS_PARA: Record<string, Modulo[]> = {
  Kb5nOo3SK0dAi3SsHk20Y0Oa1aE3: ['chat', 'erp', 'prospect'], // Carla Fidelis
};

export function modulosDaEmpresa(e: Empresa | null | undefined): Modulo[] {
  return modulosBase(e);
}

export function modulosBase(e: Empresa | null | undefined): Modulo[] {
  const base: Modulo[] = e?.modulos && e.modulos.length > 0 ? e.modulos : e?.produto === 'marketing' ? ['marketing'] : ['crm', 'marketing'];
  const extras = (e?.id && LIBERADOS_PARA[e.id]) || [];
  return [...base, ...extras.filter((m) => !base.includes(m))];
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
