// Camada de dados — modo demonstração (sem Firebase; dados guardados só neste navegador).
// Abra index.html?demo para usar. Serve para conhecer o app e testar a interface.
import * as L from './logic.js';

const KEY = 'comensais-demo-v2';

function seed() {
  const people = {}, names = {};
  const add = (id, initials, fullName, rule, diet = false, uid = null) => {
    people[id] = { initials, diet, guest: false, active: true, uid, defaultRule: rule, createdAt: Date.now() };
    names[id] = { fullName, email: `${id}@exemplo.org` };
  };
  const todas = L.PRESETS.todas.grid;
  add('rv', 'RV', 'Comensal RV', todas(), true);
  add('lk', 'LK', 'Comensal LK', todas(), false, 'u-admin');
  add('pr', 'PR', 'Comensal PR', todas(), true);
  add('rl', 'RL', 'Comensal RL', todas(), true);
  add('lb', 'LB', 'Comensal LB', todas());
  add('lgl', 'LGL', 'Comensal LGL', todas());
  const gn = L.PRESETS.seg_jantar_sab_cafe.grid();
  for (let d = 1; d <= 5; d++) gn[d].jantar = 'T';
  add('gn', 'GN', 'Comensal GN', gn, false, 'u-gn');
  add('jf', 'JF', 'Comensal JF', L.PRESETS.cafe_sexta.grid());
  add('sc', 'SC', 'Comensal SC', todas(), true);
  const users = {
    'u-admin': { role: 'admin', personId: 'lk', email: 'admin@demo' },
    'u-gn': { role: 'comensal', personId: 'gn', email: 'gn@demo' },
    'u-cozinha': { role: 'cozinha', personId: null, email: 'cozinha@demo' },
    'u-aux': { role: 'auxiliar', personId: null, email: 'auxiliar@demo' },
    'u-cl': { role: 'cl', personId: 'rv', email: 'cl@demo' },
  };
  const t = L.today();
  const overrides = {
    [`pr_${t}_almoco`]: { personId: 'pr', date: t, meal: 'almoco', status: 'on', when: 'C', time: '12:00', note: '' },
    [`lb_${t}_jantar`]: { personId: 'lb', date: t, meal: 'jantar', status: 'on', when: 'N', time: '', note: 'jantar +leve' },
    [`sc_${t}_jantar`]: { personId: 'sc', date: t, meal: 'jantar', status: 'off', when: 'N', time: '', note: '' },
  };
  const periods = {
    p1: { personId: 'lgl', from: L.addDays(t, 2), to: L.addDays(t, 5), grid: L.emptyGrid(), label: 'Viagem', createdAt: 1 },
  };
  const dayNotes = {
    n1: { date: t, meal: 'almoco', text: 'O marceneiro almoça hoje', extra: 1, createdAt: 1 },
  };
  const messages = {
    m1: { dir: 'k2a', text: 'Precisamos comprar mais pão para o café de sábado.', from: 'u-cozinha', fromEmail: 'cozinha@demo', createdAt: Date.now() - 3600e3, readAt: null },
  };
  // Histórico fictício para as estatísticas
  const daily = {};
  for (let i = 1; i <= 60; i++) {
    const d = L.addDays(t, -i), w = L.weekday(d), base = w === 0 || w === 6 ? 6 : 8;
    const r = (k) => Math.max(0, base + ((i * 7 + k * 3) % 4) - 1);
    daily[d] = { date: d, meals: Object.fromEntries(L.MEALS.map((m, k) => [m,
      { total: r(k), diet: 3 + (i % 2), early: (i + k) % 3 === 0 ? 1 : 0, late: k === 2 ? 1 : 0, takeaway: 0, extras: 0 }])) };
  }
  const events = {}, alerts = {};
  return { users, people, names, overrides, periods, dayNotes, messages, daily, events, alerts, settings: { app: L.mergeSettings({}) }, bootstrap: true };
}

export function createDemoApi() {
  let st;
  try { st = JSON.parse(localStorage.getItem(KEY)); } catch { st = null; }
  if (!st) st = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* sem storage */ } };
  const list = (o) => Object.entries(o).map(([id, v]) => ({ id, ...structuredClone(v) }));
  const get = (o, id) => (o[id] ? { id, ...structuredClone(o[id]) } : null);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const later = (v) => new Promise((r) => setTimeout(() => r(v), 60));
  let authCb = null, current = null;
  try { current = JSON.parse(sessionStorage.getItem(KEY + '-who')); } catch { /* */ }

  return {
    demo: true,
    reset() { st = seed(); save(); },
    onAuth(cb) { authCb = cb; setTimeout(() => cb(current), 0); return () => {}; },
    async signIn(who) {
      const u = st.users[who];
      if (!u) throw new Error('Conta de demonstração inexistente');
      current = { uid: who, email: u.email };
      try { sessionStorage.setItem(KEY + '-who', JSON.stringify(current)); } catch { /* */ }
      authCb?.(current);
    },
    async signOut() { current = null; try { sessionStorage.removeItem(KEY + '-who'); } catch { /* */ } authCb?.(null); },
    resetPassword: async () => later(),
    changePassword: async () => later(),
    setNewPassword: async () => later(),

    getProfile: async (u) => later(get(st.users, u)),
    bootstrapExists: async () => true,
    bootstrapAdmin: async () => {},

    getSettings: async () => later(structuredClone(st.settings.app)),
    async saveSettings(s) { st.settings.app = s; save(); },

    listPeople: async () => later(list(st.people)),
    getPerson: async (pid) => later(get(st.people, pid)),
    async updatePerson(pid, data) { Object.assign(st.people[pid], structuredClone(data)); save(); },
    listNames: async () => later(Object.fromEntries(list(st.names).map((n) => [n.id, n]))),
    getName: async (pid) => later(get(st.names, pid)),
    listUsers: async () => later(list(st.users)),

    clearMustChange: async (u) => { if (st.users[u]) st.users[u].mustChange = false; save(); },
    async importUpdate(pid, person, name) {
      Object.assign(st.people[pid], structuredClone(person)); Object.assign(st.names[pid] ||= {}, name); save();
    },
    async createPerson(person, name, account) {
      const pid = uid();
      let u = null;
      if (account?.email && !account.linkSelfUid) {
        if (Object.values(st.users).some((x) => x.email === account.email)) throw new Error('Já existe uma conta com este e-mail.');
        u = 'u-' + pid; st.users[u] = { role: account.role || 'comensal', personId: pid, email: account.email };
      }
      else if (account?.linkSelfUid) { u = account.linkSelfUid; st.users[u].personId = pid; }
      st.people[pid] = { ...structuredClone(person), uid: u, active: true, createdAt: Date.now() };
      st.names[pid] = { fullName: name.fullName || '', email: account?.email || '' };
      save(); return pid;
    },
    async updatePersonFull(pid, person, name, role, u) {
      Object.assign(st.people[pid], structuredClone(person));
      Object.assign(st.names[pid] ||= {}, name);
      if (u && role && st.users[u]) st.users[u].role = role;
      save();
    },
    async createAccountFor(pid, email, password, role) {
      const u = 'u-' + pid; st.users[u] = { role, personId: pid, email };
      st.people[pid].uid = u; (st.names[pid] ||= {}).email = email; save();
    },
    async createKitchen(email, pw, role = 'cozinha') {
      if (Object.values(st.users).some((x) => x.email === email)) throw Object.assign(new Error('e-mail em uso'), { code: 'auth/email-already-in-use' });
      st.users['u-' + uid()] = { role, personId: null, email }; save();
    },
    listAuxiliaries: async () => later(list(st.users).filter((u) => u.role === 'auxiliar')),
    async removeUserProfile(u) { delete st.users[u]; save(); },
    async setUserRole(u, role) { st.users[u].role = role; save(); },
    async deletePerson(pid, u) {
      for (const [k, o] of Object.entries(st.overrides)) if (o.personId === pid) delete st.overrides[k];
      for (const [k, o] of Object.entries(st.periods)) if (o.personId === pid) delete st.periods[k];
      delete st.people[pid]; delete st.names[pid]; if (u) delete st.users[u];
      save();
    },

    listOverridesRange: async (from, to) => later(list(st.overrides).filter((o) => o.date >= from && o.date <= to)),
    listOverridesByPerson: async (pid) => later(list(st.overrides).filter((o) => o.personId === pid)),
    async setOverride(o) { st.overrides[`${o.personId}_${o.date}_${o.meal}`] = { ...structuredClone(o), note: '' }; save(); },
    listNotes: async (from, to) => later(list(st.notes ||= {}).filter((n) => n.date >= from && n.date <= to)),
    listKitchenNotes: async (from, to) => later(list(st.kitchenNotes ||= {}).filter((n) => n.date >= from && n.date <= to)),
    listNotesByPerson: async (pid) => later(list(st.notes ||= {}).filter((n) => n.personId === pid)),
    async saveNote({ personId, date, meal, text }, share, prevKitchenId) {
      st.kitchenNotes ||= {};
      let kitchenId = null;
      if (share) { kitchenId = prevKitchenId || uid(); st.kitchenNotes[kitchenId] = { date, meal, text }; }
      else if (prevKitchenId) delete st.kitchenNotes[prevKitchenId];
      (st.notes ||= {})[`${personId}_${date}_${meal}`] = { personId, date, meal, text, approved: !!share, kitchenId };
      save();
    },
    async deleteNote(pid, date, meal, kitchenId) {
      delete (st.notes ||= {})[`${pid}_${date}_${meal}`];
      if (kitchenId) delete (st.kitchenNotes ||= {})[kitchenId];
      save();
    },
    async migrateNotes() {
      let n = 0;
      for (const [k, o] of Object.entries(st.overrides)) {
        if (!o.note) continue;
        (st.notes ||= {})[k] = { personId: o.personId, date: o.date, meal: o.meal, text: o.note, approved: false };
        o.note = ''; n++;
      }
      for (const o of Object.values(st.notes || {})) {
        if (!o.approved || o.kitchenId) continue;
        o.kitchenId = uid();
        (st.kitchenNotes ||= {})[o.kitchenId] = { date: o.date, meal: o.meal, text: o.text }; n++;
      }
      save(); return n;
    },
    async deleteOverride(pid, date, meal) { delete st.overrides[`${pid}_${date}_${meal}`]; save(); },

    listPeriodsFrom: async (from) => later(list(st.periods).filter((p) => p.to >= from)),
    listPeriodsByPerson: async (pid) => later(list(st.periods).filter((p) => p.personId === pid)),
    async addPeriod(p) { st.periods[uid()] = { ...structuredClone(p), createdAt: Date.now() }; save(); },
    async updatePeriod(id, data) { Object.assign(st.periods[id], structuredClone(data)); save(); },
    async deletePeriod(id) { delete st.periods[id]; save(); },

    listDayNotes: async (from, to) => later(list(st.dayNotes).filter((n) => n.date >= from && n.date <= to)),
    async addDayNote(n, by) { st.dayNotes[uid()] = { ...n, by, createdAt: Date.now() }; save(); },
    async deleteDayNote(id) { delete st.dayNotes[id]; save(); },

    listMessages: async () => later(list(st.messages).sort((a, b) => b.createdAt - a.createdAt)),
    async sendMessage(dir, text, from, fromEmail, extra = {}) { st.messages[uid()] = { dir, text, from, fromEmail, ...extra, createdAt: Date.now(), readAt: null }; save(); },
    async markRead(id) { st.messages[id].readAt = Date.now(); save(); },
    async deleteMessage(id) { delete st.messages[id]; save(); },

    listEvents: async (from, to) => later(list(st.events ||= {}).filter((x) => x.date >= from && x.date <= to)),
    async setEvent(e, by) { (st.events ||= {})[`${e.date}_${e.meal}`] = { ...e, by, updatedAt: Date.now() }; save(); },
    async deleteEvent(date, meal) { delete (st.events ||= {})[`${date}_${meal}`]; save(); },
    async addAlert(a, by) { (st.alerts ||= {})[uid()] = { ...structuredClone(a), by, createdAt: Date.now(), ackAt: null, ackBy: null }; save(); },
    listAlerts: async () => later(list(st.alerts ||= {}).sort((a, b) => b.createdAt - a.createdAt)),
    async ackAlert(id, by) { Object.assign(st.alerts[id], { ackAt: Date.now(), ackBy: by }); save(); },
    async deleteAlert(id) { delete st.alerts[id]; save(); },
    async addCall(c, by) { (st.calls ||= {})[uid()] = { ...c, by, createdAt: Date.now(), seenAt: null, seenBy: null }; save(); },
    listCalls: async () => {
      try { st = JSON.parse(localStorage.getItem(KEY)) || st; } catch { /* */ } // outra aba pode ter marcado "visto"
      return later(list(st.calls ||= {}).sort((a, b) => b.createdAt - a.createdAt));
    },
    async markCallSeen(id, by) { Object.assign(st.calls[id], { seenAt: Date.now(), seenBy: by }); save(); },
    // Demonstração: confere a cada 3 s (outras abas gravam no mesmo localStorage)
    watchOpenCalls(cb) {
      const tick = () => { try { st = JSON.parse(localStorage.getItem(KEY)) || st; } catch { /* */ } cb(list(st.calls ||= {}).filter((c) => !c.seenAt)); };
      tick(); const h = setInterval(tick, 3000); return () => clearInterval(h);
    },
    listDaily: async (from, to) => later(list(st.daily).filter((x) => x.date >= from && x.date <= to)),
    async saveDaily(date, meals) { st.daily[date] = { date, meals, at: Date.now() }; save(); },
  };
}
