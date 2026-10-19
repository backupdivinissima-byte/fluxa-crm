import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { acertarConsignacao, criarConsignacao, ouvirConsignacoes } from '../lib/erpData';
import { ouvirCadastro, type RegistroCad } from '../lib/erpCadastros';
import { formatarMoeda, parseValorBR } from '../lib/crmLogic';
import type { Consignacao, ItemConsig, Produto } from '../types';

const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold uppercase tracking-wide text-ink-soft mb-1';
const num = (t: string) => { const n = parseValorBR(t); return Number.isNaN(n) ? 0 : n; };

export default function ErpConsignacao({ empresaId, produtos }: { empresaId: string; produtos: Produto[] }) {
  const [lista, setLista] = useState<Consignacao[]>([]);
  const [novo, setNovo] = useState(false);
  const [acerto, setAcerto] = useState<Consignacao | null>(null);
  const [filtro, setFiltro] = useState<'abertas' | 'todas'>('abertas');
  useEffect(() => ouvirConsignacoes(empresaId, setLista), [empresaId]);
  const vis = lista.filter((c) => filtro === 'todas' || c.status === 'aberta');
  const pendente = (c: Consignacao) => c.itens.reduce((s, i) => s + (i.enviada - i.vendida - i.devolvida), 0);
  return (
    <>
      <div className="flex gap-2 items-center flex-wrap mb-3">
        <select className={`${campo} max-w-[170px]`} value={filtro} onChange={(e) => setFiltro(e.target.value as 'abertas' | 'todas')}><option value="abertas">Em aberto</option><option value="todas">Todas</option></select>
        <span className="text-sm text-ink-soft">Peças que estão com clientes ou que você recebeu de fornecedores para vender, e ainda não foram acertadas.</span>
        <button onClick={() => setNovo(true)} className="ml-auto rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 h-10">+ Nova consignação</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-soft bg-surface"><tr><th className="text-left p-3">Nº</th><th className="text-left p-3">Quem</th><th className="text-left p-3">Peças</th><th className="text-right p-3">Falta acertar</th><th className="text-right p-3">Já acertado</th><th className="p-3" /></tr></thead>
          <tbody>
            {vis.map((c) => (
              <tr key={c.id} className="border-t border-line align-top">
                <td className="p-3 font-bold">#{c.numero}<div className="text-[11px] font-normal text-ink-soft">{new Date(c.criadoEm).toLocaleDateString('pt-BR')}</div></td>
                <td className="p-3">{c.parteNome}<div className="text-xs text-ink-soft">{c.tipo === 'cliente' ? 'Cliente (peças com ela)' : 'Fornecedor (peças suas)'}</div></td>
                <td className="p-3 text-ink-soft">{c.itens.map((i) => `${i.enviada}× ${i.nome}`).join(', ')}</td>
                <td className="p-3 text-right font-bold">{pendente(c)} un.</td>
                <td className="p-3 text-right">{formatarMoeda(c.valorAcertado)}</td>
                <td className="p-3 text-right whitespace-nowrap">{c.status === 'aberta' ? <button className="text-xs font-bold text-teal-500" onClick={() => setAcerto(c)}>Acertar</button> : <span className="text-xs text-ink-soft">Encerrada</span>}</td>
              </tr>
            ))}
            {vis.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">Nenhuma consignação {filtro === 'abertas' ? 'em aberto' : 'ainda'}.</td></tr>}
          </tbody>
        </table>
      </div>
      {novo && <FormNova empresaId={empresaId} produtos={produtos} onFechar={() => setNovo(false)} />}
      {acerto && <FormAcerto empresaId={empresaId} c={acerto} onFechar={() => setAcerto(null)} />}
    </>
  );
}

function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-ink mb-3">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

function FormNova({ empresaId, produtos, onFechar }: { empresaId: string; produtos: Produto[]; onFechar: () => void }) {
  const { perfil } = useAuth();
  const [tipo, setTipo] = useState<'cliente' | 'fornecedor'>('cliente');
  const [partes, setPartes] = useState<RegistroCad[]>([]);
  const [parteId, setParteId] = useState('');
  const [nome, setNome] = useState('');
  const [itens, setItens] = useState<ItemConsig[]>([]);
  const [prodId, setProdId] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setParteId(''); return ouvirCadastro(empresaId, tipo === 'cliente' ? 'clientes' : 'fornecedores', setPartes); }, [empresaId, tipo]);
  return (
    <Modal titulo="Nova consignação" onFechar={onFechar}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={rotulo}>Tipo</label><select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value as 'cliente' | 'fornecedor')}><option value="cliente">Enviar peças a um cliente</option><option value="fornecedor">Receber peças de um fornecedor</option></select></div>
        <div><label className={rotulo}>{tipo === 'cliente' ? 'Cliente' : 'Fornecedor'}</label>
          <select className={campo} value={parteId} onChange={(e) => { setParteId(e.target.value); setNome(String(partes.find((p) => p.id === e.target.value)?.nome ?? '')); }}><option value="">Escolha…</option>{partes.map((p) => <option key={p.id} value={p.id}>{String(p.nome)}</option>)}</select>
        </div>
        {!parteId && <div className="col-span-2"><label className={rotulo}>Ou digite o nome</label><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} /></div>}
      </div>
      <label className={`${rotulo} mt-4`}>Peças</label>
      <div className="flex gap-2">
        <select className={campo} value={prodId} onChange={(e) => setProdId(e.target.value)}><option value="">Escolha…</option>{produtos.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.nome} (estoque {p.estoque})</option>)}</select>
        <button className="rounded-xl border border-line text-sm font-bold px-3" onClick={() => { const p = produtos.find((x) => x.id === prodId); if (!p) return; setItens((a) => a.some((i) => i.produtoId === p.id) ? a : [...a, { produtoId: p.id, sku: p.sku, nome: p.nome, enviada: 1, vendida: 0, devolvida: 0, preco: p.preco, custo: p.custo }]); setProdId(''); }}>Incluir</button>
      </div>
      {itens.length > 0 && (
        <div className="mt-2 rounded-lg border border-line divide-y divide-line">
          {itens.map((i) => (
            <div key={i.produtoId} className="flex items-center gap-2 p-2 text-sm">
              <span className="flex-1">{i.nome}</span>
              <input className="w-14 rounded border border-line px-2 h-8 text-sm" value={i.enviada} onChange={(e) => setItens(itens.map((x) => x.produtoId === i.produtoId ? { ...x, enviada: num(e.target.value) } : x))} />
              <button className="text-red-600 text-xs font-bold" onClick={() => setItens(itens.filter((x) => x.produtoId !== i.produtoId))}>remover</button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-ink-soft mt-3">{tipo === 'cliente' ? 'As peças saem do seu estoque agora e voltam, se sobrarem, no acerto.' : 'As peças entram no seu estoque agora. No acerto você informa o que vendeu (a pagar ao fornecedor) e o que devolveu.'}</p>
      {erro && <p className="text-sm text-red-600 mt-2">{erro}</p>}
      <div className="flex gap-2 mt-4">
        <button disabled={salvando} onClick={async () => { setSalvando(true); try { await criarConsignacao(empresaId, tipo, nome, parteId || undefined, itens, perfil?.nome); onFechar(); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro.'); } setSalvando(false); }} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold h-10 disabled:opacity-40">Criar consignação</button>
        <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4">Cancelar</button>
      </div>
    </Modal>
  );
}

function FormAcerto({ empresaId, c, onFechar }: { empresaId: string; c: Consignacao; onFechar: () => void }) {
  const { perfil } = useAuth();
  const [v, setV] = useState<Record<string, { vendida: string; devolvida: string }>>({});
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const get = (id: string) => v[id] ?? { vendida: '', devolvida: '' };
  const total = c.itens.reduce((s, i) => s + num(get(i.produtoId).vendida) * (c.tipo === 'cliente' ? i.preco : i.custo), 0);
  return (
    <Modal titulo={`Acertar consignação #${c.numero} — ${c.parteNome}`} onFechar={onFechar}>
      <div className="rounded-lg border border-line divide-y divide-line">
        <div className="grid grid-cols-[1fr_70px_70px] gap-2 p-2 text-xs font-bold uppercase text-ink-soft"><span>Peça (falta acertar)</span><span>Vendeu</span><span>Voltou</span></div>
        {c.itens.map((i) => (
          <div key={i.produtoId} className="grid grid-cols-[1fr_70px_70px] gap-2 p-2 items-center text-sm">
            <span>{i.nome} <span className="text-xs text-ink-soft">({i.enviada - i.vendida - i.devolvida} de {i.enviada})</span></span>
            <input className="rounded border border-line px-2 h-8 text-sm" value={get(i.produtoId).vendida} onChange={(e) => setV({ ...v, [i.produtoId]: { ...get(i.produtoId), vendida: e.target.value } })} />
            <input className="rounded border border-line px-2 h-8 text-sm" value={get(i.produtoId).devolvida} onChange={(e) => setV({ ...v, [i.produtoId]: { ...get(i.produtoId), devolvida: e.target.value } })} />
          </div>
        ))}
      </div>
      <p className="text-sm mt-3">{c.tipo === 'cliente' ? 'A receber do cliente' : 'A pagar ao fornecedor'}: <b>{formatarMoeda(total)}</b> <span className="text-xs text-ink-soft">(vai para o Financeiro)</span></p>
      <p className="text-xs text-ink-soft">{c.tipo === 'cliente' ? 'O que voltou entra no seu estoque.' : 'O que voltou sai do seu estoque, de volta ao fornecedor.'}</p>
      {erro && <p className="text-sm text-red-600 mt-2">{erro}</p>}
      <div className="flex gap-2 mt-4">
        <button disabled={salvando} onClick={async () => { setSalvando(true); try { await acertarConsignacao(empresaId, c, Object.fromEntries(c.itens.map((i) => [i.produtoId, { vendida: num(get(i.produtoId).vendida), devolvida: num(get(i.produtoId).devolvida) }])), perfil?.nome); onFechar(); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro.'); } setSalvando(false); }} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold h-10 disabled:opacity-40">Confirmar acerto</button>
        <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4">Cancelar</button>
      </div>
    </Modal>
  );
}
