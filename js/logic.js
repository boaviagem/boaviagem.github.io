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
};

export function mergeSettings(s) {
  s = s || {};
  return {
    late: { ...DEFAULT_SETTINGS.late, ...(s.late || {}) },
    early: { ...DEFAULT_SETTINGS.early, ...(s.early || {}) },
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

export function occursOn(p, date) {
  if (p.from > date || (p.to || NO_END) < date) return false;
  const r = p.repeat;
  if (!r) return true;
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
export function activePeriod(periods, personId, date) {
  let best = null;
  for (const p of periods || []) {
    if (p.personId !== personId || !occursOn(p, date)) continue;
    if (!best || (p.createdAt || 0) > (best.createdAt || 0)) best = p;
  }
  return best;
}

export function resolve(person, date, meal, periods, ovMap, settings) {
  settings = mergeSettings(settings);
  const per = activePeriod(periods, person.id, date);
  const grid = per ? per.grid || emptyGrid() : person.defaultRule || emptyGrid();
  const c = parseCell(grid?.[weekday(date)]?.[meal]);
  const r = {
    on: c.on, when: c.when, time: c.time, note: '',
    source: per ? 'temporária' : 'padrão', periodLabel: per ? per.label || '' : '',
  };
  const ov = ovMap && ovMap.get(ovKey(person.id, date, meal));
  if (ov) {
    r.on = ov.status === 'on';
    r.when = ov.when || 'N';
    r.time = ov.time || '';
    r.note = ov.note || '';
    r.source = 'pontual';
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
