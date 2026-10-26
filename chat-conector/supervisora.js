// IA supervisora do Fluxa Chat.
// Só OBSERVA: lê a conversa e grava uma SUGESTÃO de resposta em
// empresas/{id}/conversas/{conversa}/supervisora/atual. Nunca envia mensagem.
// Usa a Anthropic como principal e, se ela falhar (ex.: sem crédito), o Gemini (plano gratuito) como reserva.
// Desligada enquanto não houver ANTHROPIC_API_KEY nem GEMINI_API_KEY no servidor.
import { BASE_SUPERVISORA } from './supervisora-base.js';

const CHAVE = process.env.ANTHROPIC_API_KEY || '';
const CHAVE_GEMINI = process.env.GEMINI_API_KEY || '';
const MODELO_GEMINI = process.env.GEMINI_MODELO || 'gemini-flash-latest';
const MODELO = process.env.SUPERVISORA_MODELO || 'claude-sonnet-5-5';
const ESPERA_MS = Number(process.env.SUPERVISORA_ESPERA_S || 8) * 1000; // espera o cliente terminar de escrever
const MAX_MSGS = 24;

export function criarSupervisora({ base, agora }) {
  const ligada = !!CHAVE || !!CHAVE_GEMINI;
  const timers = new Map();
  const emAnalise = new Set();

  if (ligada) console.log(`[supervisora] ligada (${CHAVE ? `Anthropic ${MODELO}` : 'sem Anthropic'}${CHAVE_GEMINI ? `; reserva Gemini ${MODELO_GEMINI}` : ''}).`);
  else console.log('[supervisora] desligada: falta ANTHROPIC_API_KEY ou GEMINI_API_KEY.');

  function extrairJson(texto) {
    const ini = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');
    if (ini < 0 || fim < 0) throw new Error('resposta sem JSON');
    return JSON.parse(texto.slice(ini, fim + 1));
  }

  async function chamarGemini(contexto) {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': CHAVE_GEMINI },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: BASE_SUPERVISORA }] },
        contents: [{ role: 'user', parts: [{ text: contexto }] }],
        generationConfig: { maxOutputTokens: 900, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    const texto = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return { dado: extrairJson(texto), uso: { input_tokens: j.usageMetadata?.promptTokenCount, output_tokens: j.usageMetadata?.candidatesTokenCount }, modelo: `gemini:${MODELO_GEMINI}` };
  }

  async function chamarIA(contexto) {
    if (CHAVE) {
      try {
        return { ...(await chamarAnthropic(contexto)), modelo: MODELO };
      } catch (e) {
        if (!CHAVE_GEMINI) throw e;
        console.warn(`[supervisora] Anthropic falhou (${e.message.slice(0, 80)}); usando Gemini.`);
      }
    }
    return chamarGemini(contexto);
  }

  async function chamarAnthropic(contexto) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': CHAVE, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 900,
        system: [{ type: 'text', text: BASE_SUPERVISORA, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: contexto }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    const texto = (j.content || []).map((p) => p.text || '').join('');
    return { dado: extrairJson(texto), uso: j.usage };
  }

  async function analisar(conversaId) {
    if (!ligada || emAnalise.has(conversaId)) return;
    emAnalise.add(conversaId);
    const ref = base.collection('conversas').doc(conversaId);
    try {
      const conv = (await ref.get()).data();
      if (!conv || conv.ultimaDe !== 'cliente') return; // a equipe já respondeu: nada a sugerir
      const snap = await ref.collection('mensagens').orderBy('em', 'desc').limit(MAX_MSGS).get();
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      const ultima = msgs[msgs.length - 1];
      if (!ultima || ultima.de !== 'cliente') return;
      const linhas = msgs.map((m) => {
        const quem = m.de === 'cliente' ? 'CLIENTE' : `ATENDENTE${m.autor ? ` (${m.autor})` : ''}`;
        const midia = m.midiaTipo ? `[${m.midiaTipo}] ` : '';
        return `${quem}: ${midia}${m.texto || ''}`.trim();
      });
      const contexto =
        `Conversa pelo ${conv.canal || 'whatsapp'} com a cliente "${conv.nome || 'sem nome'}".` +
        `${conv.vendedorNome ? ` Atendente responsável: ${conv.vendedorNome}.` : ' Ainda sem atendente responsável.'}` +
        `${conv.primeiroContato ? ' É o PRIMEIRO contato dela.' : ''}\n\n` +
        `Conversa (da mais antiga para a mais nova):\n${linhas.join('\n')}\n\n` +
        'Sugira a próxima resposta da atendente. Responda só com o JSON pedido.';
      const { dado, uso, modelo } = await chamarIA(contexto);
      await ref.collection('supervisora').doc('atual').set({
        estagio: String(dado.estagio || ''),
        leitura: String(dado.leitura || ''),
        tecnica: String(dado.tecnica || ''),
        sugestao: String(dado.sugestao || ''),
        alternativa: String(dado.alternativa || ''),
        atencao: String(dado.atencao || ''),
        dica: String(dado.dica || ''),
        paraMensagem: ultima.id,
        modelo,
        geradoEm: agora(),
        tokensEntrada: uso?.input_tokens ?? null,
        tokensSaida: uso?.output_tokens ?? null,
        erro: '',
      });
    } catch (e) {
      console.error(`[supervisora] Falha ao analisar ${conversaId}:`, e.message);
      await ref.collection('supervisora').doc('atual').set({ erro: e.message.slice(0, 200), geradoEm: agora() }, { merge: true }).catch(() => {});
    } finally {
      emAnalise.delete(conversaId);
    }
  }

  return {
    ligada,
    /** Chamado quando chega mensagem de cliente. Junta rajadas: analisa só depois de uns segundos de silêncio. */
    mensagemDoCliente(conversaId) {
      if (!ligada) return;
      clearTimeout(timers.get(conversaId));
      timers.set(
        conversaId,
        setTimeout(() => {
          timers.delete(conversaId);
          void analisar(conversaId);
        }, ESPERA_MS)
      );
    },
  };
}
