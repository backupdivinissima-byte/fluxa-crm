import { consultarCnpj } from '../lib/prospectData';
import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AuthShell from '../components/AuthShell';
import CampoSenha from '../components/CampoSenha';

/** Primeira etapa do cadastro: qual plataforma Fluxa a pessoa quer testar.
 * Fluxa CRM e Fluxa Marketing já estão disponíveis (mesma conta por baixo —
 * o módulo Marketing lê os dados do CRM da própria empresa pra cruzar
 * campanha/live com cliente, ver módulo "Marketing" dentro do painel) — os
 * demais levam pra um "quero ser avisado" por e-mail, mesmo padrão já usado
 * na seção "Produtos" da home. */
const PLATAFORMAS = [
  {
    id: 'crm',
    nome: 'Fluxa CRM',
    status: 'Disponível agora',
    statusCls: 'bg-teal-500/10 text-teal-600',
    desc: 'Funil de vendas, clientes, vendedores, metas e comissões.',
    disponivel: true,
  },
  {
    id: 'marketing',
    nome: 'Fluxa Marketing',
    status: 'Disponível agora',
    statusCls: 'bg-teal-500/10 text-teal-600',
    desc: 'Anúncios do Meta, calendário de lives e ROI/CAC, cruzado com o funil de vendas.',
    disponivel: true,
  },
  {
    id: 'chat',
    nome: 'Fluxa Chat',
    status: 'Disponível agora',
    statusCls: 'bg-teal-500/10 text-teal-600',
    desc: 'WhatsApp, Instagram Direct e Messenger em um só lugar, com tags, equipe e IA supervisora.',
    disponivel: true,
  },
  {
    id: 'erp',
    nome: 'Fluxa ERP',
    status: 'Disponível agora',
    statusCls: 'bg-teal-500/10 text-teal-600',
    desc: 'Produtos, estoque, pedidos, trocas, consignação e financeiro. Funciona sozinho e se liga aos outros por API.',
    disponivel: true,
  },
  {
    id: 'prospect',
    nome: 'Fluxa Prospect',
    status: 'Disponível agora',
    statusCls: 'bg-teal-500/10 text-teal-600',
    desc: 'Encontre lojas e clientes em potencial, veja a nota de cada um e organize os leads em colunas.',
    disponivel: true,
  },
  {
    id: 'live',
    nome: 'Fluxa Live',
    status: 'Em breve',
    statusCls: 'bg-slate-100 text-ink-soft',
    desc: 'Venda ao vivo em lives e redes sociais, tudo já organizado no Fluxa.',
    disponivel: false,
  },
] as const;

const SEGMENTOS = [
  'Varejo / loja física',
  'E-commerce / venda online',
  'Moda, joias e acessórios',
  'Alimentação e bebidas',
  'Serviços',
  'Indústria e fabricação',
  'Distribuição e atacado',
  'Saúde e beleza',
  'Tecnologia',
  'Outro',
];

function formatarCnpj(valor: string) {
  const digitos = valor.replace(/\D/g, '').slice(0, 14);
  return digitos
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function formatarCpf(valor: string) {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  return digitos
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

function formatarWhatsapp(valor: string) {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 10) {
    return digitos.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  }
  return digitos.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

/** Tela de cadastro/"Teste grátis" — mesmo conjunto de informações do
 * formulário de cadastro do Bling (razão social, e-mail, WhatsApp,
 * CNPJ/CPF, segmento de trabalho e atividade principal), adaptado ao
 * Fluxa CRM: sem login social (ainda não integrado) e sem cupom/código de
 * parceiro (não existe programa de afiliados aqui). Toda entrada "Teste
 * grátis" do site (menu, hero, cards de planos, CTA final) leva pra cá. */
export default function Cadastrar() {
  const { cadastrar } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Quem chega pelo CTA de um produto específico (ex.: card "Fluxa CRM" ou
  // "Fluxa Marketing") já disse qual plataforma quer — pula direto pro
  // formulário. Só quem entra pelo "Teste grátis" genérico (menu, hero,
  // planos) vê a etapa de escolha. null = ainda escolhendo a plataforma
  // (etapa 1); só Fluxa CRM e Fluxa Marketing têm formulário completo hoje
  // (mesma conta por baixo), os outros abrem "quero ser avisado".
  const plataformaUrl = params.get('plataforma');
  const [plataforma, setPlataforma] = useState<'crm' | 'marketing' | 'chat' | 'erp' | 'prospect' | null>(
    plataformaUrl === 'crm' || plataformaUrl === 'marketing' || plataformaUrl === 'chat' || plataformaUrl === 'erp' || plataformaUrl === 'prospect' ? plataformaUrl : null
  );
  const [nomeEmpresa, setNomeEmpresa] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<'cnpj' | 'cpf'>('cnpj');
  const [documento, setDocumento] = useState('');
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [avisoCnpj, setAvisoCnpj] = useState<{ ok: boolean; texto: string } | null>(null);
  const [segmento, setSegmento] = useState('');
  const [atividadePrincipal, setAtividadePrincipal] = useState('');
  const [sobreEmpresa, setSobreEmpresa] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [aceitaTermos, setAceitaTermos] = useState(false);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function buscarCnpj() {
    setAvisoCnpj(null);
    setBuscandoCnpj(true);
    try {
      const r = await consultarCnpj(documento);
      const nome = r.fantasia || r.razao;
      if (nome && !nomeEmpresa.trim()) setNomeEmpresa(nome);
      const tel = (r.telefone ?? '').replace(/\D/g, '');
      if (tel.length >= 10 && !whatsapp.trim()) setWhatsapp(formatarWhatsapp(tel));
      if (r.cnae && !atividadePrincipal.trim()) setAtividadePrincipal(r.cnae);
      setAvisoCnpj({ ok: true, texto: `Encontrado: ${r.razao ?? nome}${r.situacao ? ' · ' + r.situacao : ''}${r.municipio ? ' · ' + r.municipio + '/' + (r.uf ?? '') : ''}. Confira os campos abaixo.` });
    } catch (e) {
      setAvisoCnpj({ ok: false, texto: e instanceof Error ? e.message : 'Não consegui consultar agora.' });
    } finally {
      setBuscandoCnpj(false);
    }
  }

  function trocarTipoDocumento(tipo: 'cnpj' | 'cpf') {
    setTipoDocumento(tipo);
    setDocumento(''); // máscaras diferentes — evita ficar com formatação errada
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (senha !== confirmarSenha) {
      setErro('As senhas não coincidem. Confira e tente de novo.');
      return;
    }
    if (sobreEmpresa.trim().length < 40) {
      setErro('Conte um pouco mais sobre a sua empresa (o que faz, o que vende e com quem atua) — pelo menos uma ou duas frases.');
      return;
    }
    if (!aceitaTermos) {
      setErro('Você precisa aceitar os termos e políticas de serviço pra continuar.');
      return;
    }
    setCarregando(true);
    try {
      await cadastrar({
        nome,
        email,
        senha,
        nomeEmpresa,
        whatsapp,
        segmento,
        atividadePrincipal,
        sobreEmpresa,
        produto: plataforma ?? 'crm',
        ...(documento ? { documento, documentoTipo: tipoDocumento } : {}),
      });
      navigate(plataforma === 'prospect' ? '/prospect' : plataforma === 'erp' ? '/erp' : plataforma === 'marketing' ? '/marketing' : plataforma === 'chat' ? '/chat' : '/dashboard');
    } catch (err) {
      console.error('Erro ao cadastrar empresa:', err);
      const codigo = (err as { code?: string })?.code;
      if (codigo === 'fluxa/senha-conta-existente') {
        setErro('Esse e-mail já tem uma conta e a senha digitada não confere com a dela (' + ((err as { detalhe?: string }).detalhe || 'senha incorreta') + '). Digite a senha com que você entra hoje.');
      } else if (codigo === 'fluxa/sem-empresa') {
        setErro('Esse e-mail já existe, mas sem empresa vinculada. Fale com o suporte.');
      } else if (codigo === 'auth/invalid-email') {
        setErro('E-mail inválido. Confira e tente de novo.');
      } else if (codigo === 'auth/weak-password') {
        setErro('Senha muito fraca — use pelo menos 6 caracteres.');
      } else if (codigo === 'auth/network-request-failed') {
        setErro('Falha de conexão. Verifique sua internet e tente de novo.');
      } else if (codigo === 'auth/operation-not-allowed') {
        setErro('Cadastro por e-mail/senha está desativado nas configurações do Firebase. Fale com o suporte.');
      } else {
        setErro(
          `Não foi possível criar a empresa. Verifique os dados e tente novamente.${
            codigo ? ` (código: ${codigo})` : ''
          }`
        );
      }
    } finally {
      setCarregando(false);
    }
  }

  // Etapa 1: qual plataforma Fluxa a pessoa quer testar.
  if (plataforma === null) {
    return (
      <AuthShell
        titulo="Qual plataforma deseja testar?"
        subtitulo="Escolha o produto Fluxa que você quer conhecer."
        rodape={
          <>
            Já tem uma empresa cadastrada?{' '}
            <Link to={plataforma ? `/login?plataforma=${plataforma}` : '/login'} className="font-bold text-blue-600">
              Entrar
            </Link>
          </>
        }
      >
        <div className="space-y-3">
          {PLATAFORMAS.map((p) =>
            p.disponivel ? (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlataforma(p.id as 'crm' | 'marketing' | 'chat' | 'erp' | 'prospect')}
                className="w-full flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 text-left hover:border-teal-500 hover:bg-teal-500/5 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-extrabold text-ink">{p.nome}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${p.statusCls}`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <p className="text-xs text-ink-soft mt-0.5">{p.desc}</p>
                </div>
                <span aria-hidden="true" className="text-ink-soft shrink-0">
                  →
                </span>
              </button>
            ) : (
              <a
                key={p.id}
                href={`mailto:josycampos.comercial@gmail.com?subject=${encodeURIComponent(
                  `Quero ser avisado sobre o ${p.nome}`
                )}`}
                className="w-full flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 text-left hover:bg-surface transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-extrabold text-ink">{p.nome}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${p.statusCls}`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <p className="text-xs text-ink-soft mt-0.5">{p.desc}</p>
                </div>
                <span className="text-xs font-bold text-ink-soft shrink-0">Quero ser avisado</span>
              </a>
            )
          )}
        </div>
      </AuthShell>
    );
  }

  // Título/subtítulo da etapa 2 mudam conforme o card de origem — mas é o
  // mesmo formulário e a mesma conta pros dois, só o rótulo muda (ver
  // DadosCadastro.produto em AuthContext.tsx).
  const nomePlataforma = PLATAFORMAS.find((p) => p.id === plataforma)?.nome ?? 'Fluxa CRM';
  const subtituloPlataforma =
    plataforma === 'marketing'
      ? 'Comece seu teste grátis: anúncios, lives e ROI/CAC, já cruzados com o funil de vendas da sua empresa.'
      : plataforma === 'prospect'
        ? 'Comece seu teste grátis: encontre novos clientes em potencial, com nota de qualificação e funil de leads.'
      : plataforma === 'erp'
        ? 'Comece seu teste grátis: produtos, estoque, pedidos e financeiro da sua empresa, de forma simples.'
      : plataforma === 'chat'
        ? 'Comece seu teste grátis: todo o atendimento da sua empresa (WhatsApp, Instagram e Messenger) em um só lugar.'
        : 'Comece seu teste grátis e organize o funil de vendas da sua empresa.';

  return (
    <AuthShell
      titulo={`Crie sua conta no ${nomePlataforma}`}
      subtitulo={subtituloPlataforma}
      rodape={
        <>
          Já tem uma empresa cadastrada?{' '}
          <Link to={plataforma ? `/login?plataforma=${plataforma}` : '/login'} className="font-bold text-blue-600">
            Entrar
          </Link>
        </>
      }
    >
      <button
        type="button"
        onClick={() => setPlataforma(null)}
        className="flex items-center gap-1.5 text-xs font-bold text-ink-soft hover:text-ink transition-colors mb-4"
      >
        <span aria-hidden="true">←</span> Escolher outra plataforma
      </button>
      {plataforma === 'marketing' && (
        <p className="text-xs text-ink-soft bg-surface rounded-xl p-3 mb-4">
          O Fluxa Marketing roda dentro da mesma conta do Fluxa CRM — sua empresa ganha acesso aos dois (CRM e
          Marketing) com este único cadastro.
        </p>
      )}
      {plataforma === 'erp' && (
        <p className="text-xs text-ink-soft bg-surface rounded-xl p-3 mb-4">
          Já tem conta com esse e-mail? Use o mesmo e-mail e a senha atual: o ERP é adicionado à sua empresa.{' '}
          O Fluxa ERP funciona sozinho, em uma conta própria. Se depois você contratar o CRM, Chat ou Marketing, a
          ligação entre eles é feita por API, sem misturar os dados.
        </p>
      )}
      {plataforma === 'prospect' && (
        <p className="text-xs text-ink-soft bg-surface rounded-xl p-3 mb-4">
          O Fluxa Prospect funciona sozinho, em uma conta própria. Já tem conta com esse e-mail? Use o mesmo e-mail e a
          senha atual: o Prospect é adicionado à sua empresa. Se depois você contratar o CRM ou o Chat, dá para ligar os leads ao funil e ao atendimento.
        </p>
      )}
      {plataforma === 'chat' && (
        <p className="text-xs text-ink-soft bg-surface rounded-xl p-3 mb-4">
          O Fluxa Chat funciona sozinho, com a sua equipe atendendo pelo WhatsApp, Instagram e Messenger. Se depois
          você contratar o CRM ou o Marketing, dá para vincular tudo no mesmo lugar.
        </p>
      )}
      <form onSubmit={onSubmit} className="bg-white border border-line rounded-2xl p-6 space-y-4">
        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Razão social
          </label>
          <input
            required
            placeholder="Ex: Empresa XYZ"
            value={nomeEmpresa}
            onChange={(e) => setNomeEmpresa(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">Seu nome</label>
          <input
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            E-mail de conta <span className="normal-case font-semibold text-ink-soft/70">(login de administrador)</span>
          </label>
          <input
            type="email"
            required
            placeholder="seuemail@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Nº de WhatsApp
          </label>
          <input
            required
            placeholder="(00) 00000-0000"
            inputMode="numeric"
            value={whatsapp}
            onChange={(e) => setWhatsapp(formatarWhatsapp(e.target.value))}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            CNPJ / CPF <span className="normal-case font-semibold text-ink-soft/70">(opcional)</span>
          </label>
          <div className="flex gap-2">
            <div className="inline-flex rounded-xl border border-line overflow-hidden text-sm font-bold shrink-0">
              <button
                type="button"
                onClick={() => trocarTipoDocumento('cnpj')}
                className={`px-3.5 py-2.5 transition-colors ${
                  tipoDocumento === 'cnpj' ? 'bg-ink text-white' : 'text-ink-soft hover:bg-surface'
                }`}
              >
                CNPJ
              </button>
              <button
                type="button"
                onClick={() => trocarTipoDocumento('cpf')}
                className={`px-3.5 py-2.5 border-l border-line transition-colors ${
                  tipoDocumento === 'cpf' ? 'bg-ink text-white' : 'text-ink-soft hover:bg-surface'
                }`}
              >
                CPF
              </button>
            </div>
            <input
              placeholder={tipoDocumento === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'}
              inputMode="numeric"
              value={documento}
              onChange={(e) =>
                setDocumento(tipoDocumento === 'cnpj' ? formatarCnpj(e.target.value) : formatarCpf(e.target.value))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tipoDocumento === 'cnpj') {
                  e.preventDefault();
                  void buscarCnpj();
                }
              }}
              className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
            />
            {tipoDocumento === 'cnpj' && (
              <button
                type="button"
                onClick={() => void buscarCnpj()}
                disabled={buscandoCnpj || documento.replace(/\D/g, '').length !== 14}
                title="Buscar os dados da empresa pelo CNPJ"
                aria-label="Buscar dados pelo CNPJ"
                className="shrink-0 w-11 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white flex items-center justify-center disabled:opacity-40"
              >
                {buscandoCnpj ? (
                  <span className="text-xs font-bold">…</span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path d="M15.5 15.5L21 21" />
                  </svg>
                )}
              </button>
            )}
          </div>
          {avisoCnpj && <p className={`text-[11px] mt-1.5 ${avisoCnpj.ok ? 'text-emerald-700' : 'text-red-600'}`}>{avisoCnpj.texto}</p>}
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Qual seu segmento de trabalho?
          </label>
          <select
            required
            value={segmento}
            onChange={(e) => setSegmento(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          >
            <option value="">Selecione uma opção</option>
            {SEGMENTOS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Qual é a atividade principal da sua empresa?
          </label>
          <input
            required
            placeholder="Ex: Loja de semijoias"
            value={atividadePrincipal}
            onChange={(e) => setAtividadePrincipal(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">
            Conte um resumo sobre a sua empresa
          </label>
          <textarea
            required
            rows={4}
            minLength={40}
            maxLength={1200}
            placeholder="Ex: Somos a Divinissima, uma loja de semijoias folheadas que vende no atacado e no varejo, por WhatsApp e Instagram, para lojistas e revendedoras de todo o Brasil."
            value={sobreEmpresa}
            onChange={(e) => setSobreEmpresa(e.target.value)}
            className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
          <p className="text-[11px] text-ink-soft mt-1">O que a empresa faz, o que vende e com quem atua. O robô de atendimento usa isso para saber quem você é.</p>
        </div>

        <CampoSenha
          label="Digite uma senha"
          value={senha}
          onChange={setSenha}
          required
          minLength={6}
          autoComplete="new-password"
        />
        <CampoSenha
          label="Confirme sua senha"
          value={confirmarSenha}
          onChange={setConfirmarSenha}
          required
          minLength={6}
          autoComplete="new-password"
        />

        <label className="flex items-start gap-2.5 text-xs text-ink-soft cursor-pointer select-none">
          <input
            type="checkbox"
            checked={aceitaTermos}
            onChange={(e) => setAceitaTermos(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0"
          />
          Declaro ter lido e aceitado os <span className="font-bold text-ink">termos e políticas de serviço</span>.
        </label>

        {erro && <p className="text-xs text-red-500">{erro}</p>}
        <button
          type="submit"
          disabled={carregando}
          className="w-full rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold py-2.5 hover:opacity-90 disabled:opacity-60"
        >
          {carregando ? 'Criando...' : 'Criar empresa'}
        </button>
      </form>
    </AuthShell>
  );
}
