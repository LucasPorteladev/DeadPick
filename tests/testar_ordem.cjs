const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { recomendar, efetuarCompra } = require('../simulador/motor.js');
const data = vm.runInNewContext(fs.readFileSync('simulador/dados.js', 'utf8') + ';DADOS');
function args() {
  const itens = [
    ['High-Velocity Rounds', 30, 1], ['Restorative Shot', 60, 1], ['Rapid Rounds', 400, 1],
    ['Extra Spirit', 800, 1], ['Extended Magazine', 100, .3], ['Titanic Magazine', 1200, 1]
  ].map(([nome, segundo, frequencia]) => ({ nome, segundo, frequencia }));
  return { jogador: 'Vindicta', modelo: { participacoes: 100, perfis: [{ id: 0, participacoes: 100, itens }] },
    catalogo: data.itens, aliados: [], inimigos: [], minuto: 12, almas: 2000,
    inventario: new Set(['High-Velocity Rounds', 'Restorative Shot', 'Extended Magazine']) };
}

test('conclusão barata avança pelo custo restante sem saltar sempre à frente de outras compras', () => {
  const f = args(), r = recomendar(f), names = r.itens.map(i => i.nome);
  const upgrade = r.itens.find(i => i.nome === 'Titanic Magazine');
  assert.equal(upgrade.custoCompra, 800); assert.equal(upgrade.ordemEfetiva, 600);
  assert(names.indexOf('Rapid Rounds') < names.indexOf('Titanic Magazine'));
  assert(names.indexOf('Titanic Magazine') < names.indexOf('Extra Spirit'));
  assert(upgrade.evolucaoEconomica);
});

test('sem abertura, componente equipado ou saldo conhecido suficiente não adianta a evolução', () => {
  const f = args();
  for (const override of [{ almas: 799 }, { inventario: new Set(['Extended Magazine']) },
    { inventario: new Set(['High-Velocity Rounds', 'Restorative Shot']) }]) {
    const item = recomendar({ ...f, ...override }).itens.find(i => i.nome === 'Titanic Magazine');
    assert.equal(item.evolucaoEconomica, false);
    assert.equal(item.ordemEfetiva, item.ordem);
  }
});

test('componente não observado prepara a evolução na fase correta; não cai no início artificialmente', () => {
  const f = args(); f.inventario = new Set();
  f.modelo.perfis[0].itens = f.modelo.perfis[0].itens.filter(i => i.nome !== 'Extended Magazine');
  const r = recomendar(f), c = r.itens.find(i => i.nome === 'Extended Magazine');
  assert.equal(c.ordem, 1200); assert.equal(c.fase, 2);
  assert(r.itens.findIndex(i => i.nome === 'Extra Spirit') < r.itens.indexOf(c));
  assert(r.itens.indexOf(c) < r.itens.findIndex(i => i.nome === 'Titanic Magazine'));
});

test('44 heróis: sem inversão temporal na abertura e progressão termina usando inventário atual', () => {
  for (const [jogador, modelo] of Object.entries(data.modelos)) {
    const base = { jogador, modelo, catalogo: data.itens, aliados: [], inimigos: [] };
    const start = recomendar({ ...base, inventario: new Set() });
    for (let i = 1; i < start.itens.length; i++) assert(start.itens[i].ordemEfetiva >= start.itens[i-1].ordemEfetiva, jogador);
    let inventario = new Set(), done = false;
    for (let step = 0; step < 100; step++) {
      const r = recomendar({ ...base, inventario, historico: inventario, minuto: 25, almas: 10000 });
      if (!r.itens.length) { done = true; break; }
      inventario = efetuarCompra({ nome: r.itens[0].nome, catalogo: data.itens, inventario, historico: inventario }).inventario;
    }
    assert(done, jogador+' não termina');
  }
});
