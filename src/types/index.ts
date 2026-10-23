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
  // Qual produto Fluxa a empresa escolheu testar no cadastro (hoje só 'crm'
  // tem formulário completo — os demais ainda são só "quero ser avisado").
  // Usado, entre outras coisas, pra personalizar a tela de login por módulo
  // quando os outros produtos tiverem cadastro próprio.
  produto?: 'crm' | 'erp' | 'marketing' | 'prospect' | 'live' | 'chat';
  // Módulos contratados (cada um tem só as próprias abas). Sem este campo =
  // empresa antiga: segue com tudo liberado (exceto as que se cadastraram só
  // no Marketing, ver src/lib/modulos.ts).
  modulos?: ('crm' | 'marketing' | 'chat' | 'erp')[];
  // Com mais de um módulo: true = abas de todos juntas; false = módulos
  // separados (um de cada vez); sem valor = ainda não respondeu à pergunta.
  modulosVinculados?: boolean;
  // Chave de API ("Importar via API", tela Importar/Sincronização) — só o
  // hash SHA-256 fica salvo aqui, nunca a chave em texto puro (gerada e
  // mostrada uma única vez no navegador, ver src/lib/apiKey.ts).
  apiKeyHash?: string;
  apiKeyGeradaEm?: string; // ISO date
  metas?: MetaTier[]; // faixas globais de meta/comissão da empresa
  comissaoBase?: number; // % de comissão de quem vende abaixo da 1ª meta (padrão 2)
  crmFiltros?: FiltroCrm[]; // filtros personalizados do quadro CRM (até 10)
  crmColunas?: ColunaCrm[]; // colunas personalizadas do quadro CRM (até 8)
  // Histórico de vendas por ano/mês pro gráfico do Dashboard ("Evolução de
  // vendas por mês"). Não existe registro histórico de vendas por
  // transação no sistema, então isso é preenchido manualmente pela empresa
  // (botão "+ Ano" no Dashboard) — EXCETO o mês corrente do ano corrente,
  // que o Dashboard sempre sobrescreve com o valor real calculado a partir
  // dos cards do funil (nunca editável manualmente).
  vendasAnuais?: { ano: number; meses: number[] }[]; // meses: 12 posições, Jan-Dez
  // Mesmo padrão de vendasAnuais, mas pra número de clientes ativos por
  // mês — usado nos indicadores abaixo de cada barra do gráfico "Evolução
  // de vendas por mês". O mês corrente também é sempre recalculado ao vivo
  // (nº de clientes ativos nesse momento), nunca editável manualmente.
  clientesAtivosAnuais?: { ano: number; meses: number[] }[];
  // Prazo (em dias sem compra/atendimento) que o funil de atendimento do
  // Dashboard usa pra separar "Ativos" de "Inativos" — configurável pelo
  // admin (botões 30/60/90/personalizado). Padrão 30 se não definido.
  // Só vale pro funil do Dashboard; o corte fixo usado em Clientes/detalhe
  // do cliente continua como antes.
  diasInatividade?: number;
  // true depois que o funil padrão do Fluxa CRM foi aplicado a esta empresa
  // (acontece uma vez, na primeira vez que o administrador abre o CRM).
  crmFunilPadrao?: boolean;
  // Conexão "puxando" dados de fora (sentido oposto ao apiKeyHash acima):
  // aqui é o Fluxa CRM que chama a API do sistema atual da empresa (ERP,
  // e-commerce etc.) e importa a lista de clientes automaticamente. Guarda
  // a credencial de autenticação em texto (não dá pra só hash — o backend
  // precisa reenviá-la pra cada chamada), então nunca é reexibida na tela
  // depois de salva (só um "•••• salvo").
  erpConexao?: {
    url: string;
    autenticacao: 'nenhuma' | 'bearer' | 'header' | 'basic';
    headerNome?: string; // nome do cabeçalho quando autenticacao === 'header'
    valorAuth?: string; // token/senha
    usuarioBasic?: string; // usuário quando autenticacao === 'basic'
    listaPath?: string; // caminho até o array de clientes na resposta JSON (vazio = resposta já é a lista)
    mapeamento: Record<string, string>; // campo do Fluxa (cod, nome, telefone...) -> caminho no JSON de cada item
    configuradoEm?: string;
    ultimaSincronizacao?: string;
  };
  // Conexões do módulo Marketing (Fase 2 — sincronização automática das
  // abas Meta e Live). Ver interfaces MetaAdsConexao/InstagramConexao.
  metaAdsConexao?: MetaAdsConexao;
  instagramConexao?: InstagramConexao;
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
// (não é cumulativo entre faixas).
export interface MetaTier {
  label: string;
  valor: number;
  comissao: number; // percentual, ex.: 3 = 3%
  bonus: number;
}

// Padrão pra empresas novas: só a 1ª faixa (fixa). A empresa adiciona as
// próximas (até 5 no total) pelo botão "+ Meta" em Metas & Comissões,
// conforme o que fizer sentido pro negócio dela.
/** Comissão (%) de quem fica abaixo da Meta 1. */
export const COMISSAO_BASE_PADRAO = 2;

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
// pra cada um (evita exigir e-mail próprio de cada vendedor).
export interface Vendedor {
  id: string;
  nome: string;
  login: string;
  senha: string;
  ativo: boolean;
  criadoEm?: string;
  meta?: number; // meta pessoal em R$ (opcional, além das faixas globais)
  metas?: MetaTier[]; // faixas de meta/comissão/bônus próprias deste vendedor (se vazio, vale o padrão da empresa)
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
  porVendedor?: Array<{ cod?: string; nome?: string; valor: number }>; // só durante a leitura do arquivo
  meses?: Record<string, { totalGeral: number; liquido: number; pedidos: number; produtos?: Record<string, number>; dtUltCompra?: string; cod_vendedor?: string; vend_nome?: string; porVendedor: Array<{ cod?: string; nome?: string; valor: number; pedidos?: number; liquido?: number }> }>; // só durante a leitura: o mesmo cliente separado por mês da venda
  cod_vendedor?: string; // vendedor "dono" do cliente (origem cadastral)
  vend_nome?: string;

  // Rastreia a contribuição de CADA MÊS já importado pra esse cliente
  // (chave = mês da compra, ex. "mes-2026-08" — cai de volta pro nome do
  // arquivo quando não há data) — necessário porque totalGeral/produtos são
  // SOMADOS entre meses diferentes, mas reimportar dados do MESMO mês de
  // novo precisa ser seguro (substituir só a contribuição daquele mês, não
  // somar de novo) — inclusive quando o arquivo reexportado tem um nome
  // diferente do anterior, o caso comum do mês corrente sendo reimportado
  // várias vezes ao longo do mês. Sem isso, importar um novo mês
  // separadamente de um mês já importado antes apagaria a contribuição do
  // mês anterior em vez de somar (Firestore `merge:true` substitui os
  // campos, não soma). totalGeral/produtos/dtUltCompra/cod_vendedor/
  // vend_nome acima são sempre recalculados a partir da soma de todas as
  // entradas aqui — nunca editados diretamente.
  origensImportacao?: Record<
    string,
    {
      totalGeral?: number;
      liquido?: number; // soma do Vlr. Líquido das vendas do mês
      pedidos?: number; // quantidade de vendas (pedidos) do mês para este cliente
      produtos?: Record<string, number>;
      dtUltCompra?: string;
      cod_vendedor?: string;
      vend_nome?: string;
      // Quanto cada vendedor vendeu nesse mês para este cliente (venda a venda, como no relatório do ERP).
      // É uma lista (não um mapa) para que cada reimportação a SUBSTITUA inteira em vez de mesclar com a antiga.
      porVendedor?: Array<{ cod?: string; nome?: string; valor: number; pedidos?: number; liquido?: number }>;
    }
  >;

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
  // Coluna automática: os clientes entram sozinhos conforme os dias sem
  // compra e o prazo de inatividade do Dashboard (30/60/90/personalizado).
  // "inativos" = acima do prazo; "risco" = os 9 dias antes do prazo. Sem
  // valor = coluna manual (o cliente só muda arrastando).
  auto?: 'inativos' | 'risco';
  // Ação ao soltar um cliente na coluna (coluna manual):
  // "atendimento" = pede pra confirmar o vendedor responsável (o cliente
  // passa a ser dele); se ficar sem venda no prazo de inatividade, volta
  // sozinho pra risco/inativos. "orcamento" = pede o valor do orçamento,
  // somado no topo da coluna como valor em aberto.
  // Sem valor, a ação é deduzida do nome da coluna ("Em Atendimento",
  // "Orçamento ...") — ver acaoDaColuna. "nenhuma" = a pessoa escolheu
  // "Manual" de propósito, então o nome não conta.
  acao?: 'atendimento' | 'orcamento' | 'nenhuma';
}

export const MAX_COLUNAS_CRM = 8;

/** Funil de vendas recomendado: inativos e em risco automáticos (pelo prazo de
 * inatividade do Dashboard), atendimento com vínculo ao vendedor, orçamentos
 * com valor em aberto e concluídos (que contam como venda). */
export const CRM_FUNIL_RECOMENDADO: ColunaCrm[] = [
  { id: 'funil-inativos', nome: 'Clientes Inativos', auto: 'inativos' },
  { id: 'funil-risco', nome: 'Clientes em risco', auto: 'risco' },
  { id: 'funil-ativos', nome: 'Clientes Ativos', acao: 'nenhuma' },
  { id: 'funil-atendimento', nome: 'Em Atendimento', acao: 'atendimento' },
  { id: 'funil-orcamento-live', nome: 'Orçamento Live', acao: 'orcamento' },
  { id: 'funil-orcamento-catalogo', nome: 'Orçamento Catálogo', acao: 'orcamento' },
  { id: 'funil-concluido-live', nome: 'Concluído Live', fechamento: true },
  { id: 'funil-concluido-catalogo', nome: 'Concluído Catálogo', fechamento: true },
];

// Empresa sem funil salvo começa já com o funil recomendado (dá pra renomear,
// adicionar e remover colunas depois).
export const CRM_COLUNAS_PADRAO: ColunaCrm[] = CRM_FUNIL_RECOMENDADO;

// ===== Marketing (Meta Ads, Live, Análise Marketing) =====

// Uma campanha do Gerenciador de Anúncios (Meta Ads), snapshot mais recente
// de cada campanha — não é histórico dia a dia, é "como está agora" (ou como
// estava na planilha importada). "origem" diferencia o que veio de upload
// manual/planilha do que um dia vier da sincronização automática (Fase 2,
// ver Empresa.metaAdsConexao) — útil pra saber se o dado é confiável/atual.
export interface CampanhaMeta {
  id: string;
  nome: string;
  status: 'ativa' | 'pausada' | 'removida' | 'em_revisao';
  resultado?: number; // nº de resultados alcançados (conversas, compras, leads...)
  tipoResultado?: string; // rótulo livre do tipo de resultado, ex.: "Conversas iniciadas"
  alcance?: number;
  impressoes?: number;
  custoPorResultado?: number;
  orcamento?: number;
  orcamentoTipo?: 'diario' | 'total';
  valorGasto?: number;
  dataInicio?: string; // ISO date
  dataFim?: string; // ISO date
  atualizadoEm: string; // ISO date — data de referência do dado (mês da planilha importada, ou hoje se API)
  origem: 'manual' | 'api';
}

// Uma live agendada no calendário da aba "Live". Enquanto "agendada", só tem
// os dados de agenda; ao clicar "Encerrar live" ganha as métricas
// (visualizações/pico de pessoas online), preenchidas manualmente ou —
// quando a conexão com Instagram estiver configurada (Fase 2) — buscadas
// automaticamente via API oficial.
export interface Live {
  id: string;
  data: string; // ISO date (YYYY-MM-DD)
  horaInicio: string; // "HH:MM"
  horaFim: string; // "HH:MM" — horário previsto/real de encerramento
  titulo?: string;
  status: 'agendada' | 'encerrada';
  visualizacoes?: number;
  picoPessoasOnline?: number;
  encerradaEm?: string; // ISO datetime
  origemMetricas?: 'manual' | 'instagram_api';
}

// Uma linha da planilha de "reserva da live" importada: o orçamento das
// peças que o cliente reservou durante/por causa da live. Cruzado com
// Cliente pelo campo "cod" (mesma chave usada em todo o CRM) — cliente com
// reserva aqui = veio da live; sem reserva = cliente "catálogo" (fora live).
export interface ReservaLive {
  id: string;
  liveId?: string; // live específica, quando a planilha é importada por live
  data: string; // ISO date da reserva
  cod: string; // código do cliente — mesma chave de Cliente.cod
  nomeCliente: string;
  valorReservaLive: number; // orçamento das peças reservadas na live
  importadoEm: string; // ISO date
  arquivoOrigem?: string;
}

// Conexão com o Meta Ads (Fase 2 — sincronização automática da aba Meta).
// Mesmo padrão de Empresa.erpConexao: token gravado em texto (o backend
// precisa reenviá-lo a cada chamada pra API do Meta), por isso nunca é
// reexibido depois de salvo — só um "•••• salvo" na tela.
export interface MetaAdsConexao {
  contaAnuncioId: string; // ID da conta de anúncios (ex.: "act_1234567890")
  tokenAcesso?: string;
  // Só entram as campanhas cujo nome contém algum destes termos (separados por
  // vírgula; sem diferenciar maiúsculas/acentos). Serve quando a mesma conta de
  // anúncios atende mais de uma empresa. Vazio = todas as campanhas.
  filtroNome?: string;
  configuradoEm?: string;
  ultimaSincronizacao?: string;
}

// Conexão com a API oficial do Instagram (Fase 2 — busca automática das
// métricas ao encerrar uma live). Mesmo padrão de token em texto acima.
export interface InstagramConexao {
  contaInstagramId: string; // ID da conta comercial do Instagram (Business Account)
  tokenAcesso?: string;
  configuradoEm?: string;
}

// ===== Instagram (arrobas captados durante as lives) =====

export interface ArrobaLive {
  comentarios: number;
  primeiraVez: string; // ISO
  ultimaVez: string; // ISO
  ultimoTexto?: string;
}

/** Uma transmissão ao vivo do Instagram monitorada, com os @ de quem comentou. */
export interface InstagramLive {
  id: string; // id da transmissão no Instagram
  iniciadaEm: string; // ISO
  atualizadoEm: string; // ISO
  encerrada?: boolean;
  arrobas: Record<string, ArrobaLive>;
  mensagens?: MensagemLive[]; // comentários da live, em ordem de chegada
}

export interface MensagemLive {
  id: string;
  arroba: string;
  texto: string;
  quando: string; // ISO
}

// ===== Fluxa Chat (WhatsApp / Instagram Direct / Messenger) =====

export type CanalChat = 'whatsapp' | 'instagram' | 'facebook';

export interface TagChat {
  id: string;
  nome: string;
  cor: string; // hex
}

export interface ConversaChat {
  id: string; // `${canal}_${contato}`
  canal: CanalChat;
  contato: string; // telefone (só dígitos) ou id da conta no Instagram/Facebook
  nome: string;
  telefone?: string;
  ultimaMensagem: string;
  ultimaEm: string; // ISO
  ultimaDe: 'cliente' | 'equipe'; // sem resposta = a última foi do cliente
  naoLidas?: number;
  alertaEntrega?: boolean; // o robô detectou mensagem que pode não ter chegado ao cliente
  alertaMotivo?: string;
  alertaEm?: string;
  vendedorLogin?: string; // quem pegou o atendimento (sem valor = livre para todos)
  vendedorNome?: string;
  clienteId?: string; // cliente do CRM vinculado
  atendimentoEm?: string; // ISO — quando o vendedor pegou
  origem?: 'trafego' | 'instagram'; // veio da landing page (senão a origem é o próprio canal)
  contatoJid?: string; // id interno do WhatsApp (usado no envio)
  tags?: string[]; // ids das tags cadastradas (chatTags)
  nomeSugerido?: string; // nome que chegou pronto (agenda do celular ou perfil)
  salvo?: boolean; // a equipe confirmou o nome na agenda do Fluxa Chat
  primeiroContato?: boolean; // o cliente chamou pela primeira vez (conversa nova, iniciada por ele)
  teveResposta?: boolean; // a equipe (ou o celular) já respondeu: deixa de ser "novo contato"
  salvoNaAgenda?: boolean; // o nome veio da agenda do celular
}

export interface MensagemChat {
  id: string;
  de: 'cliente' | 'equipe';
  texto: string;
  em: string; // ISO
  autor?: string; // nome de quem da equipe enviou
  midiaTipo?: 'imagem' | 'video' | 'audio' | 'documento';
  midiaLink?: string; // arquivo completo no Google Drive
  midiaUrl?: string; // data URL (imagem ou miniatura do vídeo)
  midiaPartes?: number; // vídeo/áudio longo guardado em partes no banco
  midiaMime?: string;
  midiaNome?: string; // nome do arquivo (documentos)
  erroEnvio?: string; // o conector não conseguiu entregar ao cliente
  entrega?: 'enviada' | 'entregue' | 'lida' | 'sem_confirmacao' | 'reenviada_pelo_robo' | 'reenviada_entregue'; // acompanhamento do robô
}

export interface ConexaoChat {
  status: 'desconectado' | 'solicitado' | 'aguardando_qr' | 'conectado';
  qr?: string; // imagem (data URL) do QR Code
  codigoPareamento?: string; // código de 8 letras (conexão por número)
  erro?: string;
  telefone?: string;
  atualizadoEm?: string;
  // Estado de saúde publicado pelo robô do conector (conector/robo.js).
  saude?: {
    nivel: 'ok' | 'atencao' | 'problema';
    mensagem: string;
    verificadoEm?: string;
    recebidas24h?: number;
    enviadas24h?: number;
    quedas24h?: number;
    reconexoesRobo24h?: number;
    ultimaRecebida?: string | null;
    ultimaEnviada?: string | null;
    teste?: { ok?: boolean; em?: string; envio?: boolean; noCelular?: boolean; banco?: boolean } | null;
  };
}

// ===== Fluxa ERP: produtos e estoque =====
export interface Produto {
  id: string;
  sku: string;
  nome: string;
  categoria?: string;
  marca?: string;
  unidade?: string;
  preco: number;
  custo: number;
  estoque: number;
  estoqueMinimo: number;
  ativo: boolean;
  origem?: 'manual' | 'importado';
  criadoEm: string;
  atualizadoEm: string;
}

export interface MovimentoEstoque {
  id: string;
  produtoId: string;
  produtoNome: string;
  sku: string;
  tipo: 'entrada' | 'saida' | 'ajuste';
  quantidade: number; // variação (+ entra, - sai)
  saldoApos: number;
  motivo?: string;
  usuario?: string;
  criadoEm: string;
}

export type StatusPedido = 'orcamento' | 'aberto' | 'pago' | 'enviado' | 'entregue' | 'cancelado';
export interface ItemPedido { produtoId: string; sku: string; nome: string; quantidade: number; preco: number }
export interface Pedido {
  id: string;
  numero: number;
  clienteNome: string;
  clienteTelefone?: string;
  devolvidos?: Record<string, number>;
  clienteId?: string;
  operacao?: string;
  vendedor?: string;
  condicaoPagamento?: string;
  itens: ItemPedido[];
  desconto: number;
  frete: number;
  total: number;
  pagamento?: string;
  observacao?: string;
  status: StatusPedido;
  origem: 'manual' | 'api';
  criadoEm: string;
  atualizadoEm: string;
}

export interface Troca {
  id: string; numero: number; pedidoId: string; pedidoNumero: number; clienteNome: string;
  tipo: 'devolucao' | 'troca';
  devolvidos: ItemPedido[]; novos: ItemPedido[];
  valorDevolvido: number; valorNovo: number; diferenca: number; // diferença > 0: cliente paga; < 0: devolver ao cliente
  motivo?: string; criadoEm: string;
}
export interface ItemConsig { produtoId: string; sku: string; nome: string; enviada: number; vendida: number; devolvida: number; preco: number; custo: number }
export interface Consignacao {
  id: string; numero: number; tipo: 'cliente' | 'fornecedor'; parteNome: string; parteId?: string;
  itens: ItemConsig[]; status: 'aberta' | 'encerrada'; valorAcertado: number; criadoEm: string; atualizadoEm: string;
}
export interface ContaFin {
  id: string; tipo: 'receber' | 'pagar'; descricao: string; parteNome?: string; valor: number;
  vencimento: string; pago: boolean; pagoEm?: string; origem?: string; origemId?: string; criadoEm: string;
}
