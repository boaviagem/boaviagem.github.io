// Testes da lógica pura. Rodar: node test/logic.test.mjs  (ou abrir test/index.html no navegador)
const assert = {
  equal(a, b) { if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); },
  deepEqual(a, b) { assert.equal(JSON.stringify(a), JSON.stringify(b)); },
};
import * as L from '../js/logic.js';

const gn = { id: 'gn', initials: 'GN', defaultRule: L.PRESETS.seg_jantar_sab_cafe.grid() };
// GN janta mais tarde de 2ª a 6ª
for (let d = 1; d <= 5; d++) gn.defaultRule[d].jantar = 'T';
const rl = { id: 'rl', initials: 'RL', diet: true, defaultRule: L.PRESETS.todas.grid() };
const jf = { id: 'jf', initials: 'JF', defaultRule: L.PRESETS.cafe_sexta.grid() };
const people = [gn, rl, jf];

// 2026-10-12 é segunda-feira
assert.equal(L.weekday('2026-10-12'), 1);
const r = (p, d, m, per = [], ov = []) => L.resolve(p, d, m, per, L.overrideMap(ov), {});

assert.equal(r(gn, '2026-10-12', 'almoco').on, false);
assert.equal(r(gn, '2026-10-12', 'jantar').on, true);
assert.equal(r(gn, '2026-10-12', 'jantar').timeShown, '21:00');
assert.equal(r(gn, '2026-10-17', 'cafe').on, true);   // sábado café
assert.equal(r(gn, '2026-10-17', 'almoco').on, false);
assert.equal(r(jf, '2026-10-16', 'cafe').on, true);   // sexta
assert.equal(r(jf, '2026-10-15', 'cafe').on, false);

// Regra temporária (viagem) e prevalência da mais recente
const viagem = { personId: 'rl', from: '2026-10-13', to: '2026-10-15', grid: L.emptyGrid(), createdAt: 1, label: 'Viagem' };
assert.equal(r(rl, '2026-10-14', 'almoco', [viagem]).on, false);
assert.equal(r(rl, '2026-10-16', 'almoco', [viagem]).on, true);
const volta = { personId: 'rl', from: '2026-10-15', to: '2026-10-15', grid: L.PRESETS.todas.grid(), createdAt: 2 };
assert.equal(r(rl, '2026-10-15', 'almoco', [viagem, volta]).on, true);

// Pontual: mais cedo com horário, observação, desmarcar
const ov = [
  { personId: 'rl', date: '2026-10-12', meal: 'almoco', status: 'on', when: 'C', time: '12:00', note: '' },
  { personId: 'gn', date: '2026-10-12', meal: 'jantar', status: 'on', when: 'N', note: '+leve' },
  { personId: 'rl', date: '2026-10-12', meal: 'jantar', status: 'off' },
];
const s = L.summarize(people, '2026-10-12', [], ov, {});
assert.equal(s.almoco.total, 1);
assert.equal(s.almoco.early[0].timeShown, '12:00');
assert.equal(s.jantar.total, 1);
assert.equal(s.jantar.notes[0].note, '+leve');
assert.deepEqual(s.jantar.dietAbsent.map((x) => x.initials), ['RL']);
assert.equal(s.cafe.total, 1); // só RL (GN começa no jantar de 2ª)

// Células com horário
assert.deepEqual(L.parseCell('T21:30'), { on: true, when: 'T', time: '21:30' });
assert.equal(L.cellCode({ on: true, when: 'C', time: '18:30' }), 'C18:30');
assert.equal(L.cellCode({ on: false }), '');

// Recados com pessoas extras
const s2 = L.applyDayNotes(L.summarize(people, '2026-10-12', [], [], {}), [
  { date: '2026-10-12', meal: 'almoco', text: 'Marceneiro almoça', extra: 1 },
  { date: '2026-10-12', meal: '', text: 'Geral', extra: 5 },
]);
assert.equal(s2.almoco.total, 2);
assert.equal(s2.almoco.extras, 1);
assert.equal(s2.jantar.extras, 0);

// Estatísticas
const days = ['2026-10-12', '2026-10-13'].map((d) => ({ date: d, meals: L.snapshotOf(L.applyDayNotes(L.summarize(people, d, [], [], {}), [])) }));
const ag = L.aggregate(days, 'jantar');
assert.equal(ag.sum, 4); // GN + RL em cada dia
assert.equal(ag.byDow[1].jantar, 2);
assert.equal(L.aggregate(days).sum, (1 + 1 + 2) + (2 + 2 + 2)); // seg: RL, RL, GN+RL · ter: GN+RL em todas

// Importação da planilha
const rows = [
  ['Iniciais', 'E-mail', 'Nome', 'Regime', 'Papel', 'Seg Café', 'Seg Jantar', 'Sáb Café', 'Obs'],
  ['gn', 'GN@x.org', 'Fulano', '', 'comensal', '', 'tarde', 'x', ''],
  ['RL', 'a@b.com2@c.com', 'Ciclano', 'sim', 'admin', 'cedo 7h30', 'x', '', ''],
  ['GN', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', ''],
];
const imp = L.parseImportRows(rows);
assert.equal(imp.records.length, 3);
assert.equal(imp.records[0].initials, 'GN');
assert.equal(imp.records[0].email, 'gn@x.org');
assert.equal(imp.records[0].grid[1].jantar, 'T');
assert.equal(imp.records[0].grid[6].cafe, 'N');
assert.equal(imp.records[0].diet, false);
assert.equal(imp.records[1].grid[1].cafe, 'C07:30');
assert.equal(imp.records[1].diet, true);
assert.equal(imp.records[1].role, 'admin');
assert.equal(imp.records[1].warnings.length, 1); // e-mail inválido
assert.deepEqual(imp.records[2].errors, ['iniciais repetidas']);
// Planilha antiga, sem cabeçalho
const old = L.parseImportRows([['LK', 'lk@x.org', 'Nome LK']]);
assert.equal(old.records[0].fullName, 'Nome LK');
assert.equal(old.hasRule, false);

console.log('OK — todos os testes passaram');
export default 'OK';
