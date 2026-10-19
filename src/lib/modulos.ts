import type { Empresa } from '../types';

export type Modulo = 'crm' | 'marketing' | 'chat' | 'erp';

/** Módulos que a empresa contratou. Empresas antigas (sem o campo) seguem
 * com tudo liberado, exceto as cadastradas só no Marketing. */
export function modulosDaEmpresa(e: Empresa | null | undefined): Modulo[] {
  if (e?.modulos && e.modulos.length > 0) return e.modulos;
  if (e?.produto === 'marketing') return ['marketing'];
  return ['crm', 'marketing'];
}

/** Módulo a que cada rota pertence. O Chat só é um módulo à parte (aba própria, vendável sozinho)
 * quando a empresa o contratou explicitamente; antes disso ele continua dentro do CRM, como sempre foi. */
export function moduloDaRota(caminho: string, modulos: Modulo[] = []): Modulo {
  if (caminho.startsWith('/marketing')) return 'marketing';
  if (caminho.startsWith('/erp')) return 'erp';
  if (caminho.startsWith('/chat')) return modulos.includes('chat') ? 'chat' : 'crm';
  return 'crm';
}

/** Tela inicial de cada módulo. */
export function rotaInicial(m: Modulo): string {
  return m === 'marketing' ? '/marketing' : m === 'chat' ? '/chat' : m === 'erp' ? '/erp/inicio' : '/dashboard';
}
