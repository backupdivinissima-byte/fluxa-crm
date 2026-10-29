import { useEffect, useState } from 'react';
import { corrigirNonoDigito, ouvirTelefonesInternos, salvarTelefonesInternos, type TelefoneInterno } from '../lib/chatData';

const campo = 'w-full rounded-lg border border-line px-3 h-10 text-sm bg-white';
const rotulo = 'block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1';

/** Cadastro de telefones internos (diretoria, financeiro, outros setores): conversas com esses números nunca são atribuídas a um vendedor. */
export default function CadastroTelefonesChat({ empresaId }: { empresaId: string }) {
  const [lista, setLista] = useState<TelefoneInterno[]>([]);
  const [numero, setNumero] = useState('');
  const [nome, setNome] = useState('');
  const [setor, setSetor] = useState('');
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => ouvirTelefonesInternos(empresaId, setLista), [empresaId]);

  async function gravar(nova: TelefoneInterno[], ok: string) {
    setSalvando(true); setMsg('');
    try { await salvarTelefonesInternos(empresaId, nova); setMsg(ok); } catch (e) { setMsg(e instanceof Error ? e.message : 'Não consegui salvar.'); }
    setSalvando(false);
  }
  async function adicionar() {
    const n = corrigirNonoDigito(numero.trim());
    if (n.replace(/\D/g, '').length < 10) return setMsg('Digite o telefone com DDD.');
    if (!nome.trim()) return setMsg('Informe o nome (ex.: Diretor, Financeiro).');
    if (lista.some((t) => t.numero.replace(/\D/g, '').slice(-9) === n.replace(/\D/g, '').slice(-9))) return setMsg('Esse telefone já está cadastrado.');
    await gravar([...lista, { id: `${Date.now()}`, numero: n, nome: nome.trim(), ...(setor.trim() ? { setor: setor.trim() } : {}) }], 'Telefone cadastrado.');
    setNumero(''); setNome(''); setSetor('');
  }

  return (
    <div className="bg-white border border-line rounded-2xl p-5">
      <h2 className="text-base font-extrabold text-ink">Cadastro de telefones internos</h2>
      <p className="text-sm text-ink-soft mt-1 mb-4 max-w-3xl">
        Cadastre aqui os números da diretoria, do financeiro e de outros setores. As conversas com esses números <b>não são atribuídas a nenhum vendedor</b>:
        todos podem ver as mensagens e responder por eles. Eles também ficam fora dos contadores de atendimento e do robô de boas-vindas.
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="w-52"><label className={rotulo}>Telefone (com DDD)</label><input className={campo} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="(11) 91234-5678" inputMode="tel" /></div>
        <div className="w-52"><label className={rotulo}>Nome</label><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Diretor" /></div>
        <div className="w-52"><label className={rotulo}>Setor (opcional)</label><input className={campo} value={setor} onChange={(e) => setSetor(e.target.value)} placeholder="Ex.: Financeiro" onKeyDown={(e) => e.key === 'Enter' && void adicionar()} /></div>
        <button disabled={salvando} onClick={() => void adicionar()} className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-5 h-10 disabled:opacity-40">+ Cadastrar</button>
      </div>
      {msg && <p className={`text-sm mb-3 ${msg.includes('cadastrado') || msg.includes('removido') ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-soft bg-surface"><tr><th className="text-left p-3">Telefone</th><th className="text-left p-3">Nome</th><th className="text-left p-3">Setor</th><th className="p-3" /></tr></thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="p-3 font-mono text-xs">{t.numero}</td>
                <td className="p-3 font-semibold text-ink">{t.nome}</td>
                <td className="p-3 text-ink-soft">{t.setor ?? '—'}</td>
                <td className="p-3 text-right"><button disabled={salvando} className="text-xs font-bold text-red-600" onClick={() => { if (window.confirm(`Remover ${t.nome} dos telefones internos?`)) void gravar(lista.filter((x) => x.id !== t.id), 'Telefone removido.'); }}>Remover</button></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-ink-soft">Nenhum telefone interno cadastrado ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
