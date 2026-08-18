// ===== Núcleo multiempresa =====

export type PapelUsuario = 'admin';

export interface Empresa {
  id: string;
  nome: string;
  cnpj?: string;
  criadoEm: string; // ISO date
  plano: 'trial' | 'starter' | 'pro';
  metas?: MetaTier[]; // faixas globais de meta/comissão da empresa
  crmFiltros?: FiltroCrm[]; // filtros personalizados do quadro CRM (até 10)
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

// As 8 colunas fixas do funil (mesmo modelo da Divinissima). As 3 primeiras
// são calculadas automaticamente por dias sem compra; as 5 seguintes são
// manuais, controladas por crmStage/crmOrigem.
export type CrmStage = 'atendimento' | 'orcamento' | 'concluido' | null;
export type CrmOrigem = 'live' | 'catalogo';

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

  // Campos do pipeline manual do CRM — preenchidos pelo time de vendas.
  // Protegidos contra sobrescrita automática (mesma lógica do
  // mergeClientesCRM da Divinissima): só mudam por ação manual do usuário.
  crmStage?: CrmStage;
  crmVendedorLogin?: string;
  crmOrcamentoValor?: number;
  crmOrigem?: CrmOrigem;
  crmStageChangedAt?: string; // ISO date, usado pra resolver conflitos no merge
}

// As 3 colunas automáticas (por dias sem compra) + as 5 manuais do pipeline.
export type KbColunaId =
  | 'inativos'
  | 'd31_40'
  | 'ativos'
  | 'atendimento'
  | 'orcamento_live'
  | 'orcamento_catalogo'
  | 'concluido_live'
  | 'concluido_catalogo';

export interface KbColuna {
  id: KbColunaId;
  titulo: string;
  sub?: string;
  cor: string;
  auto: boolean;
}

export const KB_COLUNAS: KbColuna[] = [
  { id: 'inativos', titulo: 'Clientes Inativos', sub: '+ 40 dias sem compra', cor: '#C0392B', auto: true },
  { id: 'd31_40', titulo: '31 a 40 dias', sub: 'risco de inatividade', cor: '#E67E22', auto: true },
  { id: 'ativos', titulo: 'Clientes Ativos', sub: 'até 30 dias', cor: '#27AE60', auto: true },
  { id: 'atendimento', titulo: 'Em Atendimento', cor: '#2980B9', auto: false },
  { id: 'orcamento_live', titulo: 'Orçamento 1', cor: '#8E6FBE', auto: false },
  { id: 'orcamento_catalogo', titulo: 'Orçamento 2', cor: '#1791A8', auto: false },
  { id: 'concluido_live', titulo: 'Concluído Live', cor: '#1E7A46', auto: false },
  { id: 'concluido_catalogo', titulo: 'Concluído Catálogo', cor: '#4C51BF', auto: false },
];
