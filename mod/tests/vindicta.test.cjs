const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const engine=require('../../simulador/motor.js');
const runtime=require('../src/panorama/scripts/deadpick_runtime.js');
const d=vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../simulador/dados.js'),'utf8')+';DADOS');
function args(modelo,inv,limiteSlots){return {jogador:'Vindicta',modelo,catalogo:d.itens,inventario:inv,aliados:[],inimigos:[],
  minuto:35,almas:100000,limiteSlots,limiteSlotsPlanejados:12,modeloImbuimentos:d.imbuimentos};}
function untilBlocked(modelo,inv,cap){for(let n=0;n<180;n++){
  const r=engine.recomendar(args(modelo,inv,cap));
  assert.equal(r.slotsPlanejados,12);
  if(!r.itens.length)return{inv,r};
  inv=engine.efetuarCompra({nome:r.itens[0].nome,catalogo:d.itens,inventario:inv,limiteSlots:cap}).inventario;
  assert(inv.size<=cap);
}throw Error('Loop');}
test('Vindicta: os dois perfis planejam 12, param em oito trancados e continuam após desbloqueio',()=>{
  for(const p of d.modelos.Vindicta.perfis){
    const modelo={...d.modelos.Vindicta,perfis:[p]};
    const locked=untilBlocked(modelo,new Set(),8);
    assert.equal(locked.inv.size,8);assert(locked.r.semEspaco);
    const unlocked=untilBlocked(modelo,locked.inv,12);
    assert.equal(unlocked.inv.size,12);
  }
});
test('Mercurial e Quicksilver da Vindicta indicam a terceira habilidade por maior pickrate',()=>{
  const native={...d,herois:[{id:3,nome:'Vindicta'}],modelos:{Vindicta:{participacoes:100,perfis:[{id:0,participacoes:100,
    itens:[{nome:'Quicksilver Reload',frequencia:1,segundo:100},{nome:'Mercurial Magnum',frequencia:1,segundo:200}]}]}}};
  const inv={nomes:['Quicksilver Reload'],completo:true,estruturaCompleta:true,fontes:2,slotsEsperados:12,
    slotsDisponiveis:8,slotsTrancados:4,slotsOcupados:1,desconhecidos:[]};
  const state={heroId:3,modo:'partida',modoSuportado:true,localConfirmado:true,clock:{seconds:1200},inventario:inv,
    almas:10000,aliados:[],inimigos:[],composicaoCompleta:false};
  const view=runtime.buildView(state,native,engine);
  const merc=view.itens.find(i=>i.nome==='Mercurial Magnum');assert(merc);
  assert.equal(merc.imbuimento.slot,3);assert.equal(merc.imbuimento.nome,'Crow Familiar');
  assert.equal(merc.imbuimento.amostras,576);
  assert.equal(d.imbuimentos.herois.Vindicta.itens['Quicksilver Reload'].slot,3);
});
