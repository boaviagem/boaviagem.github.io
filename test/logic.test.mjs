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
  { personId: 'gn', date: '2026-10-12', meal: 'jantar', status: 'on', when: 'N' },
  { personId: 'rl', date: '2026-10-12', meal: 'jantar', status: 'off' },
];
const s = L.summarize(people, '2026-10-12', [], L.mergeNotes(ov, [{ id: 'n1', personId: 'gn', date: '2026-10-12', meal: 'jantar', text: '+leve', approved: false }]), {});
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

// Repetição mensal: fim de semana do 1º domingo (sábado jantar → domingo almoço)
const mbGrid = L.emptyGrid(); mbGrid[6].jantar = 'N'; mbGrid[0].cafe = 'N'; mbGrid[0].almoco = 'N';
const mb = { id: 'mb', initials: 'MB', defaultRule: L.emptyGrid() };
const rep = { personId: 'mb', from: '2026-10-12', to: L.NO_END, grid: mbGrid, createdAt: 1, repeat: { nth: 1, dow: 0, start: -1, end: 0 } };
const on = (d, m) => L.resolve(mb, d, m, [rep], null, {}).on;
assert.equal(on('2026-10-31', 'jantar'), true);   // sábado antes do 1º domingo de novembro
assert.equal(on('2026-11-01', 'almoco'), true);
assert.equal(on('2026-11-01', 'jantar'), false);
assert.equal(on('2026-11-07', 'jantar'), false);  // sábado seguinte: 2º domingo não conta
assert.equal(on('2027-08-01', 'almoco'), true);   // 1º domingo de agosto/2027
assert.equal(on('2027-07-31', 'jantar'), true);   // sábado em julho, véspera
assert.equal(on('2026-10-03', 'jantar'), false);  // antes do início
const last = { ...rep, repeat: { nth: -1, dow: 5, start: 0, end: 0 } }; // última sexta
assert.equal(L.occursOn(last, '2026-10-30'), true);
assert.equal(L.occursOn(last, '2026-10-23'), false);
assert.equal(L.describeRepeat(rep.repeat), '1º domingo de cada mês (de sábado a domingo)');

// Prazo de aviso (8h15): seg 12/10/2026
const at = (d, h) => { const [y, mo, da] = d.split('-').map(Number); const [hh, mm] = h.split(':').map(Number); return new Date(y, mo - 1, da, hh, mm); };
assert.equal(L.announceDate('2026-10-13', 'almoco'), '2026-10-13'); // ter almoço → ter
assert.equal(L.announceDate('2026-10-14', 'cafe'), '2026-10-13');   // qua café → ter
assert.equal(L.announceDate('2026-10-17', 'cafe'), '2026-10-16');   // sáb café → sex
assert.equal(L.announceDate('2026-10-18', 'jantar'), '2026-10-16'); // dom jantar → sex
assert.equal(L.announceDate('2026-10-19', 'cafe'), '2026-10-16');   // seg café → sex
assert.equal(L.announceDate('2026-10-19', 'almoco'), '2026-10-19'); // seg almoço → seg
assert.equal(L.mealStatus('2026-10-13', 'almoco', {}, at('2026-10-13', '08:14')), 'open');
assert.equal(L.mealStatus('2026-10-13', 'almoco', {}, at('2026-10-13', '08:15')), 'late');
assert.equal(L.mealStatus('2026-10-13', 'almoco', {}, at('2026-10-13', '15:00')), 'past');
assert.equal(L.mealStatus('2026-10-13', 'jantar', {}, at('2026-10-12', '23:00')), 'open');
assert.equal(L.mealStatus('2026-10-18', 'almoco', {}, at('2026-10-16', '09:00')), 'late');
assert.equal(L.mealStatus('2026-10-18', 'almoco', {}, at('2026-10-15', '20:00')), 'open');
assert.equal(L.mealStatus('2026-10-12', 'jantar', {}, at('2026-10-13', '07:00')), 'past');
assert.equal(L.mealStatus('2026-10-13', 'almoco', { deadline: '09:00' }, at('2026-10-13', '08:30')), 'open');
// sexta 9h: avisadas = café de sex (avisado na quinta, ainda não passou), almoço/jantar de sex, sáb, dom, café de seg
const ann = L.announcedMeals({}, at('2026-10-16', '09:00')).map((x) => x.date.slice(8) + x.meal[0]);
assert.deepEqual(ann, ['16c', '16a', '16j', '17c', '17a', '17j', '18c', '18a', '18j', '19c']);
// Diferenças tardias
const ovLate = L.overrideMap([{ personId: 'rl', date: '2026-10-16', meal: 'almoco', status: 'off' }]);
const dif = L.lateDiffs({ person: rl, periods: [], ovMap: null }, { person: rl, periods: [], ovMap: ovLate }, {}, at('2026-10-16', '09:00'));
assert.equal(dif.length, 1);
assert.equal(dif[0].text, 'Almoço sex 16/10: faz → não faz');

// Churrasco: total = participantes + extras
const s3 = L.applyEvents(L.applyDayNotes(L.summarize(people, '2026-10-17', [], [], {}), [{ date: '2026-10-17', meal: 'almoco', extra: 2, text: 'x' }]),
  [{ date: '2026-10-17', meal: 'almoco', type: 'churrasco', count: 25, audience: 'estudantes' }]);
assert.equal(s3.almoco.total, 27);
assert.equal(s3.almoco.residents, 1); // RL
assert.equal(s3.almoco.event.count, 25);

// Ausência começando no jantar de ter e terminando no almoço de sex
const trip = { personId: 'rl', from: '2026-10-13', to: '2026-10-16', fromMeal: 'jantar', toMeal: 'almoco', grid: L.emptyGrid(), createdAt: 5 };
const onT = (d, m) => L.resolve(rl, d, m, [trip], null, {}).on;
assert.equal(onT('2026-10-13', 'almoco'), true);
assert.equal(onT('2026-10-13', 'jantar'), false);
assert.equal(onT('2026-10-14', 'cafe'), false);
assert.equal(onT('2026-10-16', 'almoco'), false);
assert.equal(onT('2026-10-16', 'jantar'), true);
assert.equal(L.describePeriod(trip), 'ter 13/10 (jantar) a sex 16/10 (almoço)');
assert.equal(L.describePeriod({ from: '2026-10-13', to: '2026-10-14' }), 'ter 13/10 a qua 14/10');

// Observação sem mudança de status mantém a regra; notas de outros não vazam
const onlyNote = L.mergeNotes([], [{ id: 'n2', personId: 'rl', date: '2026-10-13', meal: 'almoco', text: 'sem sal', approved: true }]);
const rn = L.resolve(rl, '2026-10-13', 'almoco', [], L.overrideMap(onlyNote), {});
assert.equal(rn.on, true);
assert.equal(rn.source, 'padrão');
assert.equal(rn.note, 'sem sal');
assert.equal(rn.noteApproved, true);
// override antigo com nota embutida: mergeNotes descarta o texto antigo
const legacy = L.mergeNotes([{ personId: 'rl', date: '2026-10-13', meal: 'almoco', status: 'off', note: 'antigo' }], []);
assert.equal(legacy[0].note, '');
assert.equal(L.describeState({ on: true, when: 'N', note: 'x' }), 'faz');
assert.equal(L.isBbqMeal('2026-10-17', 'almoco'), true);
assert.equal(L.isBbqMeal('2026-10-17', 'jantar'), false);
assert.equal(L.isBbqMeal('2026-10-16', 'almoco'), false);

// Aniversários
const bp = [{ id: 'a', initials: 'AA', birthday: '10-14' }, { id: 'b', initials: 'BB', birthday: '01-02', active: false }];
assert.deepEqual(L.birthdaysBetween(bp, '2026-10-12', 7).map((x) => x.date + x.person.initials), ['2026-10-14AA']);
assert.equal(L.birthdaysBetween(bp, '2026-12-30', 5).length, 0); // BB inativo
assert.equal(L.fmtBday('10-14'), '14/10');

// Observações anônimas para a cozinha
const sk = L.applyKitchenNotes(L.summarize(people, '2026-10-12', [], [], {}), [{ id: 'k1', date: '2026-10-12', meal: 'jantar', text: '+leve' }]);
assert.equal(sk.jantar.anonNotes.length, 1);
assert.equal(sk.almoco.anonNotes.length, 0);
assert.equal(sk.jantar.anonNotes[0].personId, undefined);

console.log('OK — todos os testes passaram');
export default 'OK';
