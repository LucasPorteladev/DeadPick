const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const engine=require('../../simulador/motor.js');
const runtime=require('../src/panorama/scripts/deadpick_runtime.js');
const d=vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../simulador/dados.js'),'utf8')+';DADOS');

test('348 indicações chegam ao motor sem corte de amostra ou maioria',()=>{
  let n=0;
  for(const [jogador,h] of Object.entries(d.imbuimentos.herois)) for(const [nome,choice] of Object.entries(h.itens)){
    const modelo={participacoes:1,perfis:[{id:0,participacoes:1,itens:[{nome,segundo:10,frequencia:1}]}]};
    const result=engine.recomendar({jogador,modelo,catalogo:d.itens,aliados:[],inimigos:[],inventario:new Set(),modeloImbuimentos:d.imbuimentos});
    assert.deepEqual(result.itens.find(i=>i.nome===nome).imbuimento,choice);
    n++;
  }
  assert.equal(n,348);
});

test('HUD e motor usam a escolha do herói/item; ausência de dados não usa outro item ou herói',()=>{
  const jogador='Paradox',nome='Compress Cooldown';
  const native={...d,herois:[{id:10,nome:jogador}],modelos:{[jogador]:{participacoes:1,perfis:[{id:0,participacoes:1,itens:[{nome,segundo:10,frequencia:1}]}]}}};
  const state={heroId:10,modo:'partida',localConfirmado:true,clock:{seconds:300},inventario:{nomes:[],completo:true,estruturaCompleta:true,fontes:2,slotsDisponiveis:12,desconhecidos:[]},aliados:[],inimigos:[],almas:5000};
  assert.equal(runtime.buildView(state,native,engine).itens[0].imbuimento.slot,3);
  const missing={...native,imbuimentos:{herois:{Abrams:d.imbuimentos.herois.Abrams}}};
  assert.equal(runtime.buildView(state,missing,engine).itens[0].imbuimento,null);
});
