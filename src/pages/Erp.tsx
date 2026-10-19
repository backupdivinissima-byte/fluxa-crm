import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirProdutos, ouvirMovimentos, salvarProduto, excluirProduto, movimentarEstoque, importarProdutos } from '../lib/erpData';
import { lerProdutosDaPlanilha, modeloCsv, type ResultadoLeitura } from '../lib/erpImportar';
import { formatarMoeda, parseValorBR } from '../lib/crmLogic';
import ErpPedidos from './ErpPedidos';
import ErpCadastros from './ErpCadastros';
import { ouvirCadastro, type RegistroCad } from '../lib/erpCadastros';
import { IconEstoque } from '../components/NavIcons';
import type { MovimentoEstoque, Produto } from '../types';

type Aba = 'produtos' | 'pedidos' | 'cadastros' | 'movimentos' | 'importar';
const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1';

const numero = (t: string) => { const n = parseValorBR(t); return Number.isNaN(n) ? 0 : n; };

export default function Erp() {
  const { empresa, papel, perfil } = useAuth();
  const empresaId = empresa?.id;
  const [aba, setAba] = useState<Aba>('produtos');
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [movimentos, setMovimentos] = useState<MovimentoEstoque[]>([]);
  const [busca, setBusca] = useState('');
  const [soBaixos, setSoBaixos] = useState(false);
  const [edicao, setEdicao] = useState<Partial<Produto> | null>(null);
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

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => (!q || p.nome.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.categoria ?? '').toLowerCase().includes(q)) && (!soBaixos || (p.ativo && p.estoque <= p.estoqueMinimo)));
  }, [produtos, busca, soBaixos]);

  if (papel !== 'admin') return <div className="p-6 text-sm text-ink-soft">Somente administradores acessam o Estoque.</div>;

  return (
    <div className="p-5 w-full max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1"><IconEstoque className="w-6 h-6" /><h1 className="text-xl font-extrabold text-ink">Produtos e estoque</h1></div>
      <p className="text-sm text-ink-soft mb-4">Cadastre produtos, controle entradas e saídas e veja o que está acabando.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card t="Produtos ativos" v={String(resumo.itens)} />
        <Card t="Unidades em estoque" v={resumo.unidades.toLocaleString('pt-BR')} />
        <Card t="Valor em estoque (custo)" v={formatarMoeda(resumo.valorCusto)} />
        <Card t="Estoque baixo" v={String(resumo.baixos)} alerta={resumo.baixos > 0} onClick={() => { setAba('produtos'); setSoBaixos(true); }} />
      </div>

      <div className="flex gap-1 mb-4 border-b border-line">
        {(['produtos', 'pedidos', 'cadastros', 'movimentos', 'importar'] as Aba[]).map((a) => (
          <button key={a} onClick={() => setAba(a)} className={`px-4 h-10 text-sm font-bold ${aba === a ? 'text-teal-500 border-b-2 border-teal-500' : 'text-ink-soft'}`}>
            {a === 'produtos' ? 'Produtos' : a === 'pedidos' ? 'Pedidos' : a === 'cadastros' ? 'Cadastros' : a === 'movimentos' ? 'Movimentações' : 'Importar (Bling / Olist)'}
          </button>
        ))}
      </div>
      {erro && <p className="text-sm text-red-600 mb-3">{erro}</p>}

      {aba === 'produtos' && (
        <>
          <div className="flex gap-2 flex-wrap mb-3">
            <input className={`${campo} max-w-xs`} placeholder="Buscar por nome, código ou categoria" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" checked={soBaixos} onChange={(e) => setSoBaixos(e.target.checked)} /> Só estoque baixo</label>
            <button onClick={() => setEdicao({ ativo: true, unidade: 'un', preco: 0, custo: 0, estoque: 0, estoqueMinimo: 0 })} className="ml-auto rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 h-10">+ Novo produto</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-ink-soft bg-surface"><tr>
                <th className="text-left p-3">Código</th><th className="text-left p-3">Produto</th><th className="text-left p-3">Categoria</th>
                <th className="text-right p-3">Preço</th><th className="text-right p-3">Custo</th><th className="text-right p-3">Estoque</th><th className="p-3" />
              </tr></thead>
              <tbody>
                {lista.map((p) => {
                  const baixo = p.ativo && p.estoque <= p.estoqueMinimo;
                  return (
                    <tr key={p.id} className={`border-t border-line ${p.ativo ? '' : 'opacity-50'}`}>
                      <td className="p-3 font-mono text-xs">{p.sku}</td>
                      <td className="p-3 font-semibold text-ink">{p.nome}</td>
                      <td className="p-3 text-ink-soft">{p.categoria ?? '—'}</td>
                      <td className="p-3 text-right">{formatarMoeda(p.preco)}</td>
                      <td className="p-3 text-right text-ink-soft">{formatarMoeda(p.custo)}</td>
                      <td className={`p-3 text-right font-bold ${baixo ? 'text-red-600' : ''}`}>{p.estoque} {p.unidade}{baixo && <span className="block text-[10px] font-bold uppercase">baixo (mín. {p.estoqueMinimo})</span>}</td>
                      <td className="p-3 whitespace-nowrap text-right">
                        <button className="text-xs font-bold text-teal-500 mr-2" onClick={() => setMov({ produto: p, tipo: 'entrada' })}>Entrada</button>
                        <button className="text-xs font-bold text-ink-soft mr-2" onClick={() => setMov({ produto: p, tipo: 'saida' })}>Saída</button>
                        <button className="text-xs font-bold text-ink-soft mr-2" onClick={() => setMov({ produto: p, tipo: 'ajuste' })}>Ajuste</button>
                        <button className="text-xs font-bold text-ink-soft" onClick={() => setEdicao(p)}>Editar</button>
                      </td>
                    </tr>
                  );
                })}
                {lista.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-ink-soft">{produtos.length === 0 ? 'Nenhum produto ainda. Cadastre o primeiro ou importe uma planilha.' : 'Nada encontrado.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === 'pedidos' && empresaId && <ErpPedidos empresaId={empresaId} produtos={produtos} />}

      {aba === 'cadastros' && empresaId && <ErpCadastros empresaId={empresaId} />}

      {aba === 'movimentos' && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-ink-soft bg-surface"><tr><th className="text-left p-3">Quando</th><th className="text-left p-3">Produto</th><th className="text-left p-3">Tipo</th><th className="text-right p-3">Qtd</th><th className="text-right p-3">Saldo</th><th className="text-left p-3">Motivo</th></tr></thead>
            <tbody>
              {movimentos.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="p-3 whitespace-nowrap">{new Date(m.criadoEm).toLocaleString('pt-BR')}</td>
                  <td className="p-3">{m.produtoNome} <span className="font-mono text-xs text-ink-soft">{m.sku}</span></td>
                  <td className="p-3 capitalize">{m.tipo === 'saida' ? 'saída' : m.tipo}</td>
                  <td className={`p-3 text-right font-bold ${m.quantidade < 0 ? 'text-red-600' : 'text-teal-500'}`}>{m.quantidade > 0 ? '+' : ''}{m.quantidade}</td>
                  <td className="p-3 text-right">{m.saldoApos}</td>
                  <td className="p-3 text-ink-soft">{m.motivo ?? '—'}{m.usuario ? ` · ${m.usuario}` : ''}</td>
                </tr>
              ))}
              {movimentos.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">Nenhuma movimentação ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'importar' && empresaId && <Importar empresaId={empresaId} />}

      {edicao && empresaId && <FormProduto empresaId={empresaId} dados={edicao} onFechar={() => setEdicao(null)} onSalvar={async (d, ex) => { try { await salvarProduto(empresaId, d, ex); setEdicao(null); setErro(''); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao salvar.'); } }} onExcluir={edicao.id ? async () => { if (confirm('Excluir este produto?')) { await excluirProduto(empresaId, edicao.id as string); setEdicao(null); } } : undefined} />}
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

function FormProduto({ empresaId, dados, onFechar, onSalvar, onExcluir }: { empresaId: string; dados: Partial<Produto>; onFechar: () => void; onSalvar: (d: Parameters<typeof salvarProduto>[1], ex?: Produto) => Promise<void>; onExcluir?: () => void }) {
  const existente = dados.id ? (dados as Produto) : undefined;
  const [sku, setSku] = useState(dados.sku ?? '');
  const [nome, setNome] = useState(dados.nome ?? '');
  const [categoria, setCategoria] = useState(dados.categoria ?? '');
  const [marca, setMarca] = useState(dados.marca ?? '');
  const [cats, setCats] = useState<RegistroCad[]>([]);
  const [marcas, setMarcas] = useState<RegistroCad[]>([]);
  useEffect(() => { const a = ouvirCadastro(empresaId, 'categoriasProduto', setCats); const b = ouvirCadastro(empresaId, 'marcasProduto', setMarcas); return () => { a(); b(); }; }, [empresaId]);
  const [unidade, setUnidade] = useState(dados.unidade ?? 'un');
  const [preco, setPreco] = useState(String(dados.preco ?? 0).replace('.', ','));
  const [custo, setCusto] = useState(String(dados.custo ?? 0).replace('.', ','));
  const [estoque, setEstoque] = useState('0');
  const [minimo, setMinimo] = useState(String(dados.estoqueMinimo ?? 0));
  const [ativo, setAtivo] = useState(dados.ativo ?? true);
  const ok = sku.trim() && nome.trim();
  return (
    <Modal titulo={existente ? 'Editar produto' : 'Novo produto'} onFechar={onFechar}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={rotulo}>Código (SKU)</label><input className={campo} value={sku} disabled={!!existente} onChange={(e) => setSku(e.target.value)} /></div>
        <div><label className={rotulo}>Unidade</label><input className={campo} value={unidade} onChange={(e) => setUnidade(e.target.value)} /></div>
        <div className="col-span-2"><label className={rotulo}>Nome</label><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} /></div>
        <div><label className={rotulo}>Categoria</label><input list="lista-categorias" className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value)} /><datalist id="lista-categorias">{cats.map((c) => <option key={c.id} value={String(c.nome)} />)}</datalist></div>
        <div><label className={rotulo}>Marca</label><input list="lista-marcas" className={campo} value={marca} onChange={(e) => setMarca(e.target.value)} /><datalist id="lista-marcas">{marcas.map((c) => <option key={c.id} value={String(c.nome)} />)}</datalist></div>
        <div><label className={rotulo}>Preço de venda</label><input className={campo} value={preco} onChange={(e) => setPreco(e.target.value)} /></div>
        <div><label className={rotulo}>Custo</label><input className={campo} value={custo} onChange={(e) => setCusto(e.target.value)} /></div>
        {!existente && <div><label className={rotulo}>Estoque inicial</label><input className={campo} value={estoque} onChange={(e) => setEstoque(e.target.value)} /></div>}
        <div><label className={rotulo}>Estoque mínimo</label><input className={campo} value={minimo} onChange={(e) => setMinimo(e.target.value)} /></div>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Produto ativo</label>
      </div>
      <div className="flex gap-2 mt-4">
        <button disabled={!ok} onClick={() => void onSalvar({ sku, nome, categoria, marca, unidade, preco: numero(preco), custo: numero(custo), estoque: numero(estoque), estoqueMinimo: numero(minimo), ativo }, existente)} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold h-10 disabled:opacity-40">Salvar</button>
        {onExcluir && <button onClick={onExcluir} className="rounded-xl border border-red-300 text-red-600 text-sm font-bold px-4">Excluir</button>}
        <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4">Cancelar</button>
      </div>
      {existente && <p className="text-xs text-ink-soft mt-3">Para mudar o estoque use Entrada, Saída ou Ajuste: assim fica no histórico.</p>}
    </Modal>
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

function Importar({ empresaId }: { empresaId: string }) {
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
    <div className="rounded-xl border border-line bg-white p-5 max-w-2xl">
      <h2 className="font-extrabold text-ink mb-1">Trazer produtos do Bling, Olist/Tiny ou planilha</h2>
      <p className="text-sm text-ink-soft mb-3">No Bling ou no Olist, exporte seus produtos (CSV ou Excel) e envie aqui. O Fluxa reconhece as colunas Código, Descrição, Preço, Preço de custo, Estoque e Categoria. Importar de novo o mesmo código atualiza o produto em vez de duplicar.</p>
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
