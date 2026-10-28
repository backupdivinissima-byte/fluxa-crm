import { useEffect, useMemo, useRef, useState } from 'react';
import { ouvirCadastro, type RegistroCad } from '../lib/erpCadastros';
import { formatarMoeda, parseValorBR } from '../lib/crmLogic';
import type { Produto } from '../types';
import type { DadosProduto } from '../lib/erpData';

const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1';
const num = (t: string) => { const n = parseValorBR(t); return Number.isNaN(n) ? 0 : n; };
const txt = (n?: number) => (n === undefined || n === null ? '' : String(n).replace('.', ','));

/** Reduz a foto escolhida no computador (até 800 px, JPEG) e devolve como data URL para guardar no próprio produto. */
function reduzirImagem(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const esc = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * esc);
      c.height = Math.round(img.height * esc);
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir essa imagem.')); };
    img.src = url;
  });
}

const ABAS = ['Dados gerais', 'Características', 'Estoque', 'Tributação', 'Fornecedor', 'Imagem', 'Observações'] as const;
type Aba = (typeof ABAS)[number];

interface Props {
  empresaId: string;
  produtos: Produto[];
  onSalvar: (d: DadosProduto, existente?: Produto) => Promise<void>;
  onExcluir: (p: Produto) => Promise<void>;
  onMovimentar: (p: Produto, tipo: 'entrada' | 'saida' | 'ajuste') => void;
  onVariacoes: () => void;
  alertaBaixo: boolean;
  setAlertaBaixo: (v: boolean) => void;
}

/** Lista de produtos e janela de cadastro com abas (dados gerais, características, estoque, tributação, fornecedor, imagem). */
export default function ErpProdutos({ empresaId, produtos, onSalvar, onExcluir, onMovimentar, onVariacoes, alertaBaixo, setAlertaBaixo }: Props) {
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<'todos' | 'ativo' | 'inativo'>('ativo');
  const [categoria, setCategoria] = useState('');
  const [estoqueFiltro, setEstoqueFiltro] = useState<'todos' | 'baixo' | 'zerado'>('todos');
  const [edicao, setEdicao] = useState<Partial<Produto> | null>(null);

  const categorias = useMemo(() => Array.from(new Set(produtos.map((p) => p.categoria).filter(Boolean) as string[])).sort(), [produtos]);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (q && !(p.nome.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.gtin ?? '').includes(q) || (p.marca ?? '').toLowerCase().includes(q))) return false;
      if (situacao === 'ativo' && !p.ativo) return false;
      if (situacao === 'inativo' && p.ativo) return false;
      if (categoria && p.categoria !== categoria) return false;
      if ((estoqueFiltro === 'baixo' || alertaBaixo) && !(p.ativo && p.estoque <= p.estoqueMinimo)) return false;
      if (estoqueFiltro === 'zerado' && p.estoque > 0) return false;
      return true;
    });
  }, [produtos, busca, situacao, categoria, estoqueFiltro, alertaBaixo]);

  if (edicao) {
    return <FormProduto empresaId={empresaId} dados={edicao} onFechar={() => setEdicao(null)} onMovimentar={onMovimentar}
      onSalvar={async (d, ex) => { await onSalvar(d, ex); setEdicao(null); }}
      onExcluir={edicao.id ? async () => { await onExcluir(edicao as Produto); setEdicao(null); } : undefined} />;
  }

  return (
    <>
      <div className="flex gap-2 flex-wrap items-end mb-3 rounded-xl border border-line bg-white p-3">
        <div className="flex-1 min-w-[220px]">
          <label className={rotulo}>Pesquisar</label>
          <input className={campo} placeholder="Descrição, código (SKU), GTIN/EAN ou marca" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div>
          <label className={rotulo}>Situação</label>
          <select className={campo} value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)}>
            <option value="ativo">Ativos</option><option value="inativo">Inativos</option><option value="todos">Todos</option>
          </select>
        </div>
        <div>
          <label className={rotulo}>Categoria</label>
          <select className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas</option>{categorias.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={rotulo}>Estoque</label>
          <select className={campo} value={alertaBaixo ? 'baixo' : estoqueFiltro} onChange={(e) => { setAlertaBaixo(false); setEstoqueFiltro(e.target.value as typeof estoqueFiltro); }}>
            <option value="todos">Todos</option><option value="baixo">Abaixo do mínimo</option><option value="zerado">Zerado</option>
          </select>
        </div>
        <button onClick={onVariacoes} className="rounded-xl border border-line text-sm font-bold px-4 h-10">Produto com variações</button>
        <button onClick={() => setEdicao({ ativo: true, tipo: 'simples', unidade: 'un', preco: 0, custo: 0, estoque: 0, estoqueMinimo: 0 })} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-4 h-10">+ Incluir produto</button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-soft bg-surface"><tr>
            <th className="p-3 w-14" /><th className="text-left p-3">Código</th><th className="text-left p-3">Descrição</th><th className="text-left p-3">Categoria</th>
            <th className="text-right p-3">Preço</th><th className="text-right p-3">Custo</th><th className="text-right p-3">Estoque</th><th className="text-center p-3">Situação</th><th className="p-3" />
          </tr></thead>
          <tbody>
            {lista.map((p) => {
              const baixo = p.ativo && p.estoque <= p.estoqueMinimo;
              return (
                <tr key={p.id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setEdicao(p)}>
                  <td className="p-2">{p.imagemUrl ? <img src={p.imagemUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-line" /> : <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-300 flex items-center justify-center text-lg">▫</div>}</td>
                  <td className="p-3 font-mono text-xs">{p.sku}</td>
                  <td className="p-3"><div className="font-semibold text-ink">{p.nome}</div>{p.marca && <div className="text-[11px] text-ink-soft">{p.marca}</div>}</td>
                  <td className="p-3 text-ink-soft">{p.categoria ?? '—'}</td>
                  <td className="p-3 text-right">{formatarMoeda(p.preco)}</td>
                  <td className="p-3 text-right text-ink-soft">{formatarMoeda(p.custo)}</td>
                  <td className={`p-3 text-right font-bold ${baixo ? 'text-red-600' : ''}`}>{p.estoque} {p.unidade}{baixo && <span className="block text-[10px] font-bold uppercase">baixo (mín. {p.estoqueMinimo})</span>}</td>
                  <td className="p-3 text-center"><span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${p.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{p.ativo ? 'Ativo' : 'Inativo'}</span></td>
                  <td className="p-3 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                    <button className="text-xs font-bold text-teal-500 mr-2" onClick={() => onMovimentar(p, 'entrada')}>Entrada</button>
                    <button className="text-xs font-bold text-ink-soft mr-2" onClick={() => onMovimentar(p, 'saida')}>Saída</button>
                    <button className="text-xs font-bold text-ink-soft" onClick={() => onMovimentar(p, 'ajuste')}>Ajuste</button>
                  </td>
                </tr>
              );
            })}
            {lista.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-ink-soft">{produtos.length === 0 ? 'Nenhum produto ainda. Inclua o primeiro ou importe uma planilha.' : 'Nada encontrado com esses filtros.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft mt-2">{lista.length} de {produtos.length} produtos. Clique em uma linha para abrir o cadastro.</p>
    </>
  );
}

function G({ children, span = 1 }: { children: React.ReactNode; span?: number }) {
  return <div className={span === 4 ? 'md:col-span-4' : span === 3 ? 'md:col-span-3' : span === 2 ? 'md:col-span-2' : ''}>{children}</div>;
}

function FormProduto({ empresaId, dados, onFechar, onSalvar, onExcluir, onMovimentar }: {
  empresaId: string; dados: Partial<Produto>; onFechar: () => void;
  onSalvar: (d: DadosProduto, ex?: Produto) => Promise<void>; onExcluir?: () => Promise<void>;
  onMovimentar: (p: Produto, tipo: 'entrada' | 'saida' | 'ajuste') => void;
}) {
  const existente = dados.id ? (dados as Produto) : undefined;
  const [aba, setAba] = useState<Aba>('Dados gerais');
  const [v, setV] = useState({
    tipo: dados.tipo ?? 'simples', sku: dados.sku ?? '', nome: dados.nome ?? '', unidade: dados.unidade ?? 'un', gtin: dados.gtin ?? '',
    categoria: dados.categoria ?? '', marca: dados.marca ?? '', preco: txt(dados.preco ?? 0), custo: txt(dados.custo ?? 0), precoPromocional: txt(dados.precoPromocional),
    descricaoComplementar: dados.descricaoComplementar ?? '',
    pesoLiquido: txt(dados.pesoLiquido), pesoBruto: txt(dados.pesoBruto), largura: txt(dados.largura), altura: txt(dados.altura), profundidade: txt(dados.profundidade),
    estoque: '0', minimo: txt(dados.estoqueMinimo ?? 0), maximo: txt(dados.estoqueMaximo), localizacao: dados.localizacao ?? '',
    ncm: dados.ncm ?? '', cest: dados.cest ?? '', origemFiscal: dados.origemFiscal ?? '0',
    fornecedorId: dados.fornecedorId ?? '', codigoFornecedor: dados.codigoFornecedor ?? '',
    imagemUrl: dados.imagemUrl ?? '', observacoes: dados.observacoes ?? '', ativo: dados.ativo ?? true,
  });
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((a) => ({ ...a, [k]: x }));
  const [cats, setCats] = useState<RegistroCad[]>([]);
  const [marcas, setMarcas] = useState<RegistroCad[]>([]);
  const [fornecedores, setFornecedores] = useState<RegistroCad[]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const a = ouvirCadastro(empresaId, 'categoriasProduto', setCats);
    const b = ouvirCadastro(empresaId, 'marcasProduto', setMarcas);
    const c = ouvirCadastro(empresaId, 'fornecedores', setFornecedores);
    return () => { a(); b(); c(); };
  }, [empresaId]);

  const opt = (t: string) => (t.trim() === '' ? undefined : num(t));
  const margem = num(v.preco) > 0 && num(v.custo) > 0 ? ((num(v.preco) - num(v.custo)) / num(v.preco)) * 100 : null;
  const ok = v.sku.trim() && v.nome.trim();

  async function salvar() {
    setSalvando(true);
    setErro('');
    try {
      await onSalvar({
        sku: v.sku, nome: v.nome, categoria: v.categoria, marca: v.marca, unidade: v.unidade, preco: num(v.preco), custo: num(v.custo),
        estoque: num(v.estoque), estoqueMinimo: num(v.minimo), ativo: v.ativo, tipo: v.tipo as Produto['tipo'], gtin: v.gtin,
        descricaoComplementar: v.descricaoComplementar, precoPromocional: opt(v.precoPromocional),
        pesoLiquido: opt(v.pesoLiquido), pesoBruto: opt(v.pesoBruto), largura: opt(v.largura), altura: opt(v.altura), profundidade: opt(v.profundidade),
        estoqueMaximo: opt(v.maximo), localizacao: v.localizacao, ncm: v.ncm, cest: v.cest, origemFiscal: v.origemFiscal,
        fornecedorId: v.fornecedorId, codigoFornecedor: v.codigoFornecedor, imagemUrl: v.imagemUrl, observacoes: v.observacoes,
      }, existente);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.');
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex items-center gap-3 flex-wrap p-4 border-b border-line">
        <button onClick={onFechar} className="text-sm font-bold text-ink-soft">← Voltar</button>
        <h2 className="text-lg font-extrabold text-ink">{existente ? `Produto: ${existente.nome}` : 'Novo produto'}</h2>
        <div className="ml-auto flex gap-2">
          {onExcluir && <button onClick={() => { if (confirm('Excluir este produto?')) void onExcluir(); }} className="rounded-xl border border-red-300 text-red-600 text-sm font-bold px-4 h-10">Excluir</button>}
          <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4 h-10">Cancelar</button>
          <button disabled={!ok || salvando} onClick={() => void salvar()} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-5 h-10 disabled:opacity-40">{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
      {erro && <p className="text-sm text-red-600 px-4 pt-3">{erro}</p>}
      <div className="flex gap-1 px-4 pt-3 overflow-x-auto border-b border-line">
        {ABAS.map((a) => (
          <button key={a} onClick={() => setAba(a)} className={`px-3 h-9 text-sm font-bold whitespace-nowrap border-b-2 -mb-px ${aba === a ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-ink-soft'}`}>{a}</button>
        ))}
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        {aba === 'Dados gerais' && (
          <>
            <G><label className={rotulo}>Formato</label>
              <select className={campo} value={v.tipo} onChange={(e) => set('tipo', e.target.value as typeof v.tipo)}>
                <option value="simples">Simples</option><option value="variacao">Com variações</option><option value="kit">Kit / composição</option>
              </select></G>
            <G><label className={rotulo}>Código (SKU) *</label><input className={campo} value={v.sku} disabled={!!existente} onChange={(e) => set('sku', e.target.value)} /></G>
            <G span={2}><label className={rotulo}>Descrição *</label><input className={campo} value={v.nome} onChange={(e) => set('nome', e.target.value)} /></G>
            <G><label className={rotulo}>Unidade</label><input className={campo} value={v.unidade} onChange={(e) => set('unidade', e.target.value)} /></G>
            <G><label className={rotulo}>GTIN / EAN</label><input className={campo} value={v.gtin} onChange={(e) => set('gtin', e.target.value)} /></G>
            <G><label className={rotulo}>Categoria</label><input list="erp-cats" className={campo} value={v.categoria} onChange={(e) => set('categoria', e.target.value)} /><datalist id="erp-cats">{cats.map((c) => <option key={c.id} value={String(c.nome)} />)}</datalist></G>
            <G><label className={rotulo}>Marca</label><input list="erp-marcas" className={campo} value={v.marca} onChange={(e) => set('marca', e.target.value)} /><datalist id="erp-marcas">{marcas.map((c) => <option key={c.id} value={String(c.nome)} />)}</datalist></G>
            <G><label className={rotulo}>Preço de venda</label><input className={campo} value={v.preco} onChange={(e) => set('preco', e.target.value)} /></G>
            <G><label className={rotulo}>Preço promocional</label><input className={campo} value={v.precoPromocional} onChange={(e) => set('precoPromocional', e.target.value)} /></G>
            <G><label className={rotulo}>Preço de custo</label><input className={campo} value={v.custo} onChange={(e) => set('custo', e.target.value)} /></G>
            <G><label className={rotulo}>Margem</label><div className="h-10 flex items-center text-sm font-bold text-ink">{margem === null ? '—' : `${margem.toFixed(1).replace('.', ',')}%`}</div></G>
            <G span={4}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.ativo} onChange={(e) => set('ativo', e.target.checked)} /> Produto ativo (aparece nos pedidos)</label></G>
          </>
        )}
        {aba === 'Características' && (
          <>
            <G><label className={rotulo}>Peso líquido (kg)</label><input className={campo} value={v.pesoLiquido} onChange={(e) => set('pesoLiquido', e.target.value)} /></G>
            <G><label className={rotulo}>Peso bruto (kg)</label><input className={campo} value={v.pesoBruto} onChange={(e) => set('pesoBruto', e.target.value)} /></G>
            <G span={2}><span /></G>
            <G><label className={rotulo}>Largura (cm)</label><input className={campo} value={v.largura} onChange={(e) => set('largura', e.target.value)} /></G>
            <G><label className={rotulo}>Altura (cm)</label><input className={campo} value={v.altura} onChange={(e) => set('altura', e.target.value)} /></G>
            <G><label className={rotulo}>Profundidade (cm)</label><input className={campo} value={v.profundidade} onChange={(e) => set('profundidade', e.target.value)} /></G>
            <G span={4}><label className={rotulo}>Descrição complementar</label><textarea className="w-full rounded-lg border border-line px-3 py-2 text-sm min-h-[120px]" value={v.descricaoComplementar} onChange={(e) => set('descricaoComplementar', e.target.value)} /></G>
          </>
        )}
        {aba === 'Estoque' && (
          <>
            {existente ? (
              <G span={4}>
                <div className="rounded-xl bg-surface p-4 flex items-center gap-4 flex-wrap">
                  <div><div className={rotulo}>Saldo atual</div><div className="text-2xl font-extrabold text-ink">{existente.estoque} {existente.unidade}</div></div>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => onMovimentar(existente, 'entrada')} className="rounded-xl border border-line text-sm font-bold px-4 h-10">Entrada</button>
                    <button onClick={() => onMovimentar(existente, 'saida')} className="rounded-xl border border-line text-sm font-bold px-4 h-10">Saída</button>
                    <button onClick={() => onMovimentar(existente, 'ajuste')} className="rounded-xl border border-line text-sm font-bold px-4 h-10">Ajuste (balanço)</button>
                  </div>
                </div>
                <p className="text-xs text-ink-soft mt-1">O saldo só muda por movimentação, para ficar no histórico.</p>
              </G>
            ) : (
              <G><label className={rotulo}>Estoque inicial</label><input className={campo} value={v.estoque} onChange={(e) => set('estoque', e.target.value)} /></G>
            )}
            <G><label className={rotulo}>Estoque mínimo</label><input className={campo} value={v.minimo} onChange={(e) => set('minimo', e.target.value)} /></G>
            <G><label className={rotulo}>Estoque máximo</label><input className={campo} value={v.maximo} onChange={(e) => set('maximo', e.target.value)} /></G>
            <G><label className={rotulo}>Localização</label><input className={campo} value={v.localizacao} onChange={(e) => set('localizacao', e.target.value)} placeholder="Ex.: Prateleira B2" /></G>
          </>
        )}
        {aba === 'Tributação' && (
          <>
            <G><label className={rotulo}>NCM</label><input className={campo} value={v.ncm} onChange={(e) => set('ncm', e.target.value)} placeholder="0000.00.00" /></G>
            <G><label className={rotulo}>CEST</label><input className={campo} value={v.cest} onChange={(e) => set('cest', e.target.value)} /></G>
            <G span={2}><label className={rotulo}>Origem da mercadoria</label>
              <select className={campo} value={v.origemFiscal} onChange={(e) => set('origemFiscal', e.target.value)}>
                <option value="0">0 - Nacional</option>
                <option value="1">1 - Estrangeira (importação direta)</option>
                <option value="2">2 - Estrangeira (adquirida no mercado interno)</option>
                <option value="3">3 - Nacional (conteúdo de importação entre 40% e 70%)</option>
                <option value="5">5 - Nacional (conteúdo de importação até 40%)</option>
                <option value="8">8 - Nacional (conteúdo de importação acima de 70%)</option>
              </select></G>
          </>
        )}
        {aba === 'Fornecedor' && (
          <>
            <G span={2}><label className={rotulo}>Fornecedor</label>
              <select className={campo} value={v.fornecedorId} onChange={(e) => set('fornecedorId', e.target.value)}>
                <option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{String(f.nome)}</option>)}
              </select>
              {fornecedores.length === 0 && <p className="text-[11px] text-ink-soft mt-1">Cadastre fornecedores em Cadastros &gt; Fornecedores.</p>}</G>
            <G span={2}><label className={rotulo}>Código do produto no fornecedor</label><input className={campo} value={v.codigoFornecedor} onChange={(e) => set('codigoFornecedor', e.target.value)} /></G>
          </>
        )}
        {aba === 'Imagem' && (
          <>
            <G span={3}>
              <label className={rotulo}>Imagem do produto</label>
              <input ref={arquivoRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try { set('imagemUrl', await reduzirImagem(f)); setErro(''); } catch (err) { setErro(err instanceof Error ? err.message : 'Não consegui usar essa imagem.'); }
              }} />
              <div className="flex gap-2 flex-wrap mb-3">
                <button type="button" onClick={() => arquivoRef.current?.click()} className="rounded-xl bg-emerald-600 text-white text-sm font-bold px-4 h-10">📁 Buscar imagem no computador</button>
                {v.imagemUrl && <button type="button" onClick={() => set('imagemUrl', '')} className="rounded-xl border border-line text-sm font-bold px-4 h-10">Remover imagem</button>}
              </div>
              <label className={rotulo}>Ou cole o endereço (URL) da imagem</label>
              <input className={campo} value={v.imagemUrl.startsWith('data:') ? '' : v.imagemUrl} onChange={(e) => set('imagemUrl', e.target.value)} placeholder="https://..." />
              <p className="text-[11px] text-ink-soft mt-1">A foto escolhida é reduzida automaticamente (até 800 px) para ficar leve.</p>
            </G>
            <G>{v.imagemUrl ? <img src={v.imagemUrl} alt="" className="w-32 h-32 rounded-xl object-cover border border-line" /> : <div className="w-32 h-32 rounded-xl bg-slate-100" />}</G>
          </>
        )}
        {aba === 'Observações' && (
          <G span={4}><label className={rotulo}>Observações internas</label><textarea className="w-full rounded-lg border border-line px-3 py-2 text-sm min-h-[160px]" value={v.observacoes} onChange={(e) => set('observacoes', e.target.value)} /></G>
        )}
      </div>
    </div>
  );
}
