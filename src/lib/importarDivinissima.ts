// Importa os dados reais da Divinissima (clientes + vendedores) pra dentro
// da empresa recém-cadastrada no Fluxa CRM. Roda direto no navegador do
// admin logado (não no sandbox de desenvolvimento) porque:
//  1) Precisa do Firebase Auth do admin já autenticado (regras do Firestore
//     do projeto `divinissima-crm` exigem `request.auth != null`, e o app
//     da Divinissima já usa login anônimo pra isso).
//  2) A rede do ambiente onde este código foi escrito bloqueia chamadas
//     diretas ao Firestore/Firebase Auth — só funciona no navegador real.
//
// Schema de origem (app da Divinissima, mesmo projeto Firebase):
//  - coleção `clientes/{id}`: um documento por cliente (campos: cod, razao,
//    nome, tel, cnpj, cidade, dtUltCompra, totalGeral, c1/c2/c3, produtos,
//    cod_vendedor, vend_nome, crmStage, crmVendedorLogin, crmOrcamentoValor,
//    crmOrigem, crmStageChangedAt, _excluido, _updatedAt).
//  - documento único `meta/state`: contém entre outras chaves o array
//    `vendedores` (login/nome/senha/meta) usado pelo CRM da Divinissima.
//
// A importação é idempotente (usa merge:true com o `cod` do cliente/login
// do vendedor como ID do documento de destino), então pode ser rodada mais
// de uma vez pra ressincronizar sem duplicar nada.
import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Cliente, Vendedor } from '../types';

interface ClienteDivinissima {
  cod?: string;
  razao?: string;
  nome?: string;
  tel?: string;
  cnpj?: string;
  cidade?: string;
  uf?: string;
  dtUltCompra?: string;
  totalGeral?: number;
  c1?: number;
  c2?: number;
  c3?: number;
  produtos?: Record<string, number>;
  cod_vendedor?: string;
  vend_nome?: string;
  crmStage?: Cliente['crmStage'];
  crmVendedorLogin?: string;
  crmOrcamentoValor?: number;
  crmOrigem?: Cliente['crmOrigem'];
  crmStageChangedAt?: string;
  _excluido?: boolean;
}

interface VendedorDivinissima {
  login?: string;
  nome?: string;
  senha?: string;
  meta?: number;
}

function idSeguro(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || `id-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ResultadoImportacao {
  clientesImportados: number;
  clientesIgnorados: number;
  vendedoresImportados: number;
}

export async function importarDadosDivinissima(empresaId: string): Promise<ResultadoImportacao> {
  const clientesSnap = await getDocs(collection(db, 'clientes'));
  const metaStateSnap = await getDoc(doc(db, 'meta', 'state'));
  const vendedoresOrigem: VendedorDivinissima[] = metaStateSnap.exists()
    ? (metaStateSnap.data().vendedores ?? [])
    : [];

  let clientesImportados = 0;
  let clientesIgnorados = 0;
  let lote = writeBatch(db);
  let operacoesNoLote = 0;

  async function commitSeNecessario() {
    if (operacoesNoLote >= 400) {
      await lote.commit();
      lote = writeBatch(db);
      operacoesNoLote = 0;
    }
  }

  for (const docSnap of clientesSnap.docs) {
    const c = docSnap.data() as ClienteDivinissima;
    if (c._excluido || !c.cod) {
      clientesIgnorados++;
      continue;
    }
    const destino: Omit<Cliente, 'id'> = {
      cod: c.cod,
      razao: c.razao,
      nome: c.nome,
      telefone: c.tel,
      cnpj: c.cnpj,
      cidade: c.cidade,
      uf: c.uf,
      dtUltCompra: c.dtUltCompra,
      totalGeral: c.totalGeral,
      c1: c.c1,
      c2: c.c2,
      c3: c.c3,
      produtos: c.produtos,
      cod_vendedor: c.cod_vendedor,
      vend_nome: c.vend_nome,
      crmStage: c.crmStage,
      crmVendedorLogin: c.crmVendedorLogin,
      crmOrcamentoValor: c.crmOrcamentoValor,
      crmOrigem: c.crmOrigem,
      crmStageChangedAt: c.crmStageChangedAt,
    };
    // Remove undefined (Firestore não aceita) mantendo o resto.
    const limpo = Object.fromEntries(Object.entries(destino).filter(([, v]) => v !== undefined));
    const ref = doc(db, 'empresas', empresaId, 'clientes', idSeguro(c.cod));
    lote.set(ref, limpo, { merge: true });
    operacoesNoLote++;
    clientesImportados++;
    await commitSeNecessario();
  }

  let vendedoresImportados = 0;
  for (const v of vendedoresOrigem) {
    if (!v.login || !v.nome) continue;
    const destino: Omit<Vendedor, 'id'> = {
      nome: v.nome,
      login: v.login,
      senha: v.senha ?? Math.random().toString(36).slice(2, 8),
      ativo: true,
      meta: v.meta,
      criadoEm: new Date().toISOString(),
    };
    const limpo = Object.fromEntries(Object.entries(destino).filter(([, val]) => val !== undefined));
    const ref = doc(db, 'empresas', empresaId, 'vendedores', idSeguro(v.login));
    lote.set(ref, limpo, { merge: true });
    operacoesNoLote++;
    vendedoresImportados++;
    await commitSeNecessario();
  }

  if (operacoesNoLote > 0) await lote.commit();

  return { clientesImportados, clientesIgnorados, vendedoresImportados };
}
