const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../../simulador/motor.js');
const runtime = require('../src/panorama/scripts/deadpick_runtime.js');
const data = vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../simulador/dados.js'), 'utf8')+';DADOS');
const catalogo = data.itens;
const byName = new Map(Object.values(catalogo).map(i => [i.nome, i]));
function args(jogador, inventario, extra = {}) {
  return { jogador, modelo: data.modelos[jogador], catalogo, inventario, aliados: [], inimigos: [], minuto: 30, almas: 10000, ...extra };
}
function fill(initial, n = 12, excluded = new Set()) {
  const inv = new Set(initial);
  for (const i of byName.values()) {
    if (i.tier <= 4 && !i.componentes.length && !excluded.has(i.nome)) inv.add(i.nome);
    if (inv.size === n) return inv;
  }
  throw Error('Sem itens para preencher a fixture.');
}

test('44 heróis: inventário cheio nunca recomenda ou aceita a 13a peça', () => {
  for (const jogador of Object.keys(data.modelos)) {
    const plan = engine.recomendar(args(jogador, new Set())).itens;
    const inventario = fill([],12,new Set(plan.map(i => i.nome)));
    const before = [...inventario];
    const result = engine.recomendar(args(jogador, inventario));
    for (const i of result.itens) {
      const bought = engine.efetuarCompra({ nome: i.nome, catalogo, inventario });
      assert(bought.inventario.size <= 12, jogador+': '+i.nome);
    }
    const blocked = plan.find(i => !inventario.has(i.nome) && !byName.get(i.nome).componentes.length);
    assert(blocked, jogador);
    assert.throws(() => engine.efetuarCompra({ nome: blocked.nome, catalogo, inventario, almas: 10000 }), /Inventário cheio/);
    assert(!result.itens.some(i => i.nome === blocked.nome));
    assert.deepEqual([...inventario],before,'Rejeição não altera o estado');
  }
});

test('inventário cheio permite evolução que consome um ou dois componentes reais', () => {
  const inventory = fill(['High-Velocity Rounds','Long Range'],12,new Set(['Sharpshooter']));
  const cost = engine.custoCompra('Sharpshooter',catalogo,inventory);
  const after = engine.efetuarCompra({ nome:'Sharpshooter',catalogo,inventario:inventory,almas:cost });
  assert.equal(after.inventario.size,11);
  assert.equal(after.almas,0);
  assert(after.inventario.has('Sharpshooter'));
  assert(!after.inventario.has('High-Velocity Rounds'));
  const single = fill(['Extra Spirit'],12,new Set(['Improved Spirit']));
  assert.equal(engine.efetuarCompra({nome:'Improved Spirit',catalogo,inventario:single}).inventario.size,12);
});

test('evolução transitiva consome ancestral equipado mesmo com capacidade cheia', () => {
  const cat = Object.fromEntries([
    ['A',800,[]],['B',1600,['A']],['C',3200,['B']],['X',800,[]]
  ].map(([nome,custo,componentes]) => [nome,{nome,custo,componentes,tier:1}]));
  const inv = new Set(['A','X']);
  assert.equal(engine.custoCompra('C',cat,inv),2400);
  const after = engine.efetuarCompra({nome:'C',catalogo:cat,inventario:inv,limiteSlots:2,almas:2400});
  assert.deepEqual([...after.inventario],['X','C']);
  assert.equal(after.almas,0);
  const modelo={participacoes:100,perfis:[{id:0,participacoes:100,itens:[{nome:'C',frequencia:1,segundo:100}]}]};
  const result=engine.recomendar({jogador:'Teste',modelo,catalogo:cat,inventario:inv,limiteSlots:2,aliados:[],inimigos:[]});
  assert.deepEqual(result.itens.map(i=>i.nome),['B','C']);
});

test('slots trancados limitam a compra e orçamento insuficiente não modifica inventário', () => {
  const inv=fill(['Extra Spirit'],8,new Set(['Improved Spirit','Extra Regen']));
  assert.throws(()=>engine.efetuarCompra({nome:'Extra Regen',catalogo,inventario:inv,limiteSlots:8}),/Inventário cheio/);
  assert.equal(engine.efetuarCompra({nome:'Improved Spirit',catalogo,inventario:inv,limiteSlots:8}).inventario.size,8);
  const before=[...inv];
  assert.throws(()=>engine.efetuarCompra({nome:'Improved Spirit',catalogo,inventario:inv,limiteSlots:8,almas:0}),/insuficientes/);
  assert.deepEqual([...inv],before);
});

function panel(id='',classes=[],list=[]) {
  return {id,classes,list,text:'',style:{},visible:true,IsValid:()=>true,Children(){return this.list;},
    BHasClass(c){return this.classes.includes(c);},SetHasClass(){},SetImage(){},
    FindChildTraverse(id){for(const p of this.list){if(p.id===id)return p;const child=p.FindChildTraverse(id);if(child)return child;}return null;}};
}
function blank(classes=[]) {return panel('',classes,[panel('modIconContainer')]);}
function item(){return blank(['isTier1','isWeapon','medicBullets']);}
function fixture(slots=[],locked=[]) {
  const owned=panel('ModPurchasedPanelUniversal',[],slots),locks=panel('ModPurchasedPanelUniversalLocked',[],locked);
  const core=panel('',[],[panel('StatsAndModsContainer',[],[panel('LowerLeft',[],[panel('ModsContainer',[],[owned,locks])])])]);
  const registry=[{nome:'Restorative Shot',tier:1,tipo:'weapon',classes:['medicBullets'],imagens:[]}];
  return {core,owned,locks,registry};
}
function read(f){return runtime.readInventory(f.core,f.registry);}
function state(inventario) {return {heroId:10,modo:'partida',modoSuportado:true,localConfirmado:true,clock:{seconds:480},
  inventario,almas:10000,aliados:[],inimigos:[],composicaoCompleta:false};}
const nativeData={...data,herois:[{id:10,nome:'Paradox'}]};

test('um único item reconhecido não confirma estrutura nem apresenta prévia de compras',()=>{
  const f=fixture([item()]),inv=read(f);
  assert.deepEqual(inv.nomes,['Restorative Shot']);
  assert.equal(inv.completo,false);assert.equal(inv.estruturaCompleta,false);
  let calls=0;
  const v=runtime.buildView(state(inv),nativeData,{recomendar(){calls++;throw Error('Não deve calcular estado parcial');}});
  assert.equal(v.inventarioPendente,true);assert.equal(v.itens.length,0);assert.equal(calls,0);
});

test('montagem progressiva: só confirma 12 slots, perde confirmação com fonte removida ou slot extra',()=>{
  const f=fixture([item()]);
  for(let n=1;n<12;n++) {assert.equal(read(f).completo,false);f.owned.list.push(blank());}
  assert.equal(read(f).completo,true);
  f.owned.list.push(blank());assert.equal(read(f).estruturaCompleta,false);
  f.owned.list.pop();f.locks.id='FonteAusente';assert.equal(read(f).completo,false);
});

test('categoria visual Locked não reduz a capacidade de 12 slots',()=>{
  const f=fixture([item(),...Array.from({length:7},()=>blank())],Array.from({length:4},()=>blank(['Locked'])));
  const inv=read(f);
  assert.equal(inv.completo,true);assert.equal(inv.slotsObservados,12);
  assert.equal(inv.marcadoresLocked,4);assert.equal(inv.slotsDisponiveis,12);assert.equal(inv.vazios,11);
  let observed;
  runtime.buildView(state(inv),nativeData,{recomendar(a){observed=a;return engine.recomendar(a);}});
  assert.equal(observed.limiteSlots,12);
});

test('árvore rejeita identidade desconhecida ou duplicada, mas lê itens em ambos os grupos nativos',()=>{
  const f=fixture([item(),...Array.from({length:11},()=>blank())]);
  f.owned.list[1]=blank(['isTier2','isTech']);assert.equal(read(f).completo,false);
  f.owned.list[1]=item();assert.equal(read(f).estruturaCompleta,false);
  f.owned.list=Array.from({length:11},()=>blank());f.locks.list=[item()];
  assert.equal(read(f).completo,true);assert.deepEqual(read(f).nomes,['Restorative Shot']);assert.equal(read(f).slotsOcupados,1);
});

test('perda da estrutura retira sugestões e recuperação ou troca de herói usa o estado novo',()=>{
  const f=fixture([item(),...Array.from({length:11},()=>blank())]);
  assert(runtime.buildView(state(read(f)),nativeData,engine).itens.length);
  f.owned.list=[item()];assert.equal(runtime.buildView(state(read(f)),nativeData,engine).itens.length,0);
  f.owned.list=Array.from({length:12},()=>blank());
  const other={...nativeData,herois:[{id:10,nome:'Pocket'}]};
  const v=runtime.buildView(state(read(f)),other,engine);
  assert.equal(v.hero.nome,'Pocket');assert(v.itens.length);assert.equal(v.previa,false);
});

test('item sem identidade reserva seu slot mesmo na prévia',()=>{
  const inv={nomes:[...fill([],11,new Set(['Extra Regen']))],completo:false,estruturaCompleta:true,slotsDisponiveis:12,
    fontes:2,desconhecidos:[{nomesCandidatos:['Restorative Shot']}]};
  let observed;
  const v=runtime.buildView(state(inv),nativeData,{recomendar(a){observed=a;return engine.recomendar(a);}});
  assert.equal(observed.limiteSlots,11);
  assert(!v.itens.some(i=>i.nome==='Extra Regen'));
  for(const i of v.itens) assert(engine.projetarInventario({nome:i.nome,catalogo,inventario:new Set(inv.nomes),limiteSlots:11}).cabe);
});
