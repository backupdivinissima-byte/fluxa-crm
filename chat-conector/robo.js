// Robô de vigilância do Fluxa Chat — roda DENTRO do conector, 24 h por dia.
//
// O que ele faz:
//  1. Vigia a conexão: se o WhatsApp parou de responder, reconecta sozinho.
//  2. Faz um teste de ida e volta de tempos em tempos (manda uma mensagem para o
//     próprio número, confere se o WhatsApp confirmou, se chegou no celular e se o
//     banco do Fluxa gravou e leu), e apaga a mensagem de teste em seguida.
//  3. Reenvia sozinho as mensagens da plataforma que falharam por queda de conexão.
//  4. Confere se as mensagens enviadas pela plataforma foram confirmadas pelo WhatsApp.
//  5. Conta as falhas de criptografia (Bad MAC etc.): se virarem enxurrada, reconecta;
//     se continuarem, avisa na plataforma que é preciso gerar um QR Code novo.
//  6. Publica o estado de saúde em chatConexoes/whatsapp.saude (aparece no Chat).
//
// O que ele NÃO faz sozinho: apagar a sessão e gerar QR novo (precisa do celular).
import { FieldValue } from 'firebase-admin/firestore';

const MIN = 60 * 1000;
const HORA = 60 * MIN;

export function criarRobo({ refConexao, base, getSock, estaAberto, reconectar, reenviar, reenviarTexto, soDigitos, agora }) {
  const eventos = { recebidas: [], enviadas: [], errosGravacao: [], errosDecifrar: [], quedas: [], semConfirmacao: [], reconexoesRobo: [], recuperadas: [], pedidosReenvio: [] };
  const ultimas = { recebida: 0, enviada: 0 };
  const testes = new Set(); // ids das mensagens de teste (não vão para a plataforma)
  const confirmacoes = new Map(); // id da mensagem -> { status, aguardando }
  const envios = new Map(); // id enviado pela plataforma -> { conversaId, msgId, em }
  let abertoDesde = 0;
  let ultimoTeste = null;
  let testesSeguidosComFalha = 0;
  let ultimaReconexaoRobo = 0;
  let ultimoEstado = '';
  let ultimaPublicacao = 0;

  const marcar = (lista) => lista.push(Date.now());
  const quantos = (lista, ms) => lista.filter((t) => t > Date.now() - ms).length;
  const podar = () => {
    for (const lista of Object.values(eventos)) while (lista.length && lista[0] < Date.now() - 24 * HORA) lista.shift();
  };

  // ---- Ganchos chamados pelo conector -------------------------------------
  const ganchos = {
    conectou() {
      abertoDesde = Date.now();
      // Atualiza o selo logo que a conexão volta (sem esperar o ciclo de 5 min).
      setTimeout(() => void publicar(true), 3000);
    },
    caiu() {
      abertoDesde = 0;
      marcar(eventos.quedas);
      setTimeout(() => void publicar(true), 3000);
    },
    recebida() {
      ultimas.recebida = Date.now();
      marcar(eventos.recebidas);
    },
    erroGravacao() {
      marcar(eventos.errosGravacao);
    },
    erroDecifrar() {
      marcar(eventos.errosDecifrar);
    },
    ehTeste: (id) => testes.has(id),
    /** O WhatsApp pediu o reenvio de uma mensagem (o celular ou o cliente não conseguiu abri-la = "Aguardando mensagem"). */
    pediuReenvio(chave) {
      const id = [...envios.keys()].find((k) => String(chave).startsWith(k));
      if (!id) return;
      const e = envios.get(id);
      e.retries = (e.retries ?? 0) + 1;
      marcar(eventos.pedidosReenvio);
      console.warn(`[robô] WhatsApp pediu reenvio da mensagem ${id} (pedido ${e.retries}).`);
      // 1º pedido: o conector já responde sozinho; o robô, em paralelo, renova a sessão com o contato na hora
      // (assim o reenvio já sai com criptografia nova). 2º pedido: algo está travado -> reenvia o texto.
      if (e.retries === 1) void Promise.resolve(getSock()?.assertSessions?.([e.jid], true)).catch(() => {});
      if (e.retries >= 2) void recuperar(id, 'WhatsApp pediu reenvio repetidas vezes');
    },
    /** Mensagem enviada pela plataforma: acompanha a confirmação do WhatsApp. */
    enviada(id, dados) {
      ultimas.enviada = Date.now();
      marcar(eventos.enviadas);
      if (!id) return;
      envios.set(id, { ...dados, em: Date.now() });
      confirmacoes.set(id, { status: 1 });
      setTimeout(() => void conferirConfirmacao(id), 20 * 1000);
    },
    /** Atualizações de status do WhatsApp (2 = servidor recebeu, 3 = chegou no aparelho, 4 = lida). */
    status(atualizacoes) {
      for (const u of atualizacoes ?? []) {
        const st = u.update?.status;
        const id = u.key?.id;
        if (!id || typeof st !== 'number') continue;
        const atual = confirmacoes.get(id);
        if (atual) atual.status = Math.max(atual.status, st);
        else if (testes.has(id)) confirmacoes.set(id, { status: st });
        const e = envios.get(id);
        if (e && e.msgId && st >= 2 && base) {
          const entrega = st >= 4 ? 'lida' : st >= 3 ? 'entregue' : 'enviada';
          base.collection('conversas').doc(e.conversaId).collection('mensagens').doc(e.msgId).set({ entrega }, { merge: true }).catch(() => {});
        }
      }
    },
  };

  async function conferirConfirmacao(id) {
    const c = confirmacoes.get(id);
    const e = envios.get(id);
    if (!c || !e) return;
    if (c.status < 2) {
      marcar(eventos.semConfirmacao);
      console.warn(`[robô] Mensagem ${id} sem confirmação do WhatsApp em 20 s.`);
      void recuperar(id, 'sem confirmação do WhatsApp em 20 s');
      if (base && e.msgId) base.collection('conversas').doc(e.conversaId).collection('mensagens').doc(e.msgId).set({ entrega: 'sem_confirmacao' }, { merge: true }).catch(() => {});
    }
    // Guarda só o essencial por mais algum tempo para receber o "entregue/lida".
    setTimeout(() => {
      envios.delete(id);
      confirmacoes.delete(id);
    }, 30 * MIN);
  }

  // ---- Ações ---------------------------------------------------------------
  /**
   * Recupera uma mensagem que não chegou ou ficou em "Aguardando mensagem":
   * refaz a sessão de criptografia com o contato e envia o mesmo texto de novo (uma vez só).
   * Mídia e áudio não são reenviados sozinhos (o arquivo não fica na memória): a mensagem fica marcada
   * para a equipe reenviar.
   */
  async function recuperar(id, motivo) {
    const e = envios.get(id);
    if (!e || e.recuperada || !e.msgId) return;
    e.recuperada = true;
    const ref = base.collection('conversas').doc(e.conversaId).collection('mensagens').doc(e.msgId);
    if (quantos(eventos.recuperadas, HORA) >= 30) {
      console.warn('[robô] Limite de recuperações por hora atingido; não vou reenviar mais sozinho.');
      return;
    }
    marcar(eventos.recuperadas);
    const sock = getSock();
    try {
      if (e.tipo !== 'texto' || !e.texto || !e.jid) {
        console.warn(`[robô] Mensagem ${id} (${e.tipo}) pode não ter chegado ao cliente; marcada para a equipe reenviar.`);
        await ref.set({ erroEnvio: 'Pode não ter chegado ao cliente — reenvie esta mensagem.', entrega: 'sem_confirmacao' }, { merge: true });
        return;
      }
      console.warn(`[robô] Recuperando a mensagem ${id}: ${motivo}. Refazendo a sessão com o contato e reenviando.`);
      try {
        await sock?.assertSessions?.([e.jid], true); // força uma sessão de criptografia nova com o contato
      } catch (err) {
        console.warn('[robô] Não consegui refazer a sessão:', err.message);
      }
      await reenviarTexto({ jid: e.jid, texto: e.texto });
      await ref.set({ entrega: 'reenviada_pelo_robo' }, { merge: true });
      console.log(`[robô] Mensagem ${id} reenviada com sessão nova.`);
    } catch (err) {
      console.error(`[robô] Falha ao recuperar a mensagem ${id}:`, err.message);
      await ref.set({ erroEnvio: 'Não consegui reenviar sozinho — reenvie esta mensagem.' }, { merge: true }).catch(() => {});
    }
  }

  function reconectarPeloRobo(motivo) {
    if (Date.now() - ultimaReconexaoRobo < 10 * MIN) return false; // no máximo uma vez a cada 10 min
    ultimaReconexaoRobo = Date.now();
    marcar(eventos.reconexoesRobo);
    console.warn(`[robô] Reconectando o WhatsApp: ${motivo}`);
    reconectar();
    return true;
  }

  async function esperarStatus(id, minimo, ms) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      if ((confirmacoes.get(id)?.status ?? 0) >= minimo) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  /** Teste de ida e volta: usa a conversa "Eu" (mensagem para o próprio número). */
  async function testeIdaEVolta() {
    const sock = getSock();
    if (!sock || !estaAberto() || Date.now() - abertoDesde < 2 * MIN) return;
    const eu = soDigitos(sock.user?.id ?? '');
    if (!eu) return;
    const jid = `${eu}@s.whatsapp.net`;
    const r = { em: agora(), envio: false, noCelular: false, banco: false };
    const t0 = Date.now();
    let chave = null;
    try {
      const enviada = await Promise.race([
        sock.sendMessage(jid, { text: `🤖 Teste automático do Fluxa (${new Date().toISOString().slice(11, 16)} UTC) — pode ignorar` }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('o envio demorou mais de 30 s')), 30000)),
      ]);
      chave = enviada?.key ?? null;
      if (chave?.id) {
        testes.add(chave.id);
        confirmacoes.set(chave.id, { status: 1 });
        r.envio = true; // o WhatsApp aceitou o envio (se falhasse, cairia no catch)
        r.envioMs = Date.now() - t0;
        r.confirmado = await esperarStatus(chave.id, 2, 30000); // o servidor do WhatsApp confirmou
        r.noCelular = r.confirmado && (await esperarStatus(chave.id, 3, 45000)); // chegou no aparelho
      }
    } catch (e) {
      r.erro = e.message;
    }
    try {
      const marca = `t${Date.now()}`;
      await refConexao.set({ saude: { sondaBanco: marca } }, { merge: true });
      const lido = (await refConexao.get()).data()?.saude?.sondaBanco;
      r.banco = lido === marca;
    } catch (e) {
      r.erro = r.erro ?? `banco: ${e.message}`;
    }
    if (chave) {
      // apaga a mensagem de teste para não deixar lixo no celular
      sock.sendMessage(jid, { delete: chave }).catch(() => {});
      setTimeout(() => {
        testes.delete(chave.id);
        confirmacoes.delete(chave.id);
      }, 10 * MIN);
    }
    r.ok = r.envio && r.banco;
    ultimoTeste = r;
    if (r.ok) testesSeguidosComFalha = 0;
    else {
      testesSeguidosComFalha++;
      console.warn(`[robô] Teste de ida e volta FALHOU: ${JSON.stringify(r)}`);
      if (!r.envio) reconectarPeloRobo('o WhatsApp não aceitou a mensagem de teste');
    }
    console.log(`[robô] Teste de ida e volta: envio ${r.envio ? 'ok' : 'FALHOU'}, confirmação ${r.confirmado ? 'ok' : 'não veio'}, celular ${r.noCelular ? 'ok' : 'sem confirmação'}, banco ${r.banco ? 'ok' : 'FALHOU'}.`);
    await publicar(true);
  }

  // ---- Avaliação de saúde --------------------------------------------------
  function avaliar() {
    podar();
    const aberto = estaAberto();
    const decifrar10 = quantos(eventos.errosDecifrar, 10 * MIN);
    const decifrar6h = quantos(eventos.errosDecifrar, 6 * HORA);
    const reconexoes6h = quantos(eventos.reconexoesRobo, 6 * HORA);
    const quedas6h = quantos(eventos.quedas, 6 * HORA);
    const falhasGravacao1h = quantos(eventos.errosGravacao, HORA);
    const semConf24h = quantos(eventos.semConfirmacao, 24 * HORA);

    let nivel = 'ok';
    const avisos = [];
    if (!aberto) {
      nivel = 'problema';
      avisos.push('WhatsApp desconectado — o robô está tentando reconectar.');
    }
    const recuperadas1h = quantos(eventos.recuperadas, HORA);
    if (recuperadas1h > 0) {
      nivel = nivel === 'ok' ? 'atencao' : nivel;
      avisos.push(`O robô recuperou ${recuperadas1h} mensagem(ns) que não chegaram (na última hora).`);
    }
    if (decifrar10 > 200) {
      nivel = nivel === 'ok' ? 'atencao' : nivel;
      avisos.push(`${decifrar10} falhas de criptografia nos últimos 10 min.`);
      if (aberto) reconectarPeloRobo('enxurrada de falhas de criptografia');
    }
    if (reconexoes6h >= 3 && decifrar6h > 1000) {
      nivel = 'problema';
      avisos.push('A sessão do WhatsApp está corrompida. Em Reconectar WhatsApp, gere um QR Code novo e leia no celular.');
    }
    if (quedas6h >= 6) {
      nivel = nivel === 'ok' ? 'atencao' : nivel;
      avisos.push(`A conexão caiu ${quedas6h} vezes nas últimas 6 h.`);
    }
    if (testesSeguidosComFalha >= 3) {
      nivel = 'problema';
      avisos.push('3 testes de ida e volta seguidos falharam. Gere um QR Code novo se não normalizar.');
    } else if (ultimoTeste && !ultimoTeste.ok) {
      nivel = nivel === 'ok' ? 'atencao' : nivel;
      avisos.push('O último teste de ida e volta falhou.');
    }
    if (falhasGravacao1h > 0) {
      nivel = nivel === 'ok' ? 'atencao' : nivel;
      avisos.push(`${falhasGravacao1h} mensagem(ns) não foram gravadas no banco na última hora.`);
    }
    if (semConf24h >= 3) {
      nivel = nivel === 'ok' ? 'atencao' : nivel;
      avisos.push(`${semConf24h} mensagens enviadas sem confirmação do WhatsApp em 24 h.`);
    }
    return {
      nivel,
      mensagem: avisos.length ? avisos.join(' ') : 'Tudo certo: envio e recebimento funcionando.',
      recebidas24h: quantos(eventos.recebidas, 24 * HORA),
      enviadas24h: quantos(eventos.enviadas, 24 * HORA),
      quedas24h: quantos(eventos.quedas, 24 * HORA),
      errosDecifrar10min: decifrar10,
      reconexoesRobo24h: quantos(eventos.reconexoesRobo, 24 * HORA),
      ultimaRecebida: ultimas.recebida ? new Date(ultimas.recebida).toISOString() : null,
      ultimaEnviada: ultimas.enviada ? new Date(ultimas.enviada).toISOString() : null,
      teste: ultimoTeste ? { ...ultimoTeste } : null,
    };
  }

  async function publicar(forcar = false) {
    const s = avaliar();
    const chave = `${s.nivel}|${s.mensagem}`;
    // Só grava quando muda o estado ou a cada 10 min (poupa gravações no banco).
    if (!forcar && chave === ultimoEstado && Date.now() - ultimaPublicacao < 10 * MIN) return;
    ultimoEstado = chave;
    ultimaPublicacao = Date.now();
    s.verificadoEm = agora();
    try {
      await refConexao.set({ saude: s }, { merge: true });
    } catch (e) {
      console.error('[robô] Não consegui publicar a saúde:', e.message);
    }
  }

  // ---- Rotinas -------------------------------------------------------------
  async function vigiarConexao() {
    const sock = getSock();
    // O WhatsApp "aberto" na memória, mas o canal de rede fechado: reconecta.
    if (estaAberto() && sock?.ws && sock.ws.readyState !== undefined && sock.ws.readyState !== 1) {
      reconectarPeloRobo(`canal de rede em estado ${sock.ws.readyState}`);
    }
  }

  async function reenviarFalhas() {
    try {
      const snap = await base.collection('chatSaida').where('enviada', '==', false).get();
      for (const d of snap.docs) {
        const p = d.data().proximaTentativa;
        if (p && new Date(p).getTime() <= Date.now()) void reenviar(d);
      }
    } catch (e) {
      console.error('[robô] Não consegui ler a fila de envio:', e.message);
    }
  }

  const intervaloTeste = Number(process.env.ROBO_TESTE_MIN || 180) * MIN;
  setInterval(() => void vigiarConexao(), 60 * 1000);
  setInterval(() => void reenviarFalhas(), 60 * 1000);
  setInterval(() => void publicar(), 5 * MIN);
  if (intervaloTeste > 0) {
    setInterval(() => void testeIdaEVolta(), intervaloTeste);
    setTimeout(() => void testeIdaEVolta(), 5 * MIN); // primeiro teste logo depois de ligar
  }
  setTimeout(() => void publicar(true), 20 * 1000);

  return { ...ganchos, testeIdaEVolta, publicar, FieldValue };
}
