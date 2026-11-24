const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '../..');

test('motor funciona para os 44 heróis mesmo com ICU/Intl indisponível', () => {
  const context = vm.createContext({});
  vm.runInContext('globalThis.Intl = undefined; Number.prototype.toLocaleString = function () { throw new TypeError("Internal error. Icu error."); };', context);
  vm.runInContext(fs.readFileSync(path.join(repo, 'simulador/dados.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(repo, 'simulador/motor.js'), 'utf8'), context);
  const results = vm.runInContext(`DADOS.herois.map(h => {
    const r = recomendar({ jogador: h.nome, modelo: DADOS.modelos[h.nome], catalogo: DADOS.itens,
      aliados: [], inimigos: [], inventario: new Set() });
    return { nome: h.nome, item: r.itens[0].nome, motivo: r.itens[0].motivo };
  })`, context);
  assert.equal(results.length, 44);
  for (const result of results) assert(result.item && result.motivo, result.nome);
});
