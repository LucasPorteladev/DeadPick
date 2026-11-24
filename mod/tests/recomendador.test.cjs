const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const runtime = require('../src/panorama/scripts/deadpick_runtime.js');
const engine = require('../../simulador/motor.js');
const html = vm.runInNewContext(fs.readFileSync(path.join(root, 'simulador/dados.js'), 'utf8') + '\nDADOS');
const heroes = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'data/paradox/bruto/catalogo-herois.json.gz'))));
const data = { ...html, herois: heroes.filter(h => html.modelos[h.name]).map(h => ({ id: h.id, nome: h.name, classe: h.class_name })),
  registroInventario: [{ nome: 'Restorative Shot', tier: 1, tipo: 'weapon', imagens: ['images/items/weapon/restorative_shot'], classes: ['medicBullets'] }] };

function panel(id = '', classes = [], list = []) {
  return { id, classes, list, text: '', alive: true, style: {}, attrs: {},
    IsValid() { return this.alive; }, Children() { return this.list; },
    BHasClass(c) { return this.classes.includes(c); },
    GetAttributeString(k, fallback) { return this.attrs[k] || fallback; },
    SetHasClass(k, enabled) { this.classes = this.classes.filter(c => c !== k); if (enabled) this.classes.push(k); },
    SetImage(src) { this.renderedImage = src; },
    SetPanelEvent(event, cb) { this.events = this.events || {}; this.events[event] = cb; },
    FindChildTraverse(id) { for (const p of this.list) { if (p.id === id) return p; const result = p.FindChildTraverse(id); if (result) return result; } return null; }
  };
}
function fixture() {
  const clock = panel('GameTime'); clock.text = '0:39';
  const badge = panel('HeroBadge'); badge.heroid = 10;
  const local = panel('', ['LocalPlayer'], [badge]);
  const players = panel('PlayersContainer', [], [local]);
  const team = panel('TeamFriendly', [], [panel('PlayerContents', [], [players])]);
  const top = panel('TopBar', [], [panel('', ['GameClock'], [clock]), panel('TeamsContainer', [], [team])]);
  const shop = panel('CitadelHudHeroShop', ['hero_chrono']);
  const goldLabel = panel('hudCurGoldLabel'); goldLabel.text = '1,600';
  const gold = panel('gold_and_ap_container', [], [panel('hudGoldContainer', [], [panel('CurrentGoldAmount', [], [goldLabel])])]);
  const owned = panel('ModPurchasedPanelUniversal', [], []);
  const locked = panel('ModPurchasedPanelUniversalLocked', [], []);
  const lower = panel('LowerLeft', [], [gold, panel('ModsContainer', [], [owned, locked])]);
  const core = panel('', ['HudCore'], [top, shop, panel('StatsAndModsContainer', [], [lower])]);
  const fields = ['DeadpickHero', 'DeadpickHeroImage', 'DeadpickClock', 'DeadpickSouls', 'DeadpickInventory', 'DeadpickTeams', 'DeadpickView', 'DeadpickReason', 'DeadpickStatus', 'DeadpickNotice', 'DeadpickPlanStatus'];
  for (let i = 0; i < 3; i++) fields.push('DeadpickItem' + i, 'DeadpickCost' + i, 'DeadpickTier' + i, 'DeadpickIcon' + i, 'DeadpickRow' + i,
    'DeadpickImbue'+i,'DeadpickImbueIcon'+i,'DeadpickImbueBox'+i);
  const gui = panel('DeadpickDiagnostics', [], fields.map(id => panel(id)));
  const root = panel('', [], [panel('Hud', [], [core]), gui]);
  return { root, core, top, players, shop, goldLabel, owned, locked, gui, lower, clock };
}
function item() { return panel('', ['isTier1', 'isWeapon', 'medicBullets'], [panel('modIconContainer'), panel('ModIconImage')]); }
function definirInventario(f, itens, trancados = 0) {
  f.owned.list = [...itens, ...Array.from({ length: 12 - trancados - itens.length }, () => panel('', [], [panel('modIconContainer')]))];
  f.locked.list = Array.from({ length: trancados }, () => panel('', ['Locked'], [panel('modIconContainer')]));
}

test('HUD fica oculto no menu e acompanha entrada, retorno e próxima sessão', () => {
  const f = fixture(), jobs = [];
  const local = f.players.list[0]; f.players.list = [];
  const api = { GetContextPanel: () => f.root, Msg() {}, Schedule(d, cb) { jobs.push(cb); return jobs.length; }, CancelScheduled() {} };
  runtime.attach(api, data, engine); jobs.shift()();
  assert.equal(runtime.readState(f.root, data).heroId, 10, 'Loja pode reconhecer herói antes de entrar');
  assert.equal(f.gui.visible, false, 'Reconhecer herói no menu não exibe o HUD');
  f.core.classes.push('InHideout'); f.players.list = [local]; jobs.shift()();
  assert.equal(f.gui.visible, false, 'Esconderijo inicial permanece oculto mesmo com cartão antigo');
  f.core.classes = ['HudCore', 'connectedToHeroTesting']; f.players.list = []; jobs.shift()();
  assert.equal(f.gui.visible, true, 'Teste de herói exibe');
  f.core.classes = ['HudCore', 'InHideout']; jobs.shift()();
  assert.equal(f.gui.visible, false, 'Retorno ao menu oculta sem reiniciar o mod');
  f.core.classes = ['HudCore']; f.players.list = [local]; jobs.shift()();
  assert.equal(f.gui.visible, true, 'Partida exibe');
  f.core.classes.push('GameStatePostGame'); jobs.shift()();
  assert.equal(f.gui.visible, false, 'Pós-partida não mantém o painel antigo');
});

test('sinais de dano/economia são observação bruta não validada e distinguem outgoing', () => {
  const f = fixture();
  const weapon = panel('', ['weaponDmg']); weapon.text = 'Arma: 40%';
  const spirit = panel('', ['spiritDmg']); spirit.text = 'Espírito: 60%';
  const total = panel('', ['DamageValue']); total.text = '1.200';
  f.core.list.push(panel('CitadelHudDamageReport', [], [panel('', ['HudDamageReport', 'Outgoing', 'Hidden'], [weapon, spirit, total])]));
  const badge = panel('HeroBadge'); badge.heroid = 1;
  const gold = panel('SoulsValue'); gold.text = '12.3k';
  f.top.FindChildTraverse('TeamsContainer').list.push(panel('TeamEnemy', [], [panel('PlayerContents', [], [panel('PlayersContainer', [], [panel('', [], [badge, gold])])])]));
  const result = runtime.readExperimentalSignals(f.root, data);
  assert.equal(result.validado, false); assert.equal(result.relatorio.flagOutgoing, true);
  assert.equal(result.relatorio.oculto, true); assert.equal(result.relatorio.armaTexto, 'Arma: 40%');
  assert.equal(result.almasPlacarInimigos[0].texto, '12.3k');
});

test('falha no coletor experimental não interrompe a lista nem as leituras do mod', () => {
  const f = fixture(), jobs = [], logs = [];
  definirInventario(f, []);
  const total = panel('', ['DamageValue']); Object.defineProperty(total, 'text', { get() { throw new Error('sinal indisponível'); } });
  f.core.list.push(panel('CitadelHudDamageReport', [], [panel('', ['HudDamageReport'], [total])]));
  runtime.attach({ GetContextPanel: () => f.root, Msg: m => logs.push(m), Schedule(d, cb) { jobs.push(cb); return jobs.length; }, CancelScheduled() {} }, data, engine);
  for (let i = 0; i < 4; i++) jobs.shift()();
  assert(f.gui.FindChildTraverse('DeadpickItem0').text);
  assert.equal(f.gui.visible, true); assert.equal(jobs.length, 1);
  assert(!logs.some(m => m.includes('leitura falhou') || m.includes('calculo falhou')));
});

test('troca pelo cartão local atualiza herói, itens e saldo apesar da loja antiga e reinicia histórico', () => {
  const f = fixture(), jobs = [], calls = [];
  const label = panel('', ['HeroName']); label.text = 'Paradox';
  const card = f.players.list[0]; card.list = [label]; // heroid não exposto no cliente
  definirInventario(f, [item()]);
  const proxy = { recomendar(s) { calls.push(s); return engine.recomendar(s); } };
  runtime.attach({ GetContextPanel: () => f.root, Msg() {}, Schedule(d, cb) { jobs.push(cb); return jobs.length; }, CancelScheduled() {} }, data, proxy);
  jobs.shift()();
  assert.match(f.gui.FindChildTraverse('DeadpickHero').text, /Paradox.*LocalPlayer/);
  assert(calls.at(-1).historico.has('Restorative Shot'));
  label.text = 'Holliday'; definirInventario(f, []); f.goldLabel.text = '3200'; f.clock.text = '0:40';
  jobs.shift()();
  assert.match(f.gui.FindChildTraverse('DeadpickHero').text, /Holliday.*LocalPlayer/);
  assert.match(f.gui.FindChildTraverse('DeadpickSouls').text, /3200/);
  assert.match(f.gui.FindChildTraverse('DeadpickClock').text, /0:40/);
  assert.equal(calls.at(-1).jogador, 'Holliday');
  assert.equal(calls.at(-1).historico.size, 0);
  assert.equal(f.gui.FindChildTraverse('DeadpickItem0').text, engine.recomendar(calls.at(-1)).itens[0].nome);
  // Substituir toda a árvore nativa também deve ser observado no próximo ciclo.
  const next = fixture(); next.players.list[0].FindChildTraverse('HeroBadge').heroid = 64;
  f.root.list[0] = next.root.list[0]; jobs.shift()();
  assert.match(f.gui.FindChildTraverse('DeadpickHero').text, /Drifter/);
});

test('Extra Spirit sai da lista na compra, antes de Improved Spirit e com outros slots desconhecidos', () => {
  const f = fixture(), jobs = [];
  const registry = [
    { nome: 'Extra Spirit', tier: 1, tipo: 'spirit', imagens: ['images/upgrades/mods_tech/tech_damage'], classes: ['techPower'] },
    { nome: 'Spirit Strike', tier: 1, tipo: 'spirit', imagens: ['images/upgrades/mods_tech/tech_damage'], classes: ['acolytesGlove'] }
  ];
  const nativeData = { ...data, registroInventario: registry };
  runtime.attach({ GetContextPanel: () => f.root, Msg() {}, Schedule(d, cb) { jobs.push(cb); return jobs.length; }, CancelScheduled() {} }, nativeData, engine);
  f.owned.list.push(panel('', ['isTier2', 'isTech'], [panel('modIconContainer')]));
  jobs.shift()();
  const bought = panel('', ['isTier1', 'isTech', 'techPower'], [panel('modIconContainer'), panel('ModIconImage')]);
  f.owned.list.push(bought); jobs.shift()();
  assert.deepEqual(runtime.readState(f.root, nativeData).inventario.nomes, ['Extra Spirit']);
  assert.equal(runtime.readState(f.root, nativeData).inventario.completo, false);
  assert.match(f.gui.FindChildTraverse('DeadpickInventory').text, /1 identificados/);
  for (let i = 0; i < 3; i++) assert.notEqual(f.gui.FindChildTraverse('DeadpickItem' + i).text, 'Extra Spirit');
  bought.FindChildTraverse('ModIconImage').attrs.src = 's2r://panorama/images/upgrades/mods_tech/tech_damage_psd.vtex';
  assert.deepEqual(runtime.readState(f.root, nativeData).inventario.nomes, ['Extra Spirit'], 'Imagem compartilhada desambiguada pela classe nativa');
});

test('barra de habilidades identifica troca no sandbox com loja antiga e sem LocalPlayer', () => {
  const f = fixture(), jobs = [];
  definirInventario(f, []);
  f.players.list = []; f.core.classes.push('connectedToHeroTesting');
  const skills = panel('hud_signature', [], ['a', 'b'].map(id => panel(id, ['ability_name'])));
  f.core.list.push(panel('AbilitiesContainer', [], [skills]));
  const h = data.herois.find(h => h.nome === 'Holliday');
  const localData = { ...data, herois: data.herois.map(x => ({ ...x,
    habilidades: x.id === 10 ? ['paradox_a', 'paradox_b'] : x.id === h.id ? ['holliday_a', 'holliday_b'] : [] })) };
  const translations = { '#paradox_a': 'Bomba temporal', '#paradox_b': 'Carabina cinética', '#holliday_a': 'Barril de pólvora', '#holliday_b': 'Pulo' };
  const api = { GetContextPanel: () => f.root, Localize: s => translations[s] || s, Msg() {},
    Schedule(d, cb) { jobs.push(cb); return jobs.length; }, CancelScheduled() {} };
  skills.list[0].text = 'Bomba temporal'; skills.list[1].text = 'Carabina cinética';
  runtime.attach(api, localData, engine); jobs.shift()();
  assert.match(f.gui.FindChildTraverse('DeadpickHero').text, /Paradox.*barra de habilidades/);
  skills.list[0].text = 'Barril de pólvora'; skills.list[1].text = 'Pulo';
  jobs.shift()();
  assert.match(f.gui.FindChildTraverse('DeadpickHero').text, /Holliday.*barra de habilidades/);
  assert.equal(f.gui.visible, true);
  assert.equal(f.gui.FindChildTraverse('DeadpickRow0').visible, true);
  assert.equal(runtime.readState(f.root, localData, api.Localize).heroId, h.id);
  assert.deepEqual(f.shop.classes, ['hero_chrono'], 'A loja nunca foi reaberta');
});

test('venda libera recompra, enquanto upgrade equipado continua cobrindo o componente', () => {
  const hero = data.herois.find(h => h.nome === 'Holliday');
  const state = { heroId: hero.id, clock: { seconds: 60 }, modo: 'teste de herói', localConfirmado: true,
    inventario: { nomes: [], completo: false }, almas: 0, aliados: [], inimigos: [], composicaoCompleta: false };
  const first = runtime.buildView(state, data, engine, []).itens[0].nome;
  state.inventario.nomes = [first];
  assert(!runtime.buildView(state, data, engine, [first]).itens.some(i => i.nome === first));
  state.inventario.nomes = [];
  assert.equal(runtime.buildView(state, data, engine, [first]).itens[0].nome, first, 'Histórico de compra não bloqueia item vendido');
  state.inventario.nomes = ['Improved Spirit'];
  const upgraded = runtime.buildView(state, data, engine, ['Extra Spirit']);
  assert(!upgraded.itens.some(i => i.nome === 'Extra Spirit'));
});

test('classes compartilhadas distinguem Extra Spirit/Goose e Titanic/Split por ativação', () => {
  for (const [css, kind, tier, passive, active] of [
    ['techPower', 'spirit', 1, 'Extra Spirit', 'Golden Goose Egg'],
    ['titanicMagazine', 'weapon', 2, 'Titanic Magazine', 'Split Shot']
  ]) {
    const f = fixture();
    const registry = [false, true].map((ativo, i) => ({ nome: i ? active : passive, tier, tipo: kind, ativo,
      imagens: ['images/shared'], classes: [css] }));
    const slot = panel('', ['isTier' + tier, kind === 'spirit' ? 'isTech' : 'isWeapon', css, 'isPassiveItem'], [panel('modIconContainer')]);
    f.owned.list.push(slot);
    assert.deepEqual(runtime.readInventory(f.core, registry).nomes, [passive]);
    slot.classes = slot.classes.filter(c => c !== 'isPassiveItem').concat('isActiveItem');
    assert.deepEqual(runtime.readInventory(f.core, registry).nomes, [active]);
    slot.classes = slot.classes.filter(c => c !== 'isActiveItem');
    assert.deepEqual(runtime.readInventory(f.core, registry).nomes, [], 'Ausência de flag não significa passivo');
    assert.deepEqual(runtime.readInventory(f.core, registry).desconhecidos[0].nomesCandidatos, [passive, active]);
  }
});

test('colisões entre passivos continuam desconhecidas até obter uma imagem inequívoca', () => {
  const f = fixture();
  const registry = ['Weapon Shielding', 'Spirit Shielding', 'Battle Vest'].map((nome, i) => ({ nome,
    tipo: 'vitality', tier: 2, ativo: false, classes: ['bulletShield'], imagens: ['images/item' + i] }));
  const slot = panel('', ['isTier2', 'isArmor', 'isPassiveItem', 'bulletShield'], [panel('modIconContainer'), panel('ModIconImage')]);
  f.owned.list.push(slot);
  assert.equal(runtime.readInventory(f.core, registry).desconhecidos[0].candidatos, 3);
  slot.FindChildTraverse('ModIconImage').attrs.src = 's2r://panorama/images/item1_psd.vtex';
  assert.deepEqual(runtime.readInventory(f.core, registry).nomes, ['Spirit Shielding']);
});

test('compras em slots ambíguos deixam a fila sem fingir identidade; venda libera novamente', () => {
  const groups = [['Weapon Shielding', 'Spirit Shielding', 'Battle Vest'], ['Witchmail', 'Plated Armor'], ['Escalating Exposure', 'Spirit Burn']];
  for (const group of groups) {
    const f = fixture();
    const model = { participacoes: 100, perfis: [{ id: 0, participacoes: 100,
      itens: [...group, 'Extra Health'].map((nome, i) => ({ nome, frequencia: 1, segundo: 30+i*30 })) }] };
    const custom = { ...data, modelos: { ...data.modelos, Paradox: model } };
    const state = runtime.readState(f.root, custom);
    state.inventario = { nomes: [], completo: false, desconhecidos: [{ nomesCandidatos: group }] };
    const result = runtime.buildView(state, custom, engine);
    assert.equal(result.itens[0].nome, 'Extra Health');
    assert(!result.itens.some(i => group.includes(i.nome)));
    assert.deepEqual(state.inventario.nomes, [], 'Não declara o grupo todo como equipado');
    state.inventario.desconhecidos = [];
    assert(runtime.buildView(state, custom, engine).itens.some(i => group.includes(i.nome)), 'Venda elimina a incerteza e libera as opções, respeitando a ordem dos componentes');
  }
});

test('loja aberta do mesmo herói confirma grupo ambíguo por nome e contagem, sem reaproveitar loja antiga', () => {
  const f = fixture();
  const registry = ['Weapon Shielding', 'Spirit Shielding', 'Battle Vest'].map((nome, i) => ({ nome,
    classeNativa: 'upgrade_' + i, tipo: 'vitality', tier: 2, ativo: false, classes: ['bulletShield'], imagens: [] }));
  const custom = { ...data, registroInventario: registry };
  function slot() { return panel('', ['isTier2', 'isArmor', 'isPassiveItem', 'bulletShield'], [panel('modIconContainer')]); }
  const label = panel('', ['modName']); label.text = 'Escudo espiritual';
  const ownedView = panel('', ['mod_view', 'owned'], [label]); f.shop.list.push(ownedView);
  const localize = token => token === '#upgrade_1' ? 'Escudo espiritual' : token;
  definirInventario(f, [slot()]); f.core.classes.push('gShopOpen');
  let inv = runtime.readState(f.root, custom, localize).inventario;
  assert.deepEqual(inv.nomes, ['Spirit Shielding']); assert.equal(inv.completo, true);
  assert.deepEqual(inv.confirmadosLoja, ['Spirit Shielding']);
  f.owned.list[1] = slot();
  inv = runtime.readState(f.root, custom, localize).inventario;
  assert.equal(inv.completo, false); assert.equal(inv.nomes.length, 0, 'Uma entrada da loja não confirma dois slots');
  const secondName = panel('', ['modName']); secondName.text = 'Battle Vest';
  f.shop.list.push(panel('', ['mod_view', 'owned'], [secondName]));
  inv = runtime.readState(f.root, custom, localize).inventario;
  assert.deepEqual(inv.nomes, ['Battle Vest', 'Spirit Shielding']); assert.equal(inv.completo, true);
  f.shop.classes = ['hero_drifter'];
  assert.equal(runtime.readState(f.root, custom, localize).inventario.completo, false, 'Loja de outro herói não serve de confirmação');
  f.shop.classes = ['hero_chrono']; f.core.classes = f.core.classes.filter(c => c !== 'gShopOpen');
  assert.equal(runtime.readState(f.root, custom, localize).inventario.completo, false, 'Loja fechada pode conter ownership antigo');
  f.owned.list = [];
  assert.equal(runtime.readState(f.root, custom, localize).inventario.nomes.length, 0, 'Loja antiga não ressuscita item vendido');
});

test('Cultist sem classe mantém Monster Rounds e a evolução fora da fila; tier V também é observado', () => {
  const f = fixture();
  const registry = [
    { nome: 'Cultist Sacrifice', tier: 3, tipo: 'weapon', ativo: true, imagens: [], classes: [] },
    { nome: 'Blood Tribute', tier: 3, tipo: 'weapon', ativo: true, imagens: [], classes: [] },
    { nome: 'Seraphim Wings', tier: 5, tipo: 'vitality', ativo: false, imagens: [], classes: [] }
  ];
  const custom = { ...data, registroInventario: registry, modelos: { ...data.modelos,
    Paradox: { participacoes: 100, perfis: [{ id: 0, participacoes: 100, itens: [
      { nome: 'Monster Rounds', frequencia: 1, segundo: 30 },
      { nome: 'Cultist Sacrifice', frequencia: 1, segundo: 120 },
      { nome: 'Extra Regen', frequencia: 1, segundo: 200 }
    ] }] } } };
  f.owned.list.push(panel('', ['isTier3', 'isWeapon', 'isActiveItem'], [panel('modIconContainer')]));
  const state = runtime.readState(f.root, custom);
  assert.equal(state.inventario.nomes.length, 0, 'Não adivinha identidade só por tier e tipo');
  assert(state.inventario.desconhecidos[0].nomesCandidatos.includes('Cultist Sacrifice'));
  const view = runtime.buildView(state, custom, engine);
  assert(!view.itens.some(i => ['Monster Rounds', 'Cultist Sacrifice'].includes(i.nome)));
  f.owned.list = [panel('', ['isTier5', 'isArmor', 'isPassiveItem'], [panel('modIconContainer')])];
  const inv = runtime.readInventory(f.core, registry);
  assert.equal(inv.desconhecidos[0].tier, 5);
  assert.deepEqual(inv.desconhecidos[0].nomesCandidatos, ['Seraphim Wings']);
});

test('slot sem candidatos ou fontes ausentes suspende a fila em vez de reapresentar compras', () => {
  const f = fixture(), state = runtime.readState(f.root, data);
  state.inventario.desconhecidos = [{ nomesCandidatos: [] }];
  assert.equal(runtime.buildView(state, data, engine).itens.length, 0);
  state.inventario.desconhecidos = []; state.inventario.fontes = 0;
  const view = runtime.buildView(state, data, engine);
  assert.equal(view.itens.length, 0); assert.equal(view.inventarioPendente, true);
});

test('saldo exato não usa valores aproximados ou total do inventário', () => {
  assert.equal(runtime.parseSouls('1,600'), 1600);
  assert.equal(runtime.parseSouls('1.600'), 1600);
  assert.equal(runtime.parseSouls('0'), 0);
  for (const s of ['', '1.6K', '1,6k', '∞', '12,34', '1.234,567']) assert.equal(runtime.parseSouls(s), null);
  const f = fixture(); const wrong = panel('hudCurGoldLabel'); wrong.text = '99000';
  f.root.FindChildTraverse('hudGoldContainer').list.push(panel('', ['hudItemGoldContainer'], [wrong]));
  assert.equal(runtime.readState(f.root, data).almas, 1600);
});
test('esconderijo identifica herói da loja e mantém apenas uma prévia', () => {
  const f = fixture(); f.players.list = []; f.core.classes.push('InHideout'); f.shop.classes = ['hero_drifter'];
  const state = runtime.readState(f.root, data);
  assert.equal(state.heroId, 64); assert.equal(state.heroSource, 'classe da loja'); assert.equal(state.localConfirmado, false);
  const view = runtime.buildView(state, data, engine, []);
  assert.equal(view.hero.nome, 'Drifter'); assert.equal(view.previa, true); assert.equal(view.itens.length, 0);
  assert.equal(view.inventarioPendente, true);
  f.core.classes = ['HudCore', 'connectedToHideout'];
  const combat = runtime.readState(f.root, data);
  assert.equal(combat.modo, 'teste de herói');
  assert.equal(combat.localConfirmado, true);
  assert.equal(runtime.buildView(combat, data, engine, []).previa, true, 'Inventário ausente ainda exige prévia');
});
test('não assume inventário vazio, resolve um item conhecido e bloqueia ambiguidade', () => {
  const f = fixture(); assert.equal(runtime.readState(f.root, data).inventario.completo, false);
  definirInventario(f, [item()]);
  let inv = runtime.readState(f.root, data).inventario;
  assert.equal(inv.completo, true); assert.deepEqual(inv.nomes, ['Restorative Shot']);
  f.owned.list.push(panel('', ['isTier2', 'isTech'], [panel('modIconContainer'), panel('ModIconImage')]));
  inv = runtime.readState(f.root, data).inventario;
  assert.equal(inv.completo, false); assert.equal(inv.desconhecidos.length, 1);
});

test('doze espaços sem categoria/tier/ícone são vazios; um item sem identidade continua bloqueando', () => {
  const f = fixture();
  f.owned.list = Array.from({ length: 12 }, () => panel('', [], [panel('modIconContainer')]));
  let inv = runtime.readInventory(f.core, data.registroInventario);
  assert.equal(inv.completo, true); assert.equal(inv.vazios, 12); assert.equal(inv.nomes.length, 0);
  f.owned.list[0].classes = ['isTier2', 'isTech'];
  inv = runtime.readInventory(f.core, data.registroInventario);
  assert.equal(inv.completo, false); assert.equal(inv.desconhecidos.length, 1);
});
test('imagem nova conflitante não é substituída por uma classe antiga', () => {
  const f = fixture(); const i = item(); i.FindChildTraverse('ModIconImage').attrs.src = 's2r://panorama/images/items/weapon/unknown_psd.vtex'; f.owned.list.push(i);
  const inv = runtime.readState(f.root, data).inventario;
  assert.equal(inv.completo, false); assert.equal(inv.nomes.length, 0);
});
test('inventário de aliado assistido não alimenta a recomendação local', () => {
  const f = fixture(); definirInventario(f, [item()]);
  const badge = panel('HeroBadge'); badge.heroid = 1;
  f.players.list.push(panel('', ['SpectatorTarget'], [badge]));
  const state = runtime.readState(f.root, data);
  assert.equal(state.espectando, true); assert.equal(state.localConfirmado, false);
  assert.equal(state.inventario.nomes.length, 0);
  assert.equal(runtime.buildView(state, data, engine, []).previa, true);
});
test('compartilha o motor HTML para os 44 heróis, sem counters com composição incompleta', () => {
  for (const hero of data.herois) {
    const state = { heroId: hero.id, clock: { seconds: 0 }, modo: 'partida', localConfirmado: true,
      inventario: { nomes: [], completo: true }, almas: 0, aliados: [], inimigos: [], composicaoCompleta: false };
    const view = runtime.buildView(state, data, engine, []);
    const expected = engine.recomendar({ jogador: hero.nome, modelo: data.modelos[hero.nome], catalogo: data.itens,
      aliados: [], inimigos: [], inventario: new Set(), almas: 0 });
    assert.equal(view.previa, false); assert.equal(view.itens[0].nome, expected.itens[0].nome);
  }
});
test('painel inclui leitura automática e plano; compra observada retira item já adquirido', () => {
  const f = fixture(); f.core.classes.push('connectedToHeroTesting'); definirInventario(f, [item()]);
  const jobs = [];
  const api = { GetContextPanel: () => f.root, Msg() {}, Schedule(delay, cb) { jobs.push(cb); return jobs.length; }, CancelScheduled() {} };
  runtime.attach(api, data, engine); jobs.shift()();
  assert.match(f.gui.FindChildTraverse('DeadpickHero').text, /Paradox/);
  assert.match(f.gui.FindChildTraverse('DeadpickView').text, /Próximas compras/);
  assert.notEqual(f.gui.FindChildTraverse('DeadpickItem0').text, 'Restorative Shot');
  assert.match(f.gui.FindChildTraverse('DeadpickStatus').text, /leitura 1/);
  assert.equal(f.gui.visible, true);
  assert.equal(f.gui.FindChildTraverse('DeadpickRow0').visible, true);
  assert.equal(f.gui.FindChildTraverse('DeadpickNotice').text, '');
  f.goldLabel.text = '1.6K'; jobs.shift()();
  assert.match(f.gui.FindChildTraverse('DeadpickSouls').text, /não observadas/);
});
test('composição exige doze heróis únicos, conhecidos e jogador no time aliado', () => {
  const f = fixture(); const ids = [10, ...data.herois.map(h => h.id).filter(id => id !== 10)].slice(0, 12);
  function card(id, local) { const badge = panel('HeroBadge'); badge.heroid = id; return panel('', local ? ['LocalPlayer'] : [], [badge]); }
  f.players.list = ids.slice(0, 6).map((id, i) => card(id, i === 0));
  const enemy = panel('PlayersContainer', [], ids.slice(6).map(id => card(id, false)));
  f.top.FindChildTraverse('TeamsContainer').list.push(panel('TeamEnemy', [], [panel('PlayerContents', [], [enemy])]));
  assert.equal(runtime.readState(f.root, data).composicaoCompleta, true);
  enemy.list[0].FindChildTraverse('HeroBadge').heroid = 10;
  assert.equal(runtime.readState(f.root, data).composicaoCompleta, false);
  enemy.list[0].FindChildTraverse('HeroBadge').heroid = 999999;
  assert.equal(runtime.readState(f.root, data).composicaoCompleta, false);
});
test('modelos normais não são usados para Street Brawl', () => {
  const f = fixture(); f.top.classes.push('gStreetBrawl'); definirInventario(f, [item()]);
  const state = runtime.readState(f.root, data);
  assert.equal(state.modoSuportado, false);
  const view = runtime.buildView(state, data, engine, []);
  assert.equal(view.itens.length, 0); assert.match(view.titulo, /não suportado/);
});
test('falha do motor preserva leituras, limpa a sugestão antiga e recupera automaticamente', () => {
  const f = fixture(); f.core.classes.push('connectedToHeroTesting'); definirInventario(f, [item()]);
  let fail = false; const jobs = [], logs = [];
  const proxy = { recomendar(s) { if (fail) throw new TypeError('Internal error. Icu error.'); return engine.recomendar(s); } };
  const api = { GetContextPanel: () => f.root, Msg: m => logs.push(m),
    Schedule(delay, callback) { jobs.push({ delay, callback }); return jobs.length; }, CancelScheduled() {} };
  runtime.attach(api, data, proxy); jobs.shift().callback();
  assert(f.gui.FindChildTraverse('DeadpickItem0').text);
  fail = true; f.clock.text = '0:40'; f.goldLabel.text = '1700'; jobs.shift().callback();
  assert.match(f.gui.FindChildTraverse('DeadpickClock').text, /0:40/);
  assert.match(f.gui.FindChildTraverse('DeadpickHero').text, /Paradox/);
  assert.match(f.gui.FindChildTraverse('DeadpickSouls').text, /1700/);
  assert.match(f.gui.FindChildTraverse('DeadpickInventory').text, /1 identificados/);
  assert.match(f.gui.FindChildTraverse('DeadpickView').text, /leituras preservadas/);
  assert.equal(f.gui.FindChildTraverse('DeadpickItem0').text, '');
  assert.equal(f.gui.FindChildTraverse('DeadpickRow0').visible, false);
  assert.equal(f.gui.FindChildTraverse('DeadpickNotice').text, 'Aguardando recomendações');
  assert.equal(jobs[0].delay, 2);
  assert(logs.some(m => m.includes('calculo falhou')));
  assert(!logs.some(m => m.includes('leitura falhou')));
  fail = false; jobs.shift().callback();
  assert.match(f.gui.FindChildTraverse('DeadpickView').text, /Próximas compras/);
  assert(f.gui.FindChildTraverse('DeadpickItem0').text);
});
test('falha de apresentação não apaga a identidade e o relógio nativos', () => {
  const f = fixture(); f.core.classes.push('connectedToHeroTesting'); definirInventario(f, [item()]);
  f.gui.FindChildTraverse('DeadpickTier0').SetHasClass = () => { throw new Error('API de estilo indisponivel'); };
  const jobs = [], logs = [];
  const api = { GetContextPanel: () => f.root, Msg: m => logs.push(m),
    Schedule(delay, cb) { jobs.push(cb); return jobs.length; }, CancelScheduled() {} };
  runtime.attach(api, data, engine); jobs.shift()();
  assert.match(f.gui.FindChildTraverse('DeadpickHero').text, /Paradox/);
  assert.match(f.gui.FindChildTraverse('DeadpickClock').text, /0:39/);
  assert(logs.some(m => m.includes('painel falhou')));
  assert.equal(f.gui.FindChildTraverse('DeadpickItem0').text, '');
});


test('dica de imbuimento localiza nome e limpa texto e ícone ao trocar a sugestão',()=>{
  const f=fixture(),jobs=[];definirInventario(f,[]);
  let imb=true;
  const choice={slot:3,classe:'citadel_ability_chrono_carbine',nome:'Kinetic Carbine',imagem:'s2r://panorama/images/skill.vtex'};
  const proxy={recomendar(){return {itens:[{nome:'Compress Cooldown',custoCompra:1600,imbuimento:imb?choice:null}],sinais:[],situacionais:[]};}};
  const api={GetContextPanel:()=>f.root,Msg(){},Localize:t=>t==='#'+choice.classe?'Carabina cinética':t,
    Schedule(d,fn){jobs.push(fn);return jobs.length;},CancelScheduled(){}};
  runtime.attach(api,data,proxy);jobs.shift()();
  assert.equal(f.gui.FindChildTraverse('DeadpickImbue0').text,'Imbuir: 3 · Carabina cinética');
  assert.equal(f.gui.FindChildTraverse('DeadpickImbueBox0').visible,true);
  assert.equal(f.gui.FindChildTraverse('DeadpickImbueIcon0').visible,true);
  imb=false;f.clock.text='0:40';jobs.shift()();
  assert.equal(f.gui.FindChildTraverse('DeadpickImbue0').text,'');
  assert.equal(f.gui.FindChildTraverse('DeadpickImbueBox0').visible,false);
  assert.equal(f.gui.FindChildTraverse('DeadpickImbueIcon0').visible,false);
});


test('cabeçalho mostra itens equipados e não transforma categoria Locked em bloqueio',()=>{
  const f=fixture(),jobs=[];definirInventario(f,[item()],4);
  runtime.attach({GetContextPanel:()=>f.root,Msg(){},Schedule(d,fn){jobs.push(fn);return jobs.length;},CancelScheduled(){}},data,engine);
  jobs.shift()();
  assert.equal(f.gui.FindChildTraverse('DeadpickPlanStatus').text,'Plano: 12 · Equipados: 1/12');
  definirInventario(f,[item()],0);jobs.shift()();
  assert.equal(f.gui.FindChildTraverse('DeadpickPlanStatus').text,'Plano: 12 · Equipados: 1/12');
});


test('integração leitor → HUD → compra: 44 heróis passam de oito slots e evoluções não criam slots extras',t=>{
  const registry=Object.values(data.itens).map((m,i)=>({nome:m.nome,tier:m.tier,tipo:'spirit',classes:['testIdentity'+i],imagens:[]}));
  const native={...data,registroInventario:registry};
  let reached12=0; const finais=[];
  for(const hero of data.herois){
    const f=fixture(); let inv=new Set(),finished=false,upgrades=0;
    for(let step=0;step<180;step++){
      const cells=[...inv].map(name=>{
        const m=registry.find(x=>x.nome===name);
        return panel('', ['isTier'+m.tier,m.tipo==='weapon'?'isWeapon':m.tipo==='vitality'?'isArmor':'isTech',...m.classes],[panel('modIconContainer')]);
      });
      while(cells.length<12)cells.push(panel('',[],[panel('modIconContainer')]));
      f.owned.list=cells.slice(0,8);f.locked.list=cells.slice(8);
      f.locked.list.forEach(p=>p.classes.push('Locked'));
      const inventory=runtime.readInventory(f.core,registry);
      assert.equal(inventory.completo,true,hero.nome+': leitura completa em ambos os grupos');
      assert.equal(inventory.slotsDisponiveis,12);
      assert.equal(inventory.slotsOcupados,inv.size);
      const state={heroId:hero.id,modo:'partida',modoSuportado:true,localConfirmado:true,clock:{seconds:2100},
        inventario:inventory,almas:100000,aliados:[],inimigos:[],composicaoCompleta:false};
      const view=runtime.buildView(state,native,engine);
      if(!view.itens.length){
        assert(inv.size>8,hero.nome+': parou em '+inv.size);
        if(inv.size<12)assert.equal(view.semEspaco,false,hero.nome+': falta de candidatos não é lotação');
        if(inv.size===12)reached12++;
        finished=true;break;
      }
      const name=view.itens[0].nome;
      const projection=engine.projetarInventario({nome:name,catalogo:data.itens,inventario:inv,limiteSlots:12});
      assert(projection.cabe,hero.nome+': compra ilegal');
      const before=inv.size;
      const componentOwned=(Object.values(data.itens).find(m=>m.nome===name).componentes||[]).some(c=>inv.has(c));
      inv=engine.efetuarCompra({nome:name,catalogo:data.itens,inventario:inv,limiteSlots:12}).inventario;
      assert.equal(inv.size,projection.slotsDepois);
      assert(inv.size<=12);
      if(componentOwned){assert(inv.size<=before,hero.nome+': evolução ocupou slot extra');upgrades++;}
    }
    assert(finished,hero.nome+': progressão não termina');
    finais.push({heroi:hero.nome,slots:inv.size,upgrades});
    if(hero.nome==='Vindicta'){assert.equal(inv.size,12);assert(upgrades>0);}
  }
  assert.equal(data.herois.length,44);
  t.diagnostic(JSON.stringify({herois:data.herois.length,com12:reached12,finais}));
});


test('aquecimento → partida sem marcador LocalPlayer mantém HUD pela barra de habilidades',()=>{
  const f=fixture(),jobs=[],logs=[];definirInventario(f,[]);
  f.players.list=[];f.core.classes.push('connectedToHeroTesting');
  const skills=panel('hud_signature',[],['A','B'].map(text=>{const p=panel('', ['ability_name']);p.text=text;return p;}));
  f.core.list.push(panel('AbilitiesContainer',[],[skills]));
  const custom={...data,herois:data.herois.map(h=>({...h,habilidades:h.id===10?['test_a','test_b']:[]}))};
  const api={GetContextPanel:()=>f.root,Localize:s=>({'#test_a':'A','#test_b':'B'}[s]||s),Msg:m=>logs.push(m),
    Schedule(d,cb){jobs.push(cb);return jobs.length;},CancelScheduled(){}};
  runtime.attach(api,custom,engine);jobs.shift()();assert.equal(f.gui.visible,true);
  f.core.classes=['HudCore'];f.clock.text='0:01';jobs.shift()();
  const state=runtime.readState(f.root,custom,api.Localize);
  assert.equal(state.heroSource,'barra de habilidades');assert.equal(state.localConfirmado,true);
  assert.equal(state.modo,'partida');assert.equal(state.hudVisivel,true);
  assert.equal(f.gui.visible,true);assert(f.gui.FindChildTraverse('DeadpickItem0').text);
  // Inventário temporariamente remontado não deve esconder o painel inteiro.
  f.owned.list=[];f.locked.list=[];jobs.shift()();
  assert.equal(f.gui.visible,true);assert.equal(f.gui.FindChildTraverse('DeadpickNotice').text,'Aguardando leitura do inventário');
  definirInventario(f,[]);jobs.shift()();assert(f.gui.FindChildTraverse('DeadpickItem0').text);
  f.clock.text='carregando';jobs.shift()();assert.equal(f.gui.visible,false);
  f.clock.text='1:00';jobs.shift()();assert.equal(f.gui.visible,true);
  for(const marker of ['InHideout','GameStatePostGame','GameStatePostGamePlayOfTheGame','TeamSpectator','replay_playback']){
    f.core.classes=['HudCore',marker];jobs.shift()();assert.equal(f.gui.visible,false,marker);
  }
  f.core.classes=['HudCore'];jobs.shift()();assert.equal(f.gui.visible,true);
  const badge=panel('HeroBadge');badge.heroid=1;
  f.players.list=[panel('', ['SpectatorTarget'],[badge])];jobs.shift()();assert.equal(f.gui.visible,false);
  const observations=logs.filter(x=>x.includes('[Deadpick] estado ')).map(x=>JSON.parse(x.split('[Deadpick] estado ')[1]));
  assert(observations.some(x=>x.modo==='partida'&&x.visivel&&x.localConfirmado));
  assert(observations.some(x=>x.motivoOculto==='menu inicial'));
  assert(observations.some(x=>x.motivoOculto==='pós-partida'));
  assert(observations.some(x=>x.motivoOculto==='espectador ou replay'&&!x.visivel));
});
