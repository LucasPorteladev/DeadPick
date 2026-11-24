const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Elemento {
  constructor(tag) {
    this.tag = tag; this.children = []; this.value = ''; this.listeners = {}; this.dataset = {};
    this.classList = { add() {}, remove() {} };
  }
  set textContent(v) { this.texto = String(v); this.children = []; }
  set value(v) { this.valor = String(v); }
  get value() { return this.valor; }
  get textContent() { return (this.texto ?? '') + this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  append(...filhos) { this.children.push(...filhos); }
  replaceChildren(...filhos) { this.texto = ''; this.children = filhos; }
  addEventListener(nome, fn) { (this.listeners[nome] ??= []).push(fn); }
  setAttribute(nome, valor) { this[nome] = valor; }
  querySelector() { return this.children.find(c => c.tag === 'button'); }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  disparar(evento = 'click') {
    if (evento === 'click') assert(!this.disabled, 'Tentou clicar em botão desabilitado');
    (this.listeners[evento] ?? []).forEach(fn => fn({}));
  }
}
const html = fs.readFileSync('simulador/index.html', 'utf8');
const elementos = new Map([...html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)].map(m => {
  const el = new Elemento(m[1]);
  el.value = m[0].match(/\bvalue="([^"]*)"/)?.[1] ?? '';
  return [m[2], el];
}));
const el = id => { assert(elementos.has(id), `Elemento ausente no HTML: ${id}`); return elementos.get(id); };
const contexto = vm.createContext({ document: { getElementById: el, createElement: tag => new Elemento(tag) }, console, Intl });
vm.runInContext(fs.readFileSync('simulador/dados.js', 'utf8'), contexto);
vm.runInContext(fs.readFileSync('simulador/motor.js', 'utf8'), contexto);
vm.runInContext(fs.readFileSync('simulador/simulador.js', 'utf8'), contexto);
const escolher = nome => {
  const botao = el('opcoes').children.find(b => b.textContent === nome);
  assert(botao, `Opção ausente: ${nome}`);
  botao.disparar();
};
escolher('Paradox');
el('opcoes-lane').children[0].disparar();
for (const [i, nome] of ['Kelvin', 'Dynamo'].entries()) {
  el('inimigos').children[0].children[1].children[i].disparar();
  escolher(nome);
}
el('almas').value = '10000'; el('almas').disparar('input');
assert.match(el('detalhe-item').textContent, /Restorative Shot/);
assert.match(el('respostas').textContent, /reavaliar a partir/);
el('comprar').disparar();
el('comprar').disparar();
el('minuto').value = '8'; el('minuto').disparar('input');
assert.match(el('detalhe-item').textContent, /Healbane/);
el('almas').value = '0'; el('almas').disparar('input');
assert.equal(el('comprar').disabled, true);
assert.match(el('custo-proxima').textContent, /Economize mais/);
el('almas').value = '10000'; el('almas').disparar('input');
el('comprar').disparar();
assert.equal(el('almas').value, '8400');
el('desfazer').disparar();
assert.equal(el('almas').value, '10000');
assert.match(el('detalhe-item').textContent, /Healbane/);
el('adicionar-item').disparar();
const sharp = el('opcoes').children.find(b => b.textContent.startsWith('Sharpshooter'));
sharp.disparar();
const atual = el('inventario-atual').textContent;
assert.match(atual, /Sharpshooter/);
assert(!atual.includes('High-Velocity Rounds'), 'Upgrade não consumiu o componente no inventário atual');
assert.equal(el('almas').value, '10000', 'Informar inventário alterou o saldo');
console.log('Interface: tempo e saldo conectados, counters adiados, compras, inventario, upgrades e desfazer passaram.');

el('trocar-heroi').disparar();escolher('Paradox');
el('minuto').value='30';el('minuto').disparar('input');
let viuImbuimento=false;
for(let i=0;i<40;i++){
  el('almas').value='100000';el('almas').disparar('input');
  if(el('proxima').hidden)break;
  if(el('detalhe-item').textContent.includes('Compress Cooldown')){
    assert.match(el('detalhe-item').textContent,/Imbuir: 3 · Kinetic Carbine/);
    viuImbuimento=true;break;
  }
  el('comprar').disparar();
}
assert(viuImbuimento,'Não encontrou a indicação esperada no cenário HTML');
console.log('Indicação de imbuimento por herói/item confirmada no HTML.');
