// IA supervisora do Fluxa Chat.
// Só OBSERVA: lê a conversa e grava uma SUGESTÃO de resposta em
// empresas/{id}/conversas/{conversa}/supervisora/atual. Nunca envia mensagem.
// Usa a Anthropic como principal e, se ela falhar (ex.: sem crédito), o Gemini (plano gratuito) como reserva.
// Desligada enquanto não houver ANTHROPIC_API_KEY nem GEMINI_API_KEY no servidor.
import { BASE_SUPERVISORA } from './supervisora-base.js';

const CHAVE = process.env.ANTHROPIC_API_KEY || '';
const CHAVE_GEMINI = process.env.GEMINI_API_KEY || '';
const MODELOS_GEMINI = (process.env.GEMINI_MODELO || 'gemini-flash-lite-latest,gemini-flash-latest').split(',').map((m) => m.trim()).filter(Boolean); // o primeiro que tiver cota grátis responde
const CHAVE_GROQ = process.env.GROQ_API_KEY || ''; // grátis: console.groq.com
const MODELO_GROQ = process.env.GROQ_MODELO || 'llama-3.3-70b-versatile';
const CHAVE_OPENROUTER = process.env.OPENROUTER_API_KEY || ''; // grátis (modelos ':free'): openrouter.ai
const MODELO_OPENROUTER = process.env.OPENROUTER_MODELO || 'meta-llama/llama-3.3-70b-instruct:free';
const MODELO = process.env.SUPERVISORA_MODELO || 'claude-sonnet-5-5';
const ESPERA_MS = Number(process.env.SUPERVISORA_ESPERA_S || 8) * 1000; // espera o cliente terminar de escrever
const MAX_MSGS = 24;

export function criarSupervisora({ base, agora }) {
  const ligada = !!CHAVE || !!CHAVE_GEMINI || !!CHAVE_GROQ || !!CHAVE_OPENROUTER;
  // Contexto da empresa (nome + resumo do cadastro): cada empresa tem o seu, a base de vendas é a mesma.
  let ctxEmpresa = { em: 0, texto: '' };
  async function sistema() {
    if (Date.now() - ctxEmpresa.em > 600000) {
      try {
        const e = (await base.get()).data() ?? {};
        const linhas = [
          e.nome && `Nome da empresa: ${e.nome}`,
          e.segmento && `Segmento: ${e.segmento}`,
          e.atividadePrincipal && `Atividade principal: ${e.atividadePrincipal}`,
          e.sobreEmpresa && `Resumo escrito pelo dono: ${e.sobreEmpresa}`,
        ].filter(Boolean);
        ctxEmpresa = { em: Date.now(), texto: linhas.length ? `\n\n## Sobre ESTA empresa (vale mais que qualquer exemplo acima)\n${linhas.join('\n')}\nAdapte o tom, os produtos e os exemplos a esta empresa; se ela não vende semijoias, ignore as referências a semijoias.\n` : '' };
      } catch {
        /* usa o último contexto conhecido */
      }
    }
    return BASE_SUPERVISORA + ctxEmpresa.texto;
  }
  const timers = new Map();
  const emAnalise = new Set();

  if (ligada) console.log(`[supervisora] ligada (${CHAVE ? `Anthropic ${MODELO}` : 'sem Anthropic'}${CHAVE_GEMINI ? `; Gemini ${MODELOS_GEMINI.join('/')}` : ''}${CHAVE_GROQ ? `; Groq ${MODELO_GROQ}` : ''}${CHAVE_OPENROUTER ? `; OpenRouter ${MODELO_OPENROUTER}` : ''}).`);
  else console.log('[supervisora] desligada: falta uma chave (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY ou ANTHROPIC_API_KEY).');

  function extrairJson(texto) {
    const ini = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');
    if (ini < 0 || fim < 0) throw new Error('resposta sem JSON');
    return JSON.parse(texto.slice(ini, fim + 1));
  }

  async function chamarGemini(contexto, modeloGemini) {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modeloGemini}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': CHAVE_GEMINI },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: await sistema() }] },
        contents: [{ role: 'user', parts: [{ text: contexto }] }],
        generationConfig: { maxOutputTokens: 900, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    const texto = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return { dado: extrairJson(texto), uso: { input_tokens: j.usageMetadata?.promptTokenCount, output_tokens: j.usageMetadata?.candidatesTokenCount }, modelo: `gemini:${modeloGemini}` };
  }

  // Groq e OpenRouter falam o mesmo formato (OpenAI) e têm camada gratuita.
  async function chamarOpenAI(url, chave, modelo, nome, contexto) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: await sistema() }, { role: 'user', content: contexto }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) throw new Error(`${nome} ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    const texto = j.choices?.[0]?.message?.content || '';
    return { dado: extrairJson(texto), uso: { input_tokens: j.usage?.prompt_tokens, output_tokens: j.usage?.completion_tokens }, modelo: `${nome}:${modelo}` };
  }

  // Quem deu limite (429) descansa 5 minutos, para não ficar batendo na porta.
  const descanso = new Map();
  async function chamarIA(contexto) {
    const tentativas = [];
    if (CHAVE) tentativas.push(['anthropic', async () => ({ ...(await chamarAnthropic(contexto)), modelo: MODELO })]);
    if (CHAVE_GEMINI) for (const m of MODELOS_GEMINI) tentativas.push([`gemini:${m}`, () => chamarGemini(contexto, m)]);
    if (CHAVE_GROQ) tentativas.push(['groq', () => chamarOpenAI('https://api.groq.com/openai/v1/chat/completions', CHAVE_GROQ, MODELO_GROQ, 'groq', contexto)]);
    if (CHAVE_OPENROUTER) tentativas.push(['openrouter', () => chamarOpenAI('https://openrouter.ai/api/v1/chat/completions', CHAVE_OPENROUTER, MODELO_OPENROUTER, 'openrouter', contexto)]);
    let ultimo = new Error('nenhuma IA configurada');
    for (const [nome, fn] of tentativas) {
      if ((descanso.get(nome) || 0) > Date.now()) continue;
      try {
        return await fn();
      } catch (e) {
        ultimo = e;
        if (/ 429|quota|RESOURCE_EXHAUSTED|credit/i.test(e.message)) descanso.set(nome, Date.now() + 5 * 60 * 1000);
        console.warn(`[supervisora] ${nome} falhou (${e.message.slice(0, 90)}); tentando a próxima.`);
      }
    }
    throw ultimo;
  }

  async function chamarAnthropic(contexto) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': CHAVE, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 900,
        system: [{ type: 'text', text: await sistema(), cache_control: { type: 'ephemeral' } }],
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
