const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const e=require('../../simulador/motor.js');
const d=vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../simulador/dados.js'),'utf8')+';DADOS');
function args(h,inv=new Set(),cap=12){return {jogador:h,modelo:d.modelos[h],catalogo:d.itens,inventario:inv,aliados:[],inimigos:[],minuto:35,limiteSlots:cap,almas:100000};}
function progress(h,cap=12,modelo=d.modelos[h]){let inv=new Set(),hist=new Set(),seq=[];for(let n=0;n<180;n++){
  const r=e.recomendar({...args(h,inv,cap),modelo,historico:hist});
  assert(r.slotsPlanejados<=cap,h+': plano excedeu capacidade');
  if(!r.itens.length)return {inv,seq};
  seq.push(r.itens[0].nome);
  const b=e.efetuarCompra({nome:seq.at(-1),catalogo:d.itens,inventario:inv,historico:hist,limiteSlots:cap});
  inv=b.inventario;hist=b.historico;assert(inv.size<=cap,h);
}throw Error('Fila não termina: '+h);}

test('44 heróis: compras e slots são distintos, progressão termina sem exceder capacidade',()=>{
  let completos=0;
  for(const h of Object.keys(d.modelos)){
    const {inv,seq}=progress(h);
    if(inv.size===12)completos++;
    assert(seq.length>=inv.size,h);
    assert.equal(new Set(seq).size,seq.length,'Sem recompra espúria: '+h);
    progress(h,8);
  }
  assert.equal(completos,43,'O recorte atual só oferece continuação qualificada até 10 slots para Dynamo');
});

test('os 102 perfis também terminam com dependências cobertas e no máximo 12 slots',()=>{
  let perfis=0;
  for(const [h,modelo] of Object.entries(d.modelos))for(const p of modelo.perfis){
    const r=progress(h,12,{...modelo,perfis:[p]});
    assert(r.inv.size<=12);assert.equal(new Set(r.seq).size,r.seq.length,h+' perfil '+p.id);
    perfis++;
  }
  assert.equal(perfis,102);
});

test('Mina, Abrams, Apollo e Baba continuam até 12 e concluem evoluções recuperadas',()=>{
  const expected={Abrams:['Point Blank','Crushing Fists'],Apollo:['Greater Expansion'],Baba:['Rapid Recharge']};
  for(const h of ['Mina','Abrams','Apollo','Baba','Paradox']){
    const r=progress(h);assert.equal(r.inv.size,12,h);
    for(const nome of expected[h]||[])assert(r.inv.has(nome),h+': '+nome);
  }
});

test('núcleo com 20 transações e 10 cadeias não é truncado em 18 compras',()=>{
  const catalogo={},itens=[];
  for(let i=0;i<10;i++){
    const base='Base'+i,upgrade='Final'+i;
    catalogo[base]={nome:base,custo:800,tier:1,componentes:[]};
    catalogo[upgrade]={nome:upgrade,custo:1600,tier:2,componentes:[base]};
    itens.push({nome:base,frequencia:1,segundo:i*200},{nome:upgrade,frequencia:1,segundo:i*200+100});
  }
  const modelo={participacoes:100,perfis:[{id:0,participacoes:100,itens}]};
  const r=e.recomendar({jogador:'Teste',modelo,catalogo,inventario:new Set(),aliados:[],inimigos:[]});
  assert.equal(r.itens.length,20);assert.equal(r.slotsPlanejados,10);
  assert(r.itens.some(i=>i.nome==='Final9'));
});

test('histórico de componente consumido não bloqueia sua volta após retirada da evolução',()=>{
  const base={...args('Pocket'),historico:new Set(['Monster Rounds','Cultist Sacrifice'])};
  const a=e.recomendar(base),b=e.recomendar({...base,historico:new Set()});
  assert.deepEqual(a.itens.map(i=>i.nome),b.itens.map(i=>i.nome));
  assert(a.itens.some(i=>i.nome==='Monster Rounds'));
  const evolved=e.recomendar({...base,inventario:new Set(['Cultist Sacrifice'])});
  assert(!evolved.itens.some(i=>i.nome==='Monster Rounds'));
});

test('sem candidatos qualificados não inventa itens para preencher vagas',()=>{
  const catalogo={A:{nome:'A',custo:800,tier:1,componentes:[]},B:{nome:'B',custo:1600,tier:2,componentes:['A']},C:{nome:'C',custo:6400,tier:4,componentes:[]}};
  const modelo={participacoes:100,perfis:[{id:0,participacoes:100,itens:[{nome:'A',frequencia:1,segundo:10},{nome:'B',frequencia:1,segundo:100},{nome:'C',frequencia:.1,segundo:1500}]}]};
  const r=e.recomendar({jogador:'Teste',modelo,catalogo,inventario:new Set(['B']),historico:new Set(['A','B']),aliados:[],inimigos:[]});
  assert.equal(r.slotsPlanejados,1);assert.equal(r.itens.length,0);
});
