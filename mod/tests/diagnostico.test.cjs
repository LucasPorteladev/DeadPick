const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseClock, readState, attach } = require('../src/panorama/scripts/deadpick_runtime.js');

function panel(id = '', classes = [], list = []) {
  return { id, classes, list, alive: true, text: '',
    IsValid() { return this.alive; }, Children() { return this.list; },
    BHasClass(c) { return this.classes.includes(c); },
    FindChildTraverse(target) {
      for (const p of this.list) {
        if (p.id === target) return p;
        const found = p.FindChildTraverse(target);
        if (found) return found;
      }
      return null;
    }
  };
}
function fixture() {
  const clock = panel('GameTime'); clock.text = '10:42';
  const badge = panel('HeroBadge'); badge.heroid = 10;
  const local = panel('', ['LocalPlayer'], [badge]);
  const viewedBadge = panel('HeroBadge'); viewedBadge.heroid = 1;
  const viewed = panel('', ['SpectatorTarget'], [viewedBadge]);
  const roster = panel('PlayersContainer', [], [local, viewed]);
  const top = panel('TopBar', [], [panel('', ['GameClock'], [clock]),
    panel('TeamsContainer', [], [panel('TeamFriendly', [], [panel('PlayerContents', [], [roster])])])]);
  const root = panel('', [], [panel('Hud', [], [panel('', ['HudCore'], [top])]),
    panel('DeadpickDiagnostics', [], ['DeadpickClock', 'DeadpickHero', 'DeadpickStatus'].map(id => panel(id)))]);
  return { root, clock, local, badge, roster };
}

test('relógio distingue zero, pré-jogo e leitura desconhecida', () => {
  assert.deepEqual(parseClock('0:00'), { seconds: 0, text: '0:00' });
  assert.equal(parseClock('10:42').seconds, 642);
  assert.equal(parseClock('-0:05').seconds, -5);
  for (const value of [null, '', 'aguardando', '{s:game_clock}', '12:99', '1:2']) assert.equal(parseClock(value), null);
});
test('identifica LocalPlayer, ignora SpectatorTarget e não inventa identidade', () => {
  const f = fixture();
  assert.equal(readState(f.root).heroId, 10);
  f.local.classes = [];
  assert.equal(readState(f.root).heroId, null);
  f.local.classes = ['LocalPlayer'];
  f.badge.heroid = 0;
  assert.equal(readState(f.root).heroId, null);
  f.badge.heroid = 10;
  const duplicateBadge = panel('HeroBadge'); duplicateBadge.heroid = 2;
  f.roster.list.push(panel('', ['LocalPlayer'], [duplicateBadge]));
  assert.equal(readState(f.root).heroId, null);
});
test('não extrapola um relógio parado e invalida painéis destruídos', () => {
  const f = fixture();
  assert.equal(readState(f.root).clock.seconds, readState(f.root).clock.seconds);
  f.clock.alive = false;
  assert.equal(readState(f.root).clock, null);
  f.root.list = [];
  assert.equal(readState(f.root).clock, null);
  assert.equal(readState(f.root).heroId, null);
  assert.equal(readState(f.root).hudAvailable, false);
});
test('reload cancela inclusive handle zero e contexto destruído encerra o loop', () => {
  const f = fixture(); const jobs = new Map(); let next = 0;
  const api = { GetContextPanel: () => f.root, Msg() {},
    Schedule(delay, callback) { const id = next++; jobs.set(id, callback); return id; },
    CancelScheduled(id) { jobs.delete(id); } };
  attach(api); assert(jobs.has(0));
  const current = attach(api); assert(!jobs.has(0)); assert.equal(jobs.size, 1);
  const first = jobs.entries().next().value; jobs.delete(first[0]); first[1]();
  assert.match(f.root.FindChildTraverse('DeadpickClock').text, /10:42/);
  assert.match(f.root.FindChildTraverse('DeadpickHero').text, /ID 10/);
  f.root.alive = false;
  const last = jobs.entries().next().value; jobs.delete(last[0]); last[1]();
  assert.equal(jobs.size, 0); current.stop();
});
test('falha nativa retira valores antigos e mantém uma tentativa controlada', () => {
  const f = fixture(); const jobs = []; const warnings = [];
  Object.defineProperty(f.clock, 'text', { get() { throw new Error('painel substituido'); } });
  const api = { GetContextPanel: () => f.root, Msg: m => warnings.push(m),
    Schedule(delay, callback) { jobs.push({ delay, callback }); return jobs.length; }, CancelScheduled() {} };
  attach(api); jobs.shift().callback();
  assert.match(f.root.FindChildTraverse('DeadpickClock').text, /não observado/);
  assert.match(f.root.FindChildTraverse('DeadpickStatus').text, /indisponível/);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].delay, 2);
  assert(warnings.some(w => w.includes('leitura falhou')));
});
