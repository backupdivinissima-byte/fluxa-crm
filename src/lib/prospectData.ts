// Fluxa Prospect: achar e qualificar novos clientes em potencial.
// Fontes: Google Places (telefone, site, avaliações) + Receita Federal por CNPJ (BrasilAPI, grátis).
import { collection, deleteDoc, doc, getDoc, onSnapshot, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { acaoDaColuna } from './crmLogic';
import { criarAgendamentos, isoLocal } from './agendaData';
import { CRM_COLUNAS_PADRAO, type Cliente, type ColunaCrm } from '../types';

export type StatusLead = 'novo' | 'contatado' | 'interessado' | 'descartado' | 'transferido';

export interface Lead {
  id: string; // place id do Google
  nome: string;
  endereco?: string;
  telefone?: string; // como veio do Google (nacional)
  whatsapp?: string; // só dígitos com 55, quando é celular
  site?: string;
  mapaUrl?: string;
  avaliacao?: number;
  avaliacoes?: number;
  aberto?: boolean; // funcionando
  tipos?: string[];
  cnpj?: string;
  instagram?: string; // @ do Instagram (sem o @)
  buscarInstagram?: boolean; // pedido ao servidor: ler o site da loja e achar o @
  instagramStatus?: 'achou' | 'nao_achou' | 'sem_site' | 'erro';
  receita?: { razao?: string; fantasia?: string; situacao?: string; cnae?: string; porte?: string; abertura?: string; municipio?: string; uf?: string; telefone?: string; email?: string };
  nota: number; // 0–100
  motivos: string[];
  status: StatusLead;
  obs?: string;
  busca?: string; // o que foi buscado (ex.: "loja de semijoias em Belo Horizonte, MG")
  criadoEm: string;
  atualizadoEm?: string;
  clienteId?: string; // cliente criado no CRM ao transferir
  rodizioLogin?: string; // vendedor que recebeu o lead pelo rodízio do admin
}

const CHAVE_GOOGLE = (import.meta.env.VITE_GOOGLE_PLACES_KEY as string | undefined) ?? '';
export const googleConfigurado = !!CHAVE_GOOGLE;

function col(empresaId: string) {
  return collection(db, 'empresas', empresaId, 'prospectLeads');
}
export function ouvirLeads(empresaId: string, cb: (l: Lead[]) => void, aoErro?: (m: string) => void): Unsubscribe {
  return onSnapshot(
    col(empresaId),
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Lead), id: d.id }))),
    (e) => {
      aoErro?.(e.message);
      cb([]);
    }
  );
}
function semUndef<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}
export async function salvarLead(empresaId: string, l: Lead) {
  const pedir = !!l.site && !l.instagram && l.instagramStatus === undefined; // lead novo com site: o servidor procura o @ no site
  await setDoc(doc(col(empresaId), l.id), semUndef({ ...l, ...(pedir ? { buscarInstagram: true } : {}), atualizadoEm: new Date().toISOString() }));
}
export async function atualizarLead(empresaId: string, id: string, patch: Partial<Lead>) {
  await updateDoc(doc(col(empresaId), id), semUndef({ ...patch, atualizadoEm: new Date().toISOString() }));
}
export async function removerLead(empresaId: string, id: string) {
  await deleteDoc(doc(col(empresaId), id));
}

const soDigitos = (s?: string) => (s ?? '').replace(/\D/g, '');
/** Celular brasileiro (DDD + 9 + 8 dígitos) → número de WhatsApp com 55; telefone fixo → vazio. */
export function whatsappDe(tel?: string): string | undefined {
  let d = soDigitos(tel);
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  return d.length === 11 && d[2] === '9' ? '55' + d : undefined;
}

/** Nota 0–100 para priorizar quem abordar primeiro, com os motivos. */
export function notaDoLead(l: Pick<Lead, 'telefone' | 'whatsapp' | 'site' | 'avaliacao' | 'avaliacoes' | 'aberto' | 'tipos' | 'receita'>): { nota: number; motivos: string[] } {
  let n = 0;
  const m: string[] = [];
  if (l.whatsapp) { n += 30; m.push('+30 tem WhatsApp (celular)'); }
  else if (l.telefone) { n += 12; m.push('+12 tem telefone fixo'); }
  if (l.site) { n += 12; m.push('+12 tem site'); }
  if (l.aberto !== false) { n += 10; m.push('+10 funcionando'); } else m.push('0 fechada no Google');
  if ((l.avaliacoes ?? 0) >= 50) { n += 15; m.push('+15 muitas avaliações (50+)'); }
  else if ((l.avaliacoes ?? 0) >= 10) { n += 8; m.push('+8 já tem avaliações (10+)'); }
  if ((l.avaliacao ?? 0) >= 4.3) { n += 8; m.push('+8 bem avaliada (4,3+)'); }
  const t = (l.tipos ?? []).join(' ');
  if (/jewelry|clothing|shoe|gift|store|shopping|boutique/.test(t)) { n += 10; m.push('+10 é loja do varejo'); }
  if (l.receita) {
    if (/ativa/i.test(l.receita.situacao ?? '')) { n += 10; m.push('+10 CNPJ ativo na Receita'); }
    else if (l.receita.situacao) { n -= 20; m.push('-20 CNPJ não está ativo na Receita'); }
    if (/demais|epp|pequeno|medio|médio/i.test(l.receita.porte ?? '')) { n += 5; m.push('+5 porte compatível'); }
  }
  return { nota: Math.max(0, Math.min(100, n)), motivos: m };
}

const ESTADOS: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco',
  PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
  SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

export interface ResultadoBusca {
  leads: Lead[];
  proxima?: string;
}
/** Busca no Google Places (API nova). 20 por página. */
export async function buscarLugares(termo: string, cidade: string, uf: string, proxima?: string): Promise<ResultadoBusca> {
  if (!CHAVE_GOOGLE) throw new Error('A chave do Google ainda não foi configurada.');
  const consulta = uf === 'BR' ? `${termo} no Brasil` : cidade.trim() ? `${termo} em ${cidade.trim()}${uf ? ', ' + uf : ''}` : `${termo} no estado de ${ESTADOS[uf] ?? uf}`;
  const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': CHAVE_GOOGLE,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.businessStatus,places.types,nextPageToken',
    },
    body: JSON.stringify({ textQuery: consulta, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20, ...(proxima ? { pageToken: proxima } : {}) }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Google ${resp.status}: ${t.slice(0, 160)}`);
  }
  const j = (await resp.json()) as { places?: Array<Record<string, unknown>>; nextPageToken?: string };
  const agora = new Date().toISOString();
  const leads: Lead[] = (j.places ?? []).map((p) => {
    const base: Omit<Lead, 'nota' | 'motivos' | 'status' | 'criadoEm'> = {
      id: String(p.id),
      nome: String((p.displayName as { text?: string } | undefined)?.text ?? 'Sem nome'),
      endereco: p.formattedAddress as string | undefined,
      telefone: p.nationalPhoneNumber as string | undefined,
      whatsapp: whatsappDe(p.nationalPhoneNumber as string | undefined),
      site: p.websiteUri as string | undefined,
      mapaUrl: p.googleMapsUri as string | undefined,
      avaliacao: p.rating as number | undefined,
      avaliacoes: p.userRatingCount as number | undefined,
      aberto: p.businessStatus ? p.businessStatus === 'OPERATIONAL' : undefined,
      tipos: p.types as string[] | undefined,
      busca: consulta,
    };
    const { nota, motivos } = notaDoLead(base);
    return { ...base, nota, motivos, status: 'novo', criadoEm: agora };
  });
  return { leads, proxima: j.nextPageToken };
}

/** Dados do CNPJ na Receita (BrasilAPI, grátis). */
export async function consultarCnpj(cnpj: string): Promise<NonNullable<Lead['receita']>> {
  const d = soDigitos(cnpj);
  if (d.length !== 14) throw new Error('O CNPJ precisa ter 14 números.');
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
  if (!r.ok) throw new Error(r.status === 404 ? 'CNPJ não encontrado.' : `Não consegui consultar agora (${r.status}).`);
  const j = (await r.json()) as Record<string, unknown>;
  return {
    razao: j.razao_social as string | undefined,
    fantasia: j.nome_fantasia as string | undefined,
    situacao: j.descricao_situacao_cadastral as string | undefined,
    cnae: j.cnae_fiscal_descricao as string | undefined,
    porte: (j.porte ?? j.descricao_porte) as string | undefined,
    abertura: j.data_inicio_atividade as string | undefined,
    municipio: j.municipio as string | undefined,
    uf: j.uf as string | undefined,
    telefone: j.ddd_telefone_1 as string | undefined,
    email: j.email as string | undefined,
  };
}



/** Cria (ou reaproveita) o cliente do CRM a partir do lead, com a tag Prospect, e devolve o id. */
async function clienteDoLead(empresaId: string, lead: Lead, clientes: Cliente[], extra: Partial<Cliente>): Promise<string> {
  const k = soDigitos(lead.whatsapp ?? lead.telefone).slice(-9);
  const existente = k.length === 9 ? clientes.find((c) => soDigitos(c.telefone).slice(-9) === k) : undefined;
  const id = existente?.id ?? `prospect-${lead.id.replace(/[^A-Za-z0-9_-]/g, '').slice(-24)}`;
  const dados: Record<string, unknown> = {
    ...extra,
    prospectLeadId: lead.id,
    ...(existente ? {} : { cod: id, nome: lead.nome, razao: lead.receita?.razao, telefone: lead.whatsapp ?? lead.telefone, cnpj: lead.cnpj, cidade: lead.receita?.municipio, uf: lead.receita?.uf, prospect: true }),
  };
  await setDoc(doc(db, 'empresas', empresaId, 'clientes', id), JSON.parse(JSON.stringify(dados)), { merge: true });
  return id;
}

/** Vendedor prospectou e o lead está interessado: cai no CRM, coluna "Em atendimento", com a tag Prospect. */
export async function transferirParaAtendimento(empresaId: string, lead: Lead, vendedor: { login: string; nome: string }, clientes: Cliente[]) {
  const emp = await getDoc(doc(db, 'empresas', empresaId));
  const salvas = (emp.data()?.crmColunas ?? []) as ColunaCrm[];
  const colunas = salvas.length > 0 ? salvas : CRM_COLUNAS_PADRAO;
  const col = colunas.find((c) => acaoDaColuna(c) === 'atendimento');
  if (!col) throw new Error('Não há coluna "Em atendimento" configurada no CRM.');
  const id = await clienteDoLead(empresaId, lead, clientes, {
    crmColunaId: col.id,
    crmVendedorLogin: vendedor.login,
    crmColunaChangedAt: new Date().toISOString(),
  });
  await atualizarLead(empresaId, lead.id, { status: 'transferido', clienteId: id });
}

/** Admin coloca o lead no rodízio: vira cliente Prospect do vendedor e explode na tela dele (agenda). */
export async function enviarAoRodizio(empresaId: string, lead: Lead, vendedor: { login: string; nome: string }, autor: string, clientes: Cliente[]) {
  const id = await clienteDoLead(empresaId, lead, clientes, { crmVendedorLogin: vendedor.login });
  const agora = new Date();
  await criarAgendamentos(empresaId, [
    {
      data: isoLocal(agora),
      hora: `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`,
      clienteId: id,
      clienteCod: id,
      clienteNome: lead.nome,
      telefone: lead.whatsapp ?? lead.telefone,
      vendedorLogin: vendedor.login,
      vendedorNome: vendedor.nome,
      obs: `Lead do Prospect (nota ${lead.nota}) — inicie o atendimento.`,
      status: 'pendente',
      origem: 'rodizio',
      criadoEm: agora.toISOString(),
      criadoPor: autor,
      lembreteEm: agora.toISOString(),
    },
  ]);
  await atualizarLead(empresaId, lead.id, { clienteId: id, rodizioLogin: vendedor.login });
}
