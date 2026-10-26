import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ouvirClientes, ouvirEmpresa, ouvirVendedores } from '../lib/crmData';
import { formatarMoeda, metasDoVendedor, nivelDeMeta, vendasDoMesVendedor } from '../lib/crmLogic';
import { tocarCampainhaVenda } from '../lib/campainha';
import { COMISSAO_BASE_PADRAO, CRM_COLUNAS_PADRAO, METAS_PADRAO, type Cliente, type ColunaCrm, type MetaTier, type Vendedor } from '../types';

const CORES = ['#14b8a6', '#3b82f6', '#f59e0b', '#ec4899', '#22c55e', '#8b5cf6', '#ef4444'];

function lerGuardado(chave: string): number | null {
  try {
    const v = localStorage.getItem(chave);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}
function guardar(chave: string, valor: number) {
  try {
    localStorage.setItem(chave, String(valor));
  } catch {
    /* sem armazenamento */
  }
}

/** Tela de comemoração quando o vendedor bate uma meta (faixa da empresa ou a meta pessoal).
 * Só comemora uma vez por meta e por mês; ao abrir o sistema com a meta já batida, não repete. */
export default function CelebracaoMeta() {
  const { empresa, sessaoVendedor } = useAuth();
  const empresaId = empresa?.id;
  const login = sessaoVendedor?.vendedor.login ?? '';
  const nome = sessaoVendedor?.vendedor.nome ?? '';
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [colunas, setColunas] = useState<ColunaCrm[]>(empresa?.crmColunas ?? CRM_COLUNAS_PADRAO);
  const [metasEmpresa, setMetasEmpresa] = useState<MetaTier[]>(empresa?.metas ?? METAS_PADRAO);
  const [comissaoBase, setComissaoBase] = useState<number>(empresa?.comissaoBase ?? COMISSAO_BASE_PADRAO);
  const [festa, setFesta] = useState<{ titulo: string; vendas: number; comissao: number } | null>(null);

  useEffect(() => {
    if (!empresaId || !login) return;
    const u1 = ouvirClientes(empresaId, setClientes);
    const u2 = ouvirVendedores(empresaId, setVendedores);
    const u3 = ouvirEmpresa(empresaId, (e) => {
      setColunas(e?.crmColunas && e.crmColunas.length > 0 ? e.crmColunas : CRM_COLUNAS_PADRAO);
      setMetasEmpresa(e?.metas && e.metas.length > 0 ? e.metas : METAS_PADRAO);
      setComissaoBase(e?.comissaoBase ?? COMISSAO_BASE_PADRAO);
    });
    return () => {
      u1();
      u2();
      u3();
    };
  }, [empresaId, login]);

  const hoje = new Date();
  const mesRef = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const fechamentos = useMemo(() => colunas.filter((c) => c.fechamento).map((c) => c.id), [colunas]);
  const cadastro = vendedores.find((v) => v.login === login) ?? sessaoVendedor?.vendedor;
  const metas = metasDoVendedor(cadastro, metasEmpresa);
  const metaPessoal = !(cadastro?.metas && cadastro.metas.length > 0) ? (cadastro?.meta ?? 0) : 0;
  const vendas = useMemo(() => vendasDoMesVendedor(clientes, login, nome, fechamentos, mesRef), [clientes, login, nome, fechamentos, mesRef]);
  const nivel = nivelDeMeta(metas, vendas, comissaoBase);

  useEffect(() => {
    if (!login || clientes.length === 0 || fechamentos.length === 0) return;
    const chaveNivel = `fluxa_meta_nivel_${login}_${mesRef}`;
    const chavePessoal = `fluxa_meta_pessoal_${login}_${mesRef}`;
    const gNivel = lerGuardado(chaveNivel);
    const gPessoal = lerGuardado(chavePessoal);
    const pessoalBatida = metaPessoal > 0 && vendas >= metaPessoal ? 1 : 0;
    // Primeira vez neste navegador no mês: só registra o estado atual, sem comemorar o que já estava batido.
    if (gNivel === null || gPessoal === null) {
      guardar(chaveNivel, nivel.indice);
      guardar(chavePessoal, pessoalBatida);
      return;
    }
    let titulo: string | null = null;
    if (nivel.indice > gNivel && nivel.tier) titulo = `Você bateu a ${nivel.tier.label}!`;
    else if (pessoalBatida && !gPessoal) titulo = 'Você bateu a sua meta pessoal!';
    if (nivel.indice !== gNivel) guardar(chaveNivel, nivel.indice);
    if (pessoalBatida !== gPessoal) guardar(chavePessoal, pessoalBatida);
    if (titulo) {
      setFesta({ titulo, vendas, comissao: nivel.comissao });
      tocarCampainhaVenda();
      setTimeout(tocarCampainhaVenda, 700);
    }
  }, [vendas, nivel.indice, nivel.tier, nivel.comissao, metaPessoal, login, mesRef, clientes.length, fechamentos.length]);

  const confetes = useMemo(
    () => Array.from({ length: 70 }, (_, i) => ({ id: i, esq: Math.random() * 100, atraso: Math.random() * 1.5, dur: 2.5 + Math.random() * 2.5, cor: CORES[i % CORES.length], tam: 6 + Math.random() * 8 })),
    []
  );

  if (!festa) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-ink/70 flex items-center justify-center p-4 overflow-hidden" onClick={() => setFesta(null)}>
      <style>{`@keyframes fluxa-cai{0%{transform:translateY(-10vh) rotate(0)}100%{transform:translateY(110vh) rotate(720deg)}}@keyframes fluxa-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}`}</style>
      {confetes.map((c) => (
        <span key={c.id} className="absolute top-0 rounded-sm" style={{ left: `${c.esq}%`, width: c.tam, height: c.tam * 1.6, background: c.cor, animation: `fluxa-cai ${c.dur}s linear ${c.atraso}s infinite` }} />
      ))}
      <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full text-center p-8" style={{ animation: 'fluxa-pop .5s ease-out' }} onClick={(e) => e.stopPropagation()}>
        <div className="text-6xl">🎉🏆🎉</div>
        <h2 className="mt-3 text-2xl font-extrabold text-ink">{festa.titulo}</h2>
        <p className="mt-1 text-sm text-ink-soft">Parabéns, {nome.split(' ')[0]}! Você está vendendo muito.</p>
        <div className="mt-4 rounded-2xl bg-surface p-3">
          <div className="text-xs font-bold uppercase text-ink-soft">Vendas do mês</div>
          <div className="text-2xl font-extrabold text-teal-600">{formatarMoeda(festa.vendas)}</div>
          <div className="text-xs text-ink-soft mt-1">Comissão estimada: <b>{formatarMoeda(festa.comissao)}</b></div>
        </div>
        <button onClick={() => setFesta(null)} className="mt-5 w-full rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white font-bold py-3">Continuar vendendo 🚀</button>
      </div>
    </div>
  );
}
