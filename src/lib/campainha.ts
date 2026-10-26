// Campainha curta (dois tons), igual à notificação de mensagem do Chat. O navegador só libera som após o primeiro clique na página.
let ctx: AudioContext | null = null;
function destravar() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* sem áudio */
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', destravar);
  window.addEventListener('keydown', destravar);
}
export function tocarCampainhaVenda() {
  try {
    destravar();
    if (!ctx || ctx.state !== 'running') return;
    [880, 1318, 1760].forEach((freq, i) => {
      const t0 = ctx!.currentTime + i * 0.16;
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.65);
    });
  } catch {
    /* sem áudio */
  }
}
