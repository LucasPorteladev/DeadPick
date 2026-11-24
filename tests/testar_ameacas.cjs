const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { analisarAmeacas, recomendar } = require('../simulador/motor.js');
const data = vm.runInNewContext(fs.readFileSync('simulador/dados.js', 'utf8') + ';DADOS');

function fixture() {
  const herois = Array.from(data.herois, h => h.nome);
  const inimigos = ['Vindicta', 'Grey Talon', 'Mirage', 'Venator', 'Haze', 'Holliday'];
  const aliados = herois.filter(h => h !== 'Paradox' && !inimigos.includes(h)).slice(0, 5);
  const n = herois.length, coeficientes = Array(3*n+3).fill(0);
  for (const h of inimigos) coeficientes[n+herois.indexOf(h)] = .5;
  const modeloAmeacas = { versao: 1, herois, mediasInimigos: Array(n).fill(6/n), itens: [{
    nome: 'Metal Skin', tipo: 'fisica', contextoValidado: true, compradoresPorHeroi: { Paradox: 30 },
    intercepto: -4, coeficientes }] };
  const modelo = { participacoes: 100, perfis: [{ id: 0, participacoes: 100, itens: [
    { nome: 'Restorative Shot', frequencia: 1, segundo: 30 },
    { nome: 'High-Velocity Rounds', frequencia: 1, segundo: 90 },
    { nome: 'Long Range', frequencia: .9, segundo: 200 }
  ] }] };
  return { jogador: 'Paradox', aliados, inimigos, modeloAmeacas, modelo, catalogo: data.itens,
    inventario: new Set(['Restorative Shot', 'High-Velocity Rounds']), minuto: 16, almas: 10000 };
}

test('ameaça exige composição completa, modelo validado e suporte no herói comprador', () => {
  const f = fixture();
  assert.equal(analisarAmeacas(f).candidatos[0].nome, 'Metal Skin');
  assert.equal(analisarAmeacas({ ...f, inimigos: f.inimigos.slice(0, 5) }).candidatos.length, 0);
  assert.equal(analisarAmeacas({ ...f, aliados: [] }).candidatos.length, 0);
  assert.equal(analisarAmeacas({ ...f, inimigos: f.inimigos.map(() => 'Haze') }).candidatos.length, 0);
  f.modeloAmeacas.itens[0].contextoValidado = false;
  assert.equal(analisarAmeacas(f).candidatos.length, 0);
  f.modeloAmeacas.itens[0].contextoValidado = true;
  f.modeloAmeacas.itens[0].compradoresPorHeroi.Paradox = 9;
  assert.equal(analisarAmeacas(f).candidatos.length, 0);
});

test('defesa fora do filtro de popularidade entra sem virar primeiro counter na abertura', () => {
  const f = fixture();
  assert(!f.modelo.perfis[0].itens.some(i => i.nome === 'Metal Skin'));
  const r = recomendar(f);
  assert.equal(r.itens[0].nome, 'Metal Skin');
  assert.equal(r.itens.filter(i => i.contextual).length, 1);
  assert(r.itens[0].evidencia.probabilidade > r.itens[0].evidencia.referencia);
  for (const override of [{ minuto: 0 }, { inventario: new Set() }, { almas: null }, { almas: 0 }]) {
    assert(!recomendar({ ...f, ...override }).itens.some(i => i.contextual));
  }
});

test('proteção existente bloqueia empilhamento da mesma camada; física e espiritual são distintas', () => {
  const f = fixture(); f.inventario.add('Metal Skin');
  assert(!recomendar(f).situacionais.some(i => i.evidencia?.tipo === 'fisica'));
  const espiritual = { ...f.modeloAmeacas.itens[0], nome: 'Spellbreaker', tipo: 'espiritual' };
  f.modeloAmeacas.itens.push(espiritual); f.minuto = 25;
  assert.equal(recomendar(f).itens.find(i => i.contextual).nome, 'Spellbreaker');
});

test('sem espaço não propõe compra que exigiria venda não planejada', () => {
  const f = fixture();
  for (const i of Object.values(data.itens)) {
    if (f.inventario.size === 12) break;
    if (i.nome !== 'Metal Skin') f.inventario.add(i.nome);
  }
  const r = recomendar(f);
  const defense = r.situacionais.find(i => i.nome === 'Metal Skin');
  assert(defense.restricoes.some(s => s.includes('inventário cheio')));
  assert(!r.itens.some(i => i.contextual));
});

test('mudar os demais inimigos altera a decisão mesmo mantendo um herói da associação', () => {
  const f = fixture();
  const outros = f.modeloAmeacas.herois.filter(h => h !== f.jogador && !f.aliados.includes(h) && !f.inimigos.includes(h)).slice(0, 5);
  assert.equal(analisarAmeacas(f).candidatos.length, 1);
  assert.equal(analisarAmeacas({ ...f, inimigos: [f.inimigos[0], ...outros] }).candidatos.length, 0);
});

test('modelo real é íntegro e preserva uma única promoção e a abertura para os 44 heróis', () => {
  const learned = data.ameacas;
  assert(learned && learned.itens.some(i => i.contextoValidado));
  assert.equal(learned.balanceVersion, data.versao);
  for (const item of learned.itens) {
    assert.equal(item.coeficientes.length, 3*learned.herois.length+3);
    assert(item.coeficientes.every(Number.isFinite));
  }
  let promoted = 0;
  for (const jogador of learned.herois) {
    const inimigos = ['Haze', 'Vyper', 'Wraith', 'Vindicta', 'Venator', 'Silver'].filter(h => h !== jogador);
    for (const h of learned.herois) if (inimigos.length < 6 && h !== jogador && !inimigos.includes(h)) inimigos.push(h);
    const aliados = learned.herois.filter(h => h !== jogador && !inimigos.includes(h)).slice(0, 5);
    const modelo = data.modelos[jogador];
    const selected = [...modelo.perfis].sort((a, b) => b.participacoes-a.participacoes)[0];
    const opening = selected.itens.filter(i => i.frequencia >= .45 && i.segundo !== null &&
      !['Healbane', 'Reactive Barrier', 'Counterspell'].includes(i.nome)).sort((a, b) => a.segundo-b.segundo).slice(0, 2);
    const args = { jogador, modelo, catalogo: data.itens, aliados, inimigos, modeloAmeacas: learned,
      inventario: new Set(opening.map(i => i.nome)), minuto: 25, almas: 10000 };
    const result = recomendar(args);
    assert(result.itens.filter(i => i.contextual).length <= 1, jogador);
    assert.equal(new Set(result.itens.map(i => i.nome)).size, result.itens.length, jogador);
    if (result.itens.some(i => i.evidencia)) promoted++;
    assert(!recomendar({ ...args, minuto: 0, inventario: new Set() }).itens.some(i => i.contextual), jogador);
  }
  assert(promoted > 0, 'Modelo não está alcançando nenhuma compra defensiva');
});
