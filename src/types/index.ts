// ===== Núcleo multiempresa =====

export type PapelUsuario = 'admin';

export interface Empresa {
  id: string;
  nome: string;
  cnpj?: string; // número do documento (CNPJ ou CPF, conforme documentoTipo)
  documentoTipo?: 'cnpj' | 'cpf';
  whatsapp?: string;
  segmento?: string; // segmento de trabalho (ex.: Varejo, E-commerce...)
  atividadePrincipal?: string; // atividade principal da empresa, em texto livre
  criadoEm: string; // ISO date
  plano: 'trial' | 'starter' | 'pro';
  metas?: MetaTier[]; // faixas globais de meta/comissão da empresa
  crmFiltros?: FiltroCrm[]; // filtros personalizados do quadro CRM (até 10)
  crmColunas?: ColunaCrm[]; // colunas personalizadas do quadro CRM (até 8)
}

// Filtro personalizado do quadro CRM — cada empresa pode criar até 10,
// combinando os critérios preenchidos (todos opcionais, exceto o nome) com
// "E" entre si. Salvo na própria empresa pra ficar visível/editável tanto
// pelo administrador quanto pelos vendedores.
export interface FiltroCrm {
  id: string;
  nome: string;
  texto?: string; // nome/código/telefone contém
  cidade?: string; // contém
  uf?: string; // igual (2 letras)
  vendedorLogin?: string; // igual
  valorMin?: number;
  valorMax?: number;
}

// Faixa de meta/comissão (ex.: "Meta 1" = R$5.000 → 3% + bônus R$200).
// A comissão do mês é calculada pela MAIOR faixa que o vendedor atingiu
// (não é cumulativo entre faixas) — mesma regra da Divinissima.
export interface MetaTier {
  label: string;
  valor: number;
  comissao: number; // percentual, ex.: 3 = 3%
  bonus: number;
}

// Padrão pra empresas novas: só a 1ª faixa (fixa). A empresa adiciona as
// próximas (até 5 no total) pelo botão "+ Meta" em Metas & Comissões,
// conforme o que fizer sentido pro negócio dela.
export const METAS_PADRAO: MetaTier[] = [{ label: 'Meta 1', valor: 5000, comissao: 3, bonus: 200 }];

export interface UsuarioPerfil {
  uid: string;
  nome: string;
  email: string;
  empresaId: string;
  papel: PapelUsuario;
  criadoEm: string;
}

// Vendedores não usam Firebase Auth — o admin cria um login/senha simples
// pra cada um, igual ao sistema atual da Divinissima (evita exigir e-mail
// próprio de cada vendedor).
export interface Vendedor {
  id: string;
  nome: string;
  login: string;
  senha: string;
  ativo: boolean;
  criadoEm?: string;
  meta?: number; // meta pessoal em R$ (opcional, além das faixas globais)
}

// ===== CRM =====

export interface Cliente {
  id: string;
  cod: string;
  razao?: string;
  nome?: string;
  telefone?: string;
  cnpj?: string;
  cidade?: string;
  uf?: string;
  dtUltCompra?: string; // ISO date da última compra/atendimento
  totalGeral?: number;
  c1?: number; // valor da compra mais recente
  c2?: number; // valor da 2ª compra mais recente
  c3?: number; // valor da 3ª compra mais recente
  produtos?: Record<string, number>; // categoria -> quantidade comprada
  cod_vendedor?: string; // vendedor "dono" do cliente (origem cadastral)
  vend_nome?: string;

  // Posição do cliente no quadro CRM (coluna personalizada da empresa) —
  // só muda por ação manual (arrastar no quadro ou pela aba "+ Lançar
  // orçamento"), nunca automaticamente.
  crmColunaId?: string; // referencia ColunaCrm.id; sem valor = cai na 1ª coluna
  crmColunaChangedAt?: string; // ISO date, usado pra filtrar comissão por mês
  crmVendedorLogin?: string; // vendedor responsável pelo card no funil
  crmOrcamentoValor?: number; // valor combinado quando o card entrou numa coluna de fechamento
}

// Coluna do quadro CRM — 100% personalizável pela empresa (até
// MAX_COLUNAS_CRM). Uma coluna marcada como "fechamento" conta como venda
// concluída pra fins de comissão (aba Metas & Comissões): ao soltar um
// card lá, pede vendedor responsável + valor combinado.
export interface ColunaCrm {
  id: string;
  nome: string;
  fechamento?: boolean;
}

export const MAX_COLUNAS_CRM = 8;

// Empresa nova começa com 1 coluna só, chamada "Novo" — o resto quem monta
// é a própria empresa (renomeando e adicionando colunas, até o limite).
export const CRM_COLUNAS_PADRAO: ColunaCrm[] = [{ id: 'coluna-inicial', nome: 'Novo' }];
