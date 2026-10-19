// Leitura de planilha de produtos para o Fluxa ERP. Entende os cabeçalhos mais comuns das exportações
// do Bling, Olist/Tiny e do próprio Fluxa (a conexão por API com esses sistemas vem depois).
import { lerTabelaBruta } from './importarPlanilha';
import { parseValorBR } from './crmLogic';
import type { Produto } from '../types';

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function coluna(cab: string[], nomes: string[]): number {
  const c = cab.map((x) => norm(x ?? ''));
  for (const n of nomes) {
    const i = c.findIndex((x) => x === n);
    if (i >= 0) return i;
  }
  for (const n of nomes) {
    const i = c.findIndex((x) => x.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

const num = (v: string | undefined) => {
  const n = parseValorBR(String(v ?? '').replace(/[R$\s]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

export interface ResultadoLeitura { produtos: Omit<Produto, 'id' | 'criadoEm' | 'atualizadoEm'>[]; ignoradas: number; semColunas: string[] }

export async function lerProdutosDaPlanilha(arquivo: File): Promise<ResultadoLeitura> {
  const tabela = await lerTabelaBruta(arquivo);
  const iCab = tabela.findIndex((l) => l.some((c) => norm(String(c ?? '')).match(/^(codigo|sku|descricao|nome)/)));
  const cab = (tabela[iCab >= 0 ? iCab : 0] ?? []).map((c) => String(c ?? ''));
  const iSku = coluna(cab, ['codigo (sku)', 'sku', 'codigo', 'cod']);
  const iNome = coluna(cab, ['descricao', 'nome', 'produto']);
  const iPreco = coluna(cab, ['preco de venda', 'preco', 'valor']);
  const iCusto = coluna(cab, ['preco de custo', 'custo']);
  const iEstoque = coluna(cab, ['saldo em estoque', 'estoque atual', 'estoque', 'saldo', 'quantidade']);
  const iMin = coluna(cab, ['estoque minimo', 'minimo']);
  const iCat = coluna(cab, ['categoria', 'grupo']);
  const iUn = coluna(cab, ['unidade', 'un']);
  const semColunas = [iSku < 0 && 'código', iNome < 0 && 'descrição'].filter(Boolean) as string[];
  if (semColunas.length) return { produtos: [], ignoradas: 0, semColunas };
  const produtos: ResultadoLeitura['produtos'] = [];
  let ignoradas = 0;
  for (const l of tabela.slice((iCab >= 0 ? iCab : 0) + 1)) {
    const sku = String(l[iSku] ?? '').trim();
    const nome = String(l[iNome] ?? '').trim();
    if (!sku || !nome) { ignoradas++; continue; }
    produtos.push({
      sku, nome,
      categoria: iCat >= 0 ? String(l[iCat] ?? '').trim() || undefined : undefined,
      unidade: iUn >= 0 ? String(l[iUn] ?? '').trim() || 'un' : 'un',
      preco: iPreco >= 0 ? num(l[iPreco]) : 0,
      custo: iCusto >= 0 ? num(l[iCusto]) : 0,
      estoque: iEstoque >= 0 ? num(l[iEstoque]) : 0,
      estoqueMinimo: iMin >= 0 ? num(l[iMin]) : 0,
      ativo: true,
    });
  }
  return { produtos, ignoradas, semColunas: [] };
}

export function modeloCsv(): string {
  return 'Código;Descrição;Categoria;Unidade;Preço;Preço de custo;Estoque;Estoque mínimo\nANL-001;Anel Solitário Dourado;Anéis;un;89,90;32,00;12;3\n';
}
