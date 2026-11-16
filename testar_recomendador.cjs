const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { recomendar, custoCompra, efetuarCompra } = require('./simulador/simulador.js');
const dados = vm.runInNewContext(fs.readFileSync('simulador/dados.js', 'utf8') + '\nDADOS');
const itens = new Map(Object.values(dados.itens).map(i => [i.nome, i]));
const cenarios = [[], ['Abrams', 'Kelvin', 'Dynamo', 'Bebop', 'Vindicta', 'Grey Talon'], ['Haze', 'Wraith', 'Paige', 'Rem', 'Ivy', 'Nurse Harrow']];
let testes = 0;
for (const h of dados.herois) {
  for (const inimigos of cenarios) {
    let inventario = new Set();
    let historico = new Set();
    let terminou = false;
    for (let passo = 0; passo < 70; passo++) {
      const r = recomendar({ jogador: h.nome, modelo: dados.modelos[h.nome], catalogo: dados.itens,
        aliados: [], inimigos, adversariosLane: inimigos.slice(0, 2), inventario, historico });
      assert(r.perfil, `${h.nome}: sem perfil`);
      if (!r.itens.length) { terminou = true; break; }
      assert.equal(new Set(r.itens.map(i => i.nome)).size, r.itens.length);
      for (const [pos, i] of r.itens.entries()) {
        assert(itens.has(i.nome), `${h.nome}: item desconhecido ${i.nome}`);
        assert(!inventario.has(i.nome), `${h.nome}: recompra indevida`);
        for (const c of itens.get(i.nome).componentes) {
          const j = r.itens.findIndex(x => x.nome === c);
          assert(j === -1 || j < pos, `${h.nome}: componente depois do upgrade`);
        }
      }
      const novo = efetuarCompra({ nome: r.itens[0].nome, catalogo: dados.itens, inventario, historico });
      inventario = novo.inventario;
      historico = novo.historico;
    }
    assert(terminou, `${h.nome}: fila nao termina`);
    assert(historico.size > 0, `${h.nome}: nenhuma compra`);
    testes++;
  }
}
console.log(`${testes} cenarios passaram: todos os herois, componentes, compras e esgotamento da fila.`);

const base = { jogador: 'Paradox', modelo: dados.modelos.Paradox, catalogo: dados.itens,
  aliados: [], inimigos: ['Kelvin', 'Dynamo'], adversariosLane: ['Kelvin', 'Dynamo'], inventario: new Set() };
const inicial = recomendar({ ...base, minuto: 0, almas: 10000 });
const semContexto = recomendar({ ...base, inimigos: [], adversariosLane: [], minuto: 0, almas: 10000 });
assert.equal(inicial.itens[0].nome, semContexto.itens[0].nome, 'Counter desviou a primeira compra');
assert(inicial.situacionais.length > 0);
assert(inicial.situacionais.every(s => !s.elegivel));
assert(!recomendar({ ...base, minuto: 20, almas: 10000 }).itens.some(i => i.contextual), 'Sem fundacao antecipou counter');
const inicio = new Set(semContexto.itens.slice(0, 2).map(i => i.nome));
const comBase = { ...base, inventario: inicio, historico: inicio };
assert(!recomendar({ ...comBase, minuto: 0, almas: 10000 }).itens.some(i => i.contextual));
assert(!recomendar({ ...comBase, minuto: 8, almas: 0 }).itens.some(i => i.contextual));
assert(!recomendar({ ...comBase, minuto: 8 }).itens.some(i => i.contextual));
const pronto = recomendar({ ...comBase, minuto: 8, almas: 10000 });
assert.equal(pronto.itens[0].nome, 'Healbane');
assert.equal(pronto.itens.filter(i => i.contextual).length, 1);
assert.equal(new Set(pronto.itens.map(i => i.nome)).size, pronto.itens.length);
// Um counter já selecionado por frequência também ganha prioridade, sem duplicação.
const modelo = { participacoes: 100, perfis: [{ id: 0, participacoes: 100, itens: [
  { nome: 'Restorative Shot', frequencia: 1, segundo: 30 },
  { nome: 'High-Velocity Rounds', frequencia: 1, segundo: 90 },
  { nome: 'Long Range', frequencia: .9, segundo: 200 },
  { nome: 'Healbane', frequencia: .7, segundo: 1500 }
] }] };
const duplicado = recomendar({ ...comBase, modelo, minuto: 8, almas: 10000 });
assert.equal(duplicado.itens[0].nome, 'Healbane');
assert.equal(duplicado.itens.filter(i => i.nome === 'Healbane').length, 1);
const inv = new Set(['High-Velocity Rounds', 'Long Range']);
const preco = itens.get('Sharpshooter').custo - [...inv].reduce((s, n) => s + itens.get(n).custo, 0);
assert.equal(custoCompra('Sharpshooter', dados.itens, inv), preco);
const evoluido = efetuarCompra({ nome: 'Sharpshooter', catalogo: dados.itens, inventario: inv, historico: inv, almas: preco + 100 });
assert.deepEqual([...evoluido.inventario], ['Sharpshooter']);
assert.equal(evoluido.historico.size, 3);
assert.equal(evoluido.almas, 100);
assert.throws(() => efetuarCompra({ nome: 'Sharpshooter', catalogo: dados.itens, inventario: inv, almas: preco - 1 }), /insuficientes/);
assert.throws(() => efetuarCompra({ nome: 'Long Range', catalogo: dados.itens, inventario: evoluido.inventario }), /evolução/);
assert.deepEqual([...inv], ['High-Velocity Rounds', 'Long Range'], 'Compra alterou o estado de entrada');
console.log('Regressoes passaram: urgencia, tempo, fundacao, saldo, duplicatas, upgrades e historico separado.');
