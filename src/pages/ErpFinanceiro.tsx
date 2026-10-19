import { useEffect, useMemo, useState } from 'react';
import { baixarConta, criarConta, excluirConta, ouvirContas } from '../lib/erpData';
import { formatarMoeda, parseValorBR } from '../lib/crmLogic';
import type { ContaFin } from '../types';

const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold uppercase tracking-wide text-ink-soft mb-1';
const hoje = () => new Date().toISOString().slice(0, 10);

export default function ErpFinanceiro({ empresaId }: { empresaId: string }) {
  const [contas, setContas] = useState<ContaFin[]>([]);
  const [tipo, setTipo] = useState<'receber' | 'pagar'>('receber');
  const [status, setStatus] = useState<'abertas' | 'pagas' | 'todas'>('abertas');
  const [nova, setNova] = useState(false);
  const [erro, setErro] = useState('');
  useEffect(() => ouvirContas(empresaId, setContas), [empresaId]);

  const resumo = useMemo(() => {
    const h = hoje();
    const soma = (f: (c: ContaFin) => boolean) => contas.filter(f).reduce((s, c) => s + c.valor, 0);
    const rec = soma((c) => c.tipo === 'receber' && !c.pago);
    const pag = soma((c) => c.tipo === 'pagar' && !c.pago);
    return { rec, pag, saldo: rec - pag, venc: soma((c) => !c.pago && c.vencimento < h && c.tipo === 'receber'), vencPag: soma((c) => !c.pago && c.vencimento < h && c.tipo === 'pagar') };
  }, [contas]);

  const lista = contas.filter((c) => c.tipo === tipo && (status === 'todas' || (status === 'pagas') === c.pago));
  const h = hoje();
  async function acao(f: () => Promise<void>) { try { setErro(''); await f(); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro.'); } }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Cartao t="A receber" v={formatarMoeda(resumo.rec)} cor="text-teal-600" />
        <Cartao t="A pagar" v={formatarMoeda(resumo.pag)} cor="text-red-600" />
        <Cartao t="Saldo previsto" v={formatarMoeda(resumo.saldo)} cor={resumo.saldo >= 0 ? 'text-ink' : 'text-red-600'} />
        <Cartao t="Atrasado" v={formatarMoeda(resumo.venc + resumo.vencPag)} cor={resumo.venc + resumo.vencPag > 0 ? 'text-red-600' : 'text-ink'} />
      </div>
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {(['receber', 'pagar'] as const).map((t) => <button key={t} onClick={() => setTipo(t)} className={`px-4 h-8 rounded-md text-xs font-bold uppercase ${tipo === t ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'}`}>{t === 'receber' ? 'A receber' : 'A pagar'}</button>)}
        </div>
        <select className={`${campo} max-w-[150px]`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="abertas">Em aberto</option><option value="pagas">{tipo === 'receber' ? 'Recebidas' : 'Pagas'}</option><option value="todas">Todas</option></select>
        <button onClick={() => setNova(true)} className="ml-auto rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 h-10">+ Nova conta</button>
      </div>
      {erro && <p className="text-sm text-red-600 mb-2">{erro}</p>}
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-soft bg-surface"><tr><th className="text-left p-3">Vence</th><th className="text-left p-3">Descrição</th><th className="text-left p-3">{tipo === 'receber' ? 'Cliente' : 'Fornecedor'}</th><th className="text-right p-3">Valor</th><th className="p-3" /></tr></thead>
          <tbody>
            {lista.map((c) => {
              const atrasada = !c.pago && c.vencimento < h;
              return (
                <tr key={c.id} className="border-t border-line">
                  <td className={`p-3 whitespace-nowrap ${atrasada ? 'text-red-600 font-bold' : ''}`}>{c.vencimento.split('-').reverse().join('/')}{atrasada && <span className="block text-[10px] uppercase">atrasada</span>}</td>
                  <td className="p-3">{c.descricao}</td>
                  <td className="p-3 text-ink-soft">{c.parteNome ?? '—'}</td>
                  <td className="p-3 text-right font-bold">{formatarMoeda(c.valor)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button className="text-xs font-bold text-teal-500 mr-3" onClick={() => void acao(() => baixarConta(empresaId, c, !c.pago))}>{c.pago ? 'Desfazer' : tipo === 'receber' ? 'Receber' : 'Pagar'}</button>
                    {!c.origemId && <button className="text-xs font-bold text-red-600" onClick={() => { if (confirm('Excluir esta conta?')) void acao(() => excluirConta(empresaId, c.id)); }}>Excluir</button>}
                  </td>
                </tr>
              );
            })}
            {lista.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-ink-soft">Nada por aqui. As contas dos pedidos, trocas e acertos de consignação aparecem sozinhas.</td></tr>}
          </tbody>
        </table>
      </div>
      {nova && <FormConta tipoInicial={tipo} onFechar={() => setNova(false)} onSalvar={async (d) => { await criarConta(empresaId, d); setNova(false); }} />}
    </>
  );
}

function Cartao({ t, v, cor }: { t: string; v: string; cor: string }) {
  return <div className="rounded-xl border border-line bg-white p-4"><div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{t}</div><div className={`text-xl font-extrabold ${cor}`}>{v}</div></div>;
}

function FormConta({ tipoInicial, onFechar, onSalvar }: { tipoInicial: 'receber' | 'pagar'; onFechar: () => void; onSalvar: (d: Omit<ContaFin, 'id' | 'criadoEm' | 'pago'>) => Promise<void> }) {
  const [tipo, setTipo] = useState(tipoInicial);
  const [descricao, setDescricao] = useState('');
  const [parte, setParte] = useState('');
  const [valor, setValor] = useState('');
  const [venc, setVenc] = useState(hoje());
  const n = parseValorBR(valor);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-ink mb-3">Nova conta</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={rotulo}>Tipo</label><select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value as 'receber' | 'pagar')}><option value="receber">A receber</option><option value="pagar">A pagar</option></select></div>
          <div className="col-span-2"><label className={rotulo}>Descrição</label><input className={campo} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Aluguel, fornecedor, venda avulsa…" /></div>
          <div className="col-span-2"><label className={rotulo}>{tipo === 'receber' ? 'Cliente' : 'Fornecedor'} (opcional)</label><input className={campo} value={parte} onChange={(e) => setParte(e.target.value)} /></div>
          <div><label className={rotulo}>Valor</label><input className={campo} value={valor} onChange={(e) => setValor(e.target.value)} /></div>
          <div><label className={rotulo}>Vencimento</label><input type="date" className={campo} value={venc} onChange={(e) => setVenc(e.target.value)} /></div>
        </div>
        <div className="flex gap-2 mt-4">
          <button disabled={!descricao.trim() || Number.isNaN(n) || n <= 0} onClick={() => void onSalvar({ tipo, descricao: descricao.trim(), parteNome: parte.trim() || undefined, valor: n, vencimento: venc })} className="flex-1 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold h-10 disabled:opacity-40">Salvar</button>
          <button onClick={onFechar} className="rounded-xl border border-line text-sm font-bold px-4">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
