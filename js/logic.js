// Lógica pura (sem Firebase): regras, datas e totais.
// Pode ser testada com Node: node test/logic.test.mjs

export const MEALS = ['cafe', 'almoco', 'jantar'];
export const MEAL_LABEL = { cafe: 'Café da manhã', almoco: 'Almoço', jantar: 'Jantar' };
export const MEAL_SHORT = { cafe: 'Café', almoco: 'Almoço', jantar: 'Jantar' };
export const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DOW_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Modos de uma refeição: N = horário normal, C = mais cedo, T = mais tarde, L = para levar
export const WHEN_LABEL = { N: 'normal', C: '+cedo', T: '+tarde', L: 'p/ levar' };

export const DEFAULT_SETTINGS = {
  late: { cafe: '', almoco: '14:00', jantar: '21:00' },
  early: { cafe: '', almoco: '', jantar: '' },
  deadline: '08:15', // horário-limite para mudanças, no dia em que a cozinha é avisada
};

export function mergeSettings(s) {
  s = s || {};
  return {
    late: { ...DEFAULT_SETTINGS.late, ...(s.late || {}) },
    early: { ...DEFAULT_SETTINGS.early, ...(s.early || {}) },
    deadline: s.deadline || DEFAULT_SETTINGS.deadline,
  };
}

// ---------- Grade semanal ----------
// grid = { "0": {cafe:'', almoco:'N', jantar:'T21:30'}, ..., "6": {...} }  (0 = domingo)
// Célula: '' (não faz) | 'N' | 'C' | 'T' | 'L', opcionalmente seguida de horário 'HH:MM'.

export function emptyGrid() {
  const g = {};
  for (let d = 0; d < 7; d++) g[d] = { cafe: '', almoco: '', jantar: '' };
  return g;
}

export function gridFrom(fn) {
  const g = emptyGrid();
  for (let d = 0; d < 7; d++) for (const m of MEALS) g[d][m] = fn(d, m) || '';
  return g;
}

export const PRESETS = {
  todas: { label: 'Todas as refeições', grid: () => gridFrom(() => 'N') },
  nenhuma: { label: 'Nenhuma refeição', grid: () => emptyGrid() },
  seg_jantar_sab_cafe: {
    label: '2ª jantar até sábado café',
    grid: () => gridFrom((d, m) => {
      if (d === 1) return m === 'jantar' ? 'N' : '';
      if (d >= 2 && d <= 5) return 'N';
      if (d === 6) return m === 'cafe' ? 'N' : '';
      return '';
    }),
  },
  jantar_seg_sex: { label: 'Só jantar, 2ª a 6ª', grid: () => gridFrom((d, m) => (d >= 1 && d <= 5 && m === 'jantar' ? 'N' : '')) },
  cafe_sexta: { label: 'Só café às 6ªs', grid: () => gridFrom((d, m) => (d === 5 && m === 'cafe' ? 'N' : '')) },
};

export function parseCell(code) {
  if (!code) return { on: false, when: 'N', time: '' };
  const when = 'NCTL'.includes(code[0]) ? code[0] : 'N';
  return { on: true, when, time: code.slice(1) || '' };
}

export function cellCode({ on, when, time }) {
  if (!on) return '';
  return (when || 'N') + (when && when !== 'N' && time ? time : '');
}

// ---------- Datas (sempre no fuso local, formato YYYY-MM-DD) ----------

export function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export const today = () => ymd(new Date());
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const weekday = (s) => parseYmd(s).getDay();
export function fmtDate(s, long = false) {
  const d = parseYmd(s);
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${(long ? DOW_LONG : DOW)[d.getDay()]} ${dd}/${mm}`;
}

// ---------- Resolução: o que vale para pessoa X, dia D, refeição M ----------

export const ovKey = (personId, date, meal) => `${personId}|${date}|${meal}`;

export function overrideMap(overrides) {
  const m = new Map();
  for (const o of overrides || []) m.set(ovKey(o.personId, o.date, o.meal), o);
  return m;
}

// ---------- Repetição mensal ----------
// period.repeat = { nth: 1..4 | -1 (último), dow: 0..6, start: -k (dias antes), end: k (dias depois) }
// Ex.: MB — fim de semana do 1º domingo, sábado a domingo: { nth: 1, dow: 0, start: -1, end: 0 }
export const NO_END = '9999-12-31';
export const NTH_LABEL = { 1: '1º', 2: '2º', 3: '3º', 4: '4º', '-1': 'último' };

function isNthWeekday(date, nth) {
  const d = parseYmd(date);
  const day = d.getDate();
  if (nth === -1) return day + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.ceil(day / 7) === nth;
}

// Período único pode começar/terminar no meio do dia: fromMeal = 1ª refeição atingida no 1º dia,
// toMeal = última refeição atingida no último dia (padrão: o dia inteiro).
export function occursOn(p, date, meal) {
  if (p.from > date || (p.to || NO_END) < date) return false;
  const r = p.repeat;
  if (!r) {
    if (!meal) return true;
    const i = MEALS.indexOf(meal);
    if (date === p.from && p.fromMeal && i < MEALS.indexOf(p.fromMeal)) return false;
    if (date === p.to && p.toMeal && i > MEALS.indexOf(p.toMeal)) return false;
    return true;
  }
  for (let off = r.start || 0; off <= (r.end || 0); off++) {
    const anchor = addDays(date, -off);
    if (weekday(anchor) === r.dow && isNthWeekday(anchor, Number(r.nth))) return true;
  }
  return false;
}

export function describeRepeat(r) {
  if (!r) return '';
  const base = `${NTH_LABEL[r.nth]} ${DOW_LONG[r.dow].toLowerCase()} de cada mês`;
  if (!r.start && !r.end) return base;
  const a = DOW_LONG[(r.dow + (r.start || 0) + 7) % 7].toLowerCase(), b = DOW_LONG[(r.dow + (r.end || 0) + 7) % 7].toLowerCase();
  return `${base} (de ${a} a ${b})`;
}

// Regra temporária vigente: a criada por último entre as que cobrem a data.
export function activePeriod(periods, personId, date, meal) {
  let best = null;
  for (const p of periods || []) {
    if (p.personId !== personId || !occursOn(p, date, meal)) continue;
    if (!best || (p.createdAt || 0) > (best.createdAt || 0)) best = p;
  }
  return best;
}

export function resolve(person, date, meal, periods, ovMap, settings) {
  settings = mergeSettings(settings);
  const per = activePeriod(periods, person.id, date, meal);
  const grid = per ? per.grid || emptyGrid() : person.defaultRule || emptyGrid();
  const c = parseCell(grid?.[weekday(date)]?.[meal]);
  const r = {
    on: c.on, when: c.when, time: c.time, note: '',
    source: per ? 'temporária' : 'padrão', periodLabel: per ? per.label || '' : '',
  };
  const ov = ovMap && ovMap.get(ovKey(person.id, date, meal));
  if (ov) {
    if (ov.status) { // entrada só com observação (sem status) mantém a regra
      r.on = ov.status === 'on';
      r.when = ov.when || 'N';
      r.time = ov.time || '';
      r.source = 'pontual';
    }
    r.note = ov.note || '';
    r.noteId = ov.noteId || null;
    r.noteApproved = !!ov.noteApproved;
  }
  if (!r.on) { r.when = 'N'; r.time = ''; }
  r.timeShown = r.when === 'C' ? r.time || settings.early[meal] || ''
    : r.when === 'T' ? r.time || settings.late[meal] || ''
    : r.when === 'L' ? r.time : '';
  return r;
}

// Totais de um dia para a cozinha / administrador.
export function summarize(people, date, periods, overrides, settings) {
  const ovMap = overrideMap(overrides);
  const out = {};
  const active = (people || []).filter((p) => p.active !== false)
    .sort((a, b) => (a.initials || '').localeCompare(b.initials || ''));
  for (const meal of MEALS) {
    const s = { total: 0, diet: 0, normal: [], early: [], late: [], takeaway: [], dietAbsent: [], notes: [] };
    for (const p of active) {
      const r = resolve(p, date, meal, periods, ovMap, settings);
      const item = { id: p.id, initials: p.initials, diet: !!p.diet, guest: !!p.guest, ...r };
      if (r.on) {
        s.total++;
        if (p.diet) s.diet++;
        ({ N: s.normal, C: s.early, T: s.late, L: s.takeaway })[r.when].push(item);
        if (r.note) s.notes.push(item);
      } else {
        if (p.diet) s.dietAbsent.push(item);
        if (r.note) s.notes.push(item); // ex.: "não venho, mas guardem um prato"
      }
    }
    const byTime = (a, b) => (a.timeShown || '').localeCompare(b.timeShown || '');
    s.early.sort(byTime); s.late.sort(byTime);
    out[meal] = s;
  }
  return out;
}

// ---------- Recados do administrador (podem somar pessoas extras a uma refeição) ----------
// note = { date, meal: '' | 'cafe' | 'almoco' | 'jantar', text, extra: n }
export function applyDayNotes(summary, notes) {
  for (const m of MEALS) { summary[m].extras = 0; summary[m].dayNotes = []; }
  for (const n of notes || []) {
    const meals = n.meal ? [n.meal] : [];
    for (const m of meals) {
      if (!summary[m]) continue;
      summary[m].dayNotes.push(n);
      const x = Math.max(0, Number(n.extra) || 0);
      summary[m].extras += x;
      summary[m].total += x;
    }
  }
  return summary;
}

// Resumo numérico de um dia (o que é guardado como "fotografia" diária para estatísticas).
export function snapshotOf(summary) {
  const out = {};
  for (const m of MEALS) {
    const s = summary[m];
    out[m] = { total: s.total, diet: s.diet, early: s.early.length, late: s.late.length,
      takeaway: s.takeaway.length, extras: s.extras || 0 };
  }
  return out;
}

// Estatísticas de um período. days = [{ date, meals: snapshotOf(...) }]; meal = '' (todas) ou 'cafe'...
export function aggregate(days, meal = '') {
  const pick = (d) => (meal ? d.meals[meal].total : MEALS.reduce((a, m) => a + d.meals[m].total, 0));
  const vals = days.map(pick);
  const sum = vals.reduce((a, b) => a + b, 0);
  let max = -1, min = Infinity, maxDate = '', minDate = '';
  days.forEach((d, i) => {
    if (vals[i] > max) { max = vals[i]; maxDate = d.date; }
    if (vals[i] < min) { min = vals[i]; minDate = d.date; }
  });
  const byDow = Array.from({ length: 7 }, () => ({ n: 0, cafe: 0, almoco: 0, jantar: 0 }));
  const counts = { early: 0, late: 0, takeaway: 0, extras: 0, diet: 0 };
  for (const d of days) {
    const w = byDow[weekday(d.date)];
    w.n++;
    for (const m of MEALS) {
      w[m] += d.meals[m].total;
      if (!meal || meal === m) for (const k of Object.keys(counts)) counts[k] += d.meals[m][k] || 0;
    }
  }
  return {
    days: days.length, sum, avg: days.length ? sum / days.length : 0,
    max: days.length ? max : 0, maxDate, min: days.length ? min : 0, minDate, counts,
    byDow: byDow.map((w) => ({ n: w.n, cafe: w.n ? w.cafe / w.n : 0, almoco: w.n ? w.almoco / w.n : 0, jantar: w.n ? w.jantar / w.n : 0 })),
  };
}

// ---------- Importação da planilha ----------
// rows = matriz de células (1ª linha = cabeçalho). Colunas reconhecidas (sem diferenciar acentos/maiúsculas):
// Iniciais | E-mail | Nome | Regime | Papel | "Seg Café", "Seg Almoço", ... "Dom Jantar"
// Célula de refeição: vazio = não faz; x = faz; cedo / tarde / levar, opcionalmente com horário ("tarde 21:30").
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const DOW_KEYS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const MEAL_KEYS = { cafe: 'cafe', almoco: 'almoco', jantar: 'jantar' };
const YES = ['x', 's', 'sim', '1', 'true', 'verdadeiro', '✓', 'v', 'ok'];
export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

function parseTime(s) {
  const m = s.match(/(\d{1,2})\s*(?:[:h]\s*(\d{2}))?/);
  if (!m) return '';
  const h = Number(m[1]), mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function parseImportCell(v) {
  const s = norm(v);
  if (!s || s === '-' || s === 'nao' || s === 'n') return { code: '' };
  if (YES.includes(s) || s === 'normal') return { code: 'N' };
  const kinds = [['cedo', 'C'], ['tarde', 'T'], ['levar', 'L']];
  for (const [k, c] of kinds) if (s.includes(k)) return { code: c + parseTime(s.replace(k, '')) };
  return { code: 'N', warning: `valor “${v}” não reconhecido (considerado “x”)` };
}

export function parseImportRows(rows) {
  rows = (rows || []).filter((r) => r && r.some((c) => String(c ?? '').trim() !== ''));
  if (!rows.length) return { records: [], error: 'Planilha vazia.' };
  const head = rows[0].map(norm);
  const col = { initials: -1, email: -1, name: -1, diet: -1, role: -1, cells: [] };
  head.forEach((h, i) => {
    if (h.startsWith('inicia')) col.initials = i;
    else if (h === 'e-mail' || h === 'email') col.email = i;
    else if (h.startsWith('nome')) col.name = i;
    else if (h.startsWith('regime')) col.diet = i;
    else if (h.startsWith('papel') || h.startsWith('perfil')) col.role = i;
    else {
      const m = h.match(/^(dom|seg|ter|qua|qui|sex|sab)\w*\.?\s+(cafe|almoco|jantar)/);
      if (m) col.cells.push({ i, d: DOW_KEYS[m[1]], meal: MEAL_KEYS[m[2]] });
    }
  });
  let body = rows.slice(1);
  if (col.initials < 0) { // sem cabeçalho: A = iniciais, B = e-mail, C = nome
    Object.assign(col, { initials: 0, email: 1, name: 2 });
    body = rows;
  }
  const hasRule = col.cells.length > 0;
  const seen = new Set();
  const records = body.map((r, k) => {
    const get = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const rec = {
      line: k + (body === rows ? 1 : 2), initials: get(col.initials).toUpperCase(), email: get(col.email).toLowerCase(),
      fullName: get(col.name), diet: col.diet >= 0 ? YES.includes(norm(get(col.diet))) : null,
      role: col.role >= 0 && norm(get(col.role)).startsWith('admin') ? 'admin' : 'comensal',
      grid: null, errors: [], warnings: [],
    };
    if (!rec.initials) rec.errors.push('sem iniciais');
    else if (seen.has(rec.initials)) rec.errors.push('iniciais repetidas');
    seen.add(rec.initials);
    if (rec.email && !isEmail(rec.email)) rec.warnings.push('e-mail inválido: não será criado login');
    if (hasRule) {
      rec.grid = emptyGrid();
      for (const c of col.cells) {
        const p = parseImportCell(r[c.i]);
        rec.grid[c.d][c.meal] = p.code;
        if (p.warning) rec.warnings.push(`${DOW[c.d]} ${MEAL_SHORT[c.meal]}: ${p.warning}`);
      }
      if (MEALS.every((m) => [0, 1, 2, 3, 4, 5, 6].every((d) => !rec.grid[d][m]))) rec.warnings.push('nenhuma refeição marcada');
    }
    return rec;
  });
  return { records, hasRule, hasDiet: col.diet >= 0 };
}

// ---------- Prazo de aviso à cozinha ----------
// A cozinha é avisada às 8h30: almoço e jantar do dia + café do dia seguinte. Na sexta, avisa-se
// todo o fim de semana (até o café de segunda). O prazo para mudanças é settings.deadline (8h15) desse dia.
export const MEAL_END = { cafe: '10:00', almoco: '15:00', jantar: '22:00' }; // depois disso a refeição "passou"
export const AUDIENCE = { estudantes: 'estudantes', profissionais: 'profissionais', misto: 'estudantes e profissionais' };

export function announceDate(date, meal) {
  let d = meal === 'cafe' ? addDays(date, -1) : date;
  const w = weekday(d);
  if (w === 6) d = addDays(d, -1);
  else if (w === 0) d = addDays(d, -2);
  return d;
}
export const nowStamp = (now = new Date()) =>
  `${ymd(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
export const deadlineOf = (date, meal, settings) => `${announceDate(date, meal)} ${mergeSettings(settings).deadline}`;

// 'open' = dá para mudar; 'late' = cozinha já avisada (muda com alerta); 'past' = refeição já passou
export function mealStatus(date, meal, settings, now = new Date()) {
  const n = nowStamp(now);
  if (`${date} ${MEAL_END[meal]}` <= n) return 'past';
  if (deadlineOf(date, meal, settings) <= n) return 'late';
  return 'open';
}
export function fmtDeadline(date, meal, settings) {
  const [d, h] = deadlineOf(date, meal, settings).split(' ');
  return `${h.replace(':', 'h')} de ${fmtDate(d).toLowerCase()}`;
}

// Refeições já avisadas e ainda por acontecer
export function announcedMeals(settings, now = new Date()) {
  const out = [];
  const t = ymd(now);
  for (let i = 0; i <= 4; i++) {
    const d = addDays(t, i);
    for (const m of MEALS) if (mealStatus(d, m, settings, now) === 'late') out.push({ date: d, meal: m });
  }
  return out;
}

// Estado de uma refeição em texto (sem a observação, que pode ser privada do administrador)
export function describeState(r) {
  if (!r.on) return 'não faz';
  return r.when === 'N' ? 'faz' : `faz ${WHEN_LABEL[r.when]}${r.timeShown ? ' ' + r.timeShown : ''}`;
}

// Diferenças, nas refeições já avisadas, entre duas situações de uma pessoa (antes/depois de uma mudança).
// a e b = { person, periods, ovMap }
export function lateDiffs(a, b, settings, now = new Date()) {
  const out = [];
  for (const { date, meal } of announcedMeals(settings, now)) {
    const r0 = resolve(a.person, date, meal, a.periods, a.ovMap, settings);
    const r1 = resolve(b.person, date, meal, b.periods, b.ovMap, settings);
    const s0 = describeState(r0), s1 = describeState(r1);
    if (s0 !== s1) out.push({ date, meal, text: `${MEAL_SHORT[meal]} ${fmtDate(date).toLowerCase()}: ${s0} → ${s1}` });
  }
  return out;
}

// ---------- Churrasco (substitui a contagem da refeição) ----------
// event = { date, meal, type: 'churrasco', count, audience: 'estudantes' | 'profissionais' | 'misto', note }
export function applyEvents(summary, events) {
  for (const e of events || []) {
    const s = summary[e.meal];
    if (!s) continue;
    s.event = e;
    s.residents = s.total - (s.extras || 0);
    s.total = Math.max(0, Number(e.count) || 0) + (s.extras || 0);
  }
  return summary;
}

// Texto curto de um período: "ter 13/10 (jantar) a sex 16/10 (almoço)" ou a repetição mensal
export function describePeriod(p) {
  if (p.repeat) return describeRepeat(p.repeat) + (p.to && p.to !== NO_END ? ` até ${fmtDate(p.to).toLowerCase()}` : '');
  const a = fmtDate(p.from).toLowerCase() + (p.fromMeal && p.fromMeal !== 'cafe' ? ` (${MEAL_SHORT[p.fromMeal].toLowerCase()})` : '');
  const b = fmtDate(p.to).toLowerCase() + (p.toMeal && p.toMeal !== 'jantar' ? ` (${MEAL_SHORT[p.toMeal].toLowerCase()})` : '');
  return p.from === p.to && !p.fromMeal && !p.toMeal ? a : `${a} a ${b}`;
}

// ---------- Observações dos comensais (coleção à parte; a cozinha só lê as liberadas) ----------
// note = { id, personId, date, meal, text, approved }
export function mergeNotes(overrides, notes) {
  const m = new Map((overrides || []).map((o) => [ovKey(o.personId, o.date, o.meal), { ...o, note: '' }]));
  for (const n of notes || []) {
    const k = ovKey(n.personId, n.date, n.meal);
    m.set(k, { ...(m.get(k) || { personId: n.personId, date: n.date, meal: n.meal }), note: n.text, noteId: n.id, noteApproved: !!n.approved });
  }
  return [...m.values()];
}

export const isBbqMeal = (date, meal) => meal === 'almoco' && [0, 6].includes(weekday(date));
