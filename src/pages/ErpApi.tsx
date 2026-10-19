import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { gerarChaveApi, revogarChaveApi } from '../lib/apiKey';

const BASE = 'https://us-central1-fluxa-crm.cloudfunctions.net/api/v1/erp';

/** Integrações do Fluxa ERP: o ERP é um módulo individual e só se liga ao CRM,
 * Chat, Live (ou qualquer outro sistema) por esta API. */
export default function ErpApi({ empresaId }: { empresaId: string }) {
  const { empresa } = useAuth();
  const [chave, setChave] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const ativa = !!empresa?.apiKeyHash;

  async function gerar() {
    if (ativa && !confirm('Gerar nova chave desativa a atual (inclusive a da importação de clientes). Continuar?')) return;
    setOcupado(true); setErro('');
    try { setChave(await gerarChaveApi(empresaId)); } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível gerar a chave.'); }
    setOcupado(false);
  }
  async function revogar() {
    if (!confirm('Revogar a chave? Todas as integrações param de funcionar.')) return;
    setOcupado(true); setErro('');
    try { await revogarChaveApi(empresaId); setChave(null); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao revogar.'); }
    setOcupado(false);
  }
  const k = chave ?? 'SUA_CHAVE_AQUI';
  const exemplo = `curl -X POST ${BASE}/pedidos \\
  -H "Content-Type: application/json" -H "X-Api-Key: ${k}" \\
  -d '{ "clienteNome": "Maria Silva", "clienteTelefone": "11999998888",
        "itens": [{ "sku": "ANEL-001", "quantidade": 2 }] }'`;
  const rotas: [string, string, string][] = [
    ['GET', '/produtos?busca=anel', 'Lista produtos com preço e saldo'],
    ['GET', '/produtos/{sku}', 'Consulta um produto (preço e saldo)'],
    ['POST', '/produtos', 'Cria/atualiza produto (sku, nome, preco, estoque...)'],
    ['POST', '/estoque', 'Entrada, saída ou ajuste: { sku, tipo, quantidade }'],
    ['POST', '/pedidos', 'Cria pedido (ou orçamento com "orcamento": true). Preço automático pelo cadastro; baixa o estoque'],
    ['GET', '/pedidos/{numero}', 'Consulta pedido'],
    ['POST', '/pedidos/{numero}/status', 'Muda status: { status } — cancelar devolve ao estoque'],
  ];
  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-white border border-line rounded-2xl p-5">
        <h2 className="text-sm font-extrabold text-ink">Integrações (API)</h2>
        <p className="text-sm text-ink-soft mt-1">O Fluxa ERP funciona sozinho. Para ligar com o CRM, Chat, Live ou outro sistema, use a chave abaixo — é a única porta de entrada.</p>
        {ativa && !chave && <p className="text-sm text-ink-soft mt-3"><span className="inline-block w-2 h-2 rounded-full bg-teal-500 mr-2" />Chave ativa{empresa?.apiKeyGeradaEm ? ` desde ${new Date(empresa.apiKeyGeradaEm).toLocaleDateString('pt-BR')}` : ''}.</p>}
        {chave && (
          <div className="bg-teal-500/10 rounded-xl p-4 mt-3">
            <p className="text-xs font-bold text-ink mb-2">Copie agora — ela não aparece de novo.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-xs bg-white border border-line rounded-lg px-3 py-2 break-all">{chave}</code>
              <button onClick={() => { void navigator.clipboard.writeText(chave); setCopiado(true); }} className="rounded-lg border border-line text-xs font-bold px-3 py-2">{copiado ? 'Copiado!' : 'Copiar'}</button>
            </div>
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={() => void gerar()} disabled={ocupado} className="rounded-xl bg-gradient-to-br from-teal-500 to-blue-600 text-white text-sm font-bold px-4 py-2.5 disabled:opacity-60">{ativa ? 'Gerar nova chave' : 'Gerar chave de API'}</button>
          {ativa && <button onClick={() => void revogar()} disabled={ocupado} className="rounded-xl border border-line text-sm font-bold px-4 py-2.5">Revogar</button>}
        </div>
        {erro && <p className="text-xs text-red-500 mt-2">{erro}</p>}
      </div>
      <div className="bg-white border border-line rounded-2xl p-5">
        <h3 className="text-xs font-bold text-ink-soft uppercase tracking-wide mb-3">O que a API faz</h3>
        <div className="divide-y divide-line">
          {rotas.map(([m, r, d]) => (
            <div key={m + r} className="py-2 flex gap-3 items-start text-sm">
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded mt-0.5 ${m === 'GET' ? 'bg-blue-600/10 text-blue-700' : 'bg-teal-500/10 text-teal-700'}`}>{m}</span>
              <div><code className="text-xs text-ink">{r}</code><div className="text-xs text-ink-soft">{d}</div></div>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-soft mt-3">Envie o cabeçalho <code className="bg-surface rounded px-1">X-Api-Key</code>. Endereço base: <code className="bg-surface rounded px-1">{BASE}</code></p>
        <pre className="text-[11px] bg-ink text-white rounded-xl p-4 overflow-x-auto mt-3">{exemplo}</pre>
      </div>
    </div>
  );
}
