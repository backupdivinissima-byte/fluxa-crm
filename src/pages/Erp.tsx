import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ouvirProdutos, ouvirMovimentos, salvarProduto, excluirProduto, movimentarEstoque, importarProdutos } from '../lib/erpData';
import { lerProdutosDaPlanilha, modeloCsv, type ResultadoLeitura } from '../lib/erpImportar';
import { formatarMoeda, parseValorBR } from '../lib/crmLogic';
import ErpPedidos from './ErpPedidos';
import ErpInicio from './ErpInicio';
import ErpFinanceiro from './ErpFinanceiro';
import ErpConsignacao from './ErpConsignacao';
import { ListaTrocas } from './ErpTrocas';
import ErpCadastros from './ErpCadastros';
import ErpApi from './ErpApi';
import ErpProdutos from './ErpProdutos';
import ErpAuditoria from './ErpAuditoria';
import { ouvirCadastro, type RegistroCad } from '../lib/erpCadastros';
import { IconEstoque } from '../components/NavIcons';
import type { MovimentoEstoque, Produto } from '../types';

type Aba = 'inicio' | 'vendas' | 'estoque' | 'financeiro' | 'cadastros' | 'api';
const ROTA_ABA: Record<string, Aba> = { inicio: 'inicio', vendas: 'vendas', estoque: 'estoque', financeiro: 'financeiro', cadastros: 'cadastros', integracoes: 'api' };
const SUBS: Partial<Record<Aba, { id: string; nome: string }[]>> = {
  vendas: [{ id: 'pedidos', nome: 'Pedidos e orçamentos' }, { id: 'trocas', nome: 'Trocas e devoluções' }, { id: 'consignacao', nome: 'Consignação' }],
  estoque: [{ id: 'produtos', nome: 'Produtos' }, { id: 'auditoria', nome: 'Auditoria' }],
};
const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1';

const numero = (t: string) => { const n = parseValorBR(t); return Number.isNaN(n) ? 0 : n; };

export default function Erp() {
  const { empresa, papel, perfil } = useAuth();
  const empresaId = empresa?.id;
  const { aba: abaUrl } = useParams();
  const navigate = useNavigate();
  const aba: Aba = ROTA_ABA[abaUrl ?? ''] ?? 'inicio';
  const setAba = (a: Aba) => navigate(`/erp/${a === 'api' ? 'integracoes' : a}`);
  const [params] = useSearchParams();
  const [sub, setSub] = useState('');
  useEffect(() => { setSub(aba === 'estoque' ? (params.get('v') ?? '') : ''); }, [aba, params]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [movimentos, setMovimentos] = useState<MovimentoEstoque[]>([]);
  const [soBaixos, setSoBaixos] = useState(false);
  const [gerarVar, setGerarVar] = useState(false);
  const [mov, setMov] = useState<{ produto: Produto; tipo: MovimentoEstoque['tipo'] } | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!empresaId) return;
    const a = ouvirProdutos(empresaId, setProdutos);
    const b = ouvirMovimentos(empresaId, setMovimentos);
    return () => { a(); b(); };
  }, [empresaId]);

  const resumo = useMemo(() => {
    const ativos = produtos.filter((p) => p.ativo);
    return {
      itens: ativos.length,
      unidades: ativos.reduce((s, p) => s + (p.estoque || 0), 0),
      valorCusto: ativos.reduce((s, p) => s + (p.estoque || 0) * (p.custo || 0), 0),
      valorVenda: ativos.reduce((s, p) => s + (p.estoque || 0) * (p.preco || 0), 0),
      baixos: ativos.filter((p) => p.estoque <= p.estoqueMinimo).length,
    };
  }, [produtos]);


  const vista = SUBS[aba] ? (sub || SUBS[aba]?.[0].id) : aba;

  if (papel !== 'admin') return <div className="p-6 text-sm text-ink-soft">Somente administradores acessam o Estoque.</div>;

  return (
    <div className="p-5 w-full">
      <div className="flex items-center gap-2 mb-1"><IconEstoque className="w-6 h-6" /><h1 className="text-xl font-extrabold text-ink">Fluxa ERP</h1></div>
      <p className="text-sm text-ink-soft mb-4">Vendas, estoque, financeiro e cadastros num só lugar.</p>

      <div>
      <section className="min-w-0">
      {aba === 'estoque' && <h2 className="text-lg font-extrabold text-ink mb-3">{vista === 'auditoria' ? 'Auditoria' : 'Produtos'}</h2>}

      {aba === 'estoque' && vista !== 'auditoria' && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card t="Produtos ativos" v={String(resumo.itens)} />
        <Card t="Unidades em estoque" v={resumo.unidades.toLocaleString('pt-BR')} />
        <Card t="Valor em estoque (custo)" v={formatarMoeda(resumo.valorCusto)} />
        <Card t="Estoque baixo" v={String(resumo.baixos)} alerta={resumo.baixos > 0} onClick={() => { setSub('produtos'); setSoBaixos(true); }} />
      </div>}

      {SUBS[aba] && aba !== 'estoque' && (
        <div className="flex gap-1 mb-4 flex-wrap">
          {SUBS[aba]?.map((x) => (
            <button key={x.id} onClick={() => setSub(x.id)} className={`px-3 h-8 rounded-full text-xs font-bold ${(sub || SUBS[aba]?.[0].id) === x.id ? 'bg-teal-500 text-white' : 'bg-slate-100 text-ink-soft'}`}>{x.nome}</button>
          ))}
        </div>
      )}
      {erro && <p className="text-sm text-red-600 mb-3">{erro}</p>}

      {vista === 'produtos' && empresaId && (
        <ErpProdutos
          empresaId={empresaId}
          produtos={produtos}
          alertaBaixo={soBaixos}
          setAlertaBaixo={setSoBaixos}
          onVariacoes={() => setGerarVar(true)}
          onImportar={() => setSub('importar')}
          onMovimentar={(produto, tipo) => setMov({ produto, tipo })}
          onSalvar={async (d, ex) => { setErro(''); await salvarProduto(empresaId, d, ex); }}
          onExcluir={async (p) => { await excluirProduto(empresaId, p.id); }}
        />
      )}

      {aba === 'inicio' && empresaId && <ErpInicio empresaId={empresaId} produtos={produtos} ir={(d) => { setAba(d.aba); setSub(d.sub ?? ''); }} />}
      {vista === 'pedidos' && empresaId && <ErpPedidos empresaId={empresaId} produtos={produtos} />}
      {vista === 'trocas' && empresaId && <ListaTrocas empresaId={empresaId} />}
      {vista === 'consignacao' && empresaId && <ErpConsignacao empresaId={empresaId} produtos={produtos} />}
      {aba === 'financeiro' && empresaId && <ErpFinanceiro empresaId={empresaId} />}

      {aba === 'cadastros' && empresaId && <ErpCadastros empresaId={empresaId} />}
      {aba === 'api' && empresaId && <ErpApi empresaId={empresaId} />}

      {vista === 'auditoria' && empresaId && <ErpAuditoria empresaId={empresaId} produtos={produtos} movimentos={movimentos} usuario={perfil?.nome} />}

      {vista === 'importar' && empresaId && <Importar empresaId={empresaId} onVoltar={() => setSub('produtos')} />}

      </section>
      </div>

      {gerarVar && empresaId && <FormVariacoes empresaId={empresaId} onFechar={() => setGerarVar(false)} />}
      {mov && empresaId && <FormMov dados={mov} onFechar={() => setMov(null)} onConfirmar={async (valor, motivo) => { try { await movimentarEstoque(empresaId, mov.produto, mov.tipo, valor, motivo, perfil?.nome); setMov(null); setErro(''); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro.'); setMov(null); } }} />}
    </div>
  );
}

function Card({ t, v, alerta, onClick }: { t: string; v: string; alerta?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`rounded-xl border bg-white p-4 ${alerta ? 'border-red-300 cursor-pointer' : 'border-line'}`}>
      <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{t}</div>
      <div className={`text-xl font-extrabold ${alerta ? 'text-red-600' : 'text-ink'}`}>{v}</div>
    </div>
  );
}

function Modal({ titulo, children, onFechar }: { titulo: string; children: React.ReactNode; onFechar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-ink mb-3">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

function FormMov({ dados, onFechar, onConfirmar }: { dados: { produto: Produto; tipo: MovimentoEstoque['tipo'] }; onFechar: () => void; onConfirmar: (v: number, motivo: string) => Promise<void> }) {
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const t = dados.tipo;
  return (
    <Modal titulo={`${t === 'entrada' ? 'Entrada' : t === 'saida' ? 'Saída' : 'Ajuste'} — ${dados.produto.nome}`} onFechar={onFechar}>
      <p className="text-sm text-ink-soft mb-3">Saldo atual: <b>{dados.produto.estoque} {dados.produto.unidade}</b></p>
      <label className={rotulo}>{t === 'ajuste' ? 'Novo saldo (contagem)' : 'Quantidade'}</label>
      <input autoFocus className={campo} value={valor} onChange={(e) => setValor(e.target.value)} />
      <label className={`${rotulo} mt-3`}>Motivo (opcional)</label>
      <input className={campo} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={t === 'entrada' ? 'Compra, devolução…' : t === 'saida' ? 'Venda, perda…' : 'Inventário…'} />
      <div className="flex gap-2 mt-4">
        <button disabled={!valor.trim() || numero(valor) < 0 || (t !== 'ajuste' && numero(valor) === 0)} onClick={() => void onConfirmar(numero(valor), motivo)} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold h-10 disabled:opacity-40">Confirmar</button>
        <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4">Cancelar</button>
      </div>
    </Modal>
  );
}

function Importar({ empresaId, onVoltar }: { empresaId: string; onVoltar: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [leitura, setLeitura] = useState<ResultadoLeitura | null>(null);
  const [msg, setMsg] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function aoEscolher(f?: File) {
    if (!f) return;
    setMsg(''); setLeitura(null);
    try { setLeitura(await lerProdutosDaPlanilha(f)); } catch (e) { setMsg(e instanceof Error ? e.message : 'Não consegui ler o arquivo.'); }
  }
  function baixarModelo() {
    const url = URL.createObjectURL(new Blob(['﻿' + modeloCsv()], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'modelo-produtos-fluxa.csv'; a.click(); URL.revokeObjectURL(url);
  }
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <button onClick={onVoltar} className="text-sm font-bold text-ink-soft mb-2">← Voltar para Produtos</button>
      <h2 className="font-extrabold text-ink mb-1">Importar produtos por planilha</h2>
      <p className="text-sm text-ink-soft mb-3">Envie sua planilha de produtos (CSV ou Excel). O Fluxa reconhece as colunas Código, Descrição, Preço, Preço de custo, Estoque e Categoria. Importar de novo o mesmo código atualiza o produto em vez de duplicar.</p>
      <div className="flex gap-2 flex-wrap">
        <input ref={ref} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => void aoEscolher(e.target.files?.[0])} />
        <button onClick={() => ref.current?.click()} className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 h-10">Escolher arquivo</button>
        <button onClick={baixarModelo} className="rounded-xl border border-line text-sm font-bold px-4 h-10">Baixar modelo</button>
      </div>
      {msg && <p className="text-sm text-red-600 mt-3">{msg}</p>}
      {leitura && leitura.semColunas.length > 0 && <p className="text-sm text-red-600 mt-3">Não achei a coluna: {leitura.semColunas.join(', ')}. Confira o cabeçalho do arquivo.</p>}
      {leitura && leitura.produtos.length > 0 && (
        <div className="mt-4">
          <p className="text-sm text-ink"><b>{leitura.produtos.length}</b> produtos prontos para importar{leitura.ignoradas ? ` (${leitura.ignoradas} linhas sem código ou nome foram ignoradas)` : ''}. Exemplo: {leitura.produtos[0].sku} — {leitura.produtos[0].nome}, estoque {leitura.produtos[0].estoque}.</p>
          <button disabled={enviando} onClick={async () => { setEnviando(true); try { await importarProdutos(empresaId, leitura.produtos); setMsg(`${leitura.produtos.length} produtos importados.`); setLeitura(null); } catch (e) { setMsg(e instanceof Error ? e.message : 'Erro ao importar.'); } setEnviando(false); }} className="mt-3 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 h-10 disabled:opacity-40">{enviando ? 'Importando…' : 'Importar agora'}</button>
        </div>
      )}
      {!leitura && msg.includes('importados') && <p className="text-sm text-teal-600 mt-3">{msg}</p>}
    </div>
  );
}

/** Cria de uma vez um produto em várias versões (tamanho, cor, banho…). Cada versão é um produto com estoque próprio. */
function FormVariacoes({ empresaId, onFechar }: { empresaId: string; onFechar: () => void }) {
  const [defs, setDefs] = useState<RegistroCad[]>([]);
  const [defId, setDefId] = useState('');
  const [valoresTxt, setValoresTxt] = useState('');
  const [sku, setSku] = useState('');
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('0');
  const [custo, setCusto] = useState('0');
  const [minimo, setMinimo] = useState('0');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => ouvirCadastro(empresaId, 'variacoesProduto', setDefs), [empresaId]);
  const valores = valoresTxt.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <Modal titulo="Produto com variações" onFechar={onFechar}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={rotulo}>Código base</label><input className={campo} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ANL-001" /></div>
        <div><label className={rotulo}>Nome</label><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Anel Solitário" /></div>
        <div><label className={rotulo}>Preço de venda</label><input className={campo} value={preco} onChange={(e) => setPreco(e.target.value)} /></div>
        <div><label className={rotulo}>Custo</label><input className={campo} value={custo} onChange={(e) => setCusto(e.target.value)} /></div>
        {defs.length > 0 && <div className="col-span-2"><label className={rotulo}>Usar variação cadastrada</label>
          <select className={campo} value={defId} onChange={(e) => { setDefId(e.target.value); const d = defs.find((x) => x.id === e.target.value); if (d) setValoresTxt(String(d.valores ?? '')); }}><option value="">—</option>{defs.map((d) => <option key={d.id} value={d.id}>{String(d.nome)}: {String(d.valores)}</option>)}</select></div>}
        <div className="col-span-2"><label className={rotulo}>Versões (separe por vírgula)</label><input className={campo} value={valoresTxt} onChange={(e) => setValoresTxt(e.target.value)} placeholder="14, 16, 18" /></div>
        <div><label className={rotulo}>Estoque mínimo de cada</label><input className={campo} value={minimo} onChange={(e) => setMinimo(e.target.value)} /></div>
      </div>
      {valores.length > 0 && sku.trim() && <p className="text-xs text-ink-soft mt-3">Vai criar: {valores.map((v) => `${sku.trim()}-${v}`).join(', ')}. O estoque de cada um começa em 0; depois use Entrada.</p>}
      {erro && <p className="text-sm text-red-600 mt-2">{erro}</p>}
      <div className="flex gap-2 mt-4">
        <button disabled={salvando || !sku.trim() || !nome.trim() || valores.length === 0} onClick={async () => {
          setSalvando(true);
          try { for (const v of valores) await salvarProduto(empresaId, { sku: `${sku.trim()}-${v}`, nome: `${nome.trim()} — ${v}`, unidade: 'un', preco: numero(preco), custo: numero(custo), estoqueMinimo: numero(minimo), ativo: true, categoria: undefined, marca: undefined }); onFechar(); }
          catch (e) { setErro(e instanceof Error ? e.message : 'Erro.'); }
          setSalvando(false);
        }} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold h-10 disabled:opacity-40">Criar {valores.length || ''} versões</button>
        <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4">Cancelar</button>
      </div>
    </Modal>
  );
}
