// Diagnóstico SOMENTE LEITURA: soma a importação de um mês (AAAA-MM) por vendedor. Uso: node diagnostico-mes.mjs 2026-09
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
initializeApp();
const base = getFirestore().collection('empresas').doc(process.env.EMPRESA_ID);
const mes = process.argv[2];
const snap = await base.collection('clientes').get();
let clientes = 0, comMes = 0, comPorVend = 0, semPorVend = 0, total = 0, totalSemPV = 0, pedidos = 0, semPedidos = 0, somaPV = 0;
const porV = {};
const legadas = {};
for (const d of snap.docs) {
  clientes++;
  const o = d.data().origensImportacao || {};
  const m = o['mes-' + mes];
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('mes-') && v.dtUltCompra?.startsWith(mes)) legadas[k] = (legadas[k] || 0) + (v.totalGeral || 0);
  if (!m) continue;
  comMes++;
  total += m.totalGeral || 0;
  if (m.porVendedor) {
    comPorVend++;
    for (const x of m.porVendedor) { const n = (x.cod || '') + ' - ' + (x.nome || '(sem nome)'); porV[n] = (porV[n] || 0) + x.valor; somaPV += x.valor; pedidos += x.pedidos || 0; }
  } else { semPorVend++; totalSemPV += m.totalGeral || 0; }
  if (m.pedidos === undefined) semPedidos++;
}
console.log('clientes', clientes, 'com origem do mês', comMes, '| com porVendedor', comPorVend, '| sem porVendedor', semPorVend, '(R$', totalSemPV.toFixed(2) + ')');
console.log('total origens mês', total.toFixed(2), '| soma porVendedor', somaPV.toFixed(2), '| pedidos', pedidos, '| origens sem pedidos', semPedidos);
for (const [n, v] of Object.entries(porV).sort((a, b) => b[1] - a[1])) console.log('  ', n, v.toFixed(2));
console.log('origens antigas (por arquivo) com data no mês:', JSON.stringify(Object.fromEntries(Object.entries(legadas).map(([k, v]) => [k.slice(0, 30), +v.toFixed(2)]))));
process.exit(0);
