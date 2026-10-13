// Interface do app de comensais.
import * as L from './logic.js';
import { firebaseConfig } from './firebase-config.js';

const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('COLE');
const DEMO = new URLSearchParams(location.search).has('demo') || !configured;
const api = DEMO
  ? (await import('./data-demo.js')).createDemoApi()
  : (await import('./data-firebase.js')).createFirebaseApi(firebaseConfig);

// ---------- Estado e utilitários ----------
const S = {
  user: null, profile: null, role: null, myPid: null,
  settings: L.mergeSettings(), people: [], names: {}, users: [],
  targetPid: null, dashDate: L.today(), daysAhead: 14, showNames: false,
  stats: { range: '30', meal: '' }, unread: 0,
};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const main = $('#main');
const dlg = $('#dlg');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isAdmin = () => S.role === 'admin';
const isKitchenRole = (r) => r === 'cozinha' || r === 'auxiliar';
const isKitchen = () => isKitchenRole(S.role);
const ROLE_NAME = { admin: 'administrador', comensal: 'comensal', cozinha: 'administradora da cozinha', auxiliar: 'auxiliar de cozinha' };
const fmtDateTime = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const personById = (id) => S.people.find((p) => p.id === id);
const fullName = (id) => S.names[id]?.fullName || '';
const loading = '<p class="muted center">Carregando…</p>';

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms);
}

const ERR = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'Senha incorreta.',
  'auth/user-not-found': 'E-mail não cadastrado.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/email-already-in-use': 'Já existe uma conta com este e-mail.',
  'auth/weak-password': 'Senha fraca: use pelo menos 6 caracteres.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
  'auth/missing-email': 'Informe o e-mail.',
  'permission-denied': 'Sem permissão para esta operação.',
};
const errMsg = (e) => ERR[e?.code] || e?.message || String(e);

async function guard(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { console.error(e); toast('Erro: ' + errMsg(e), 5000); } finally { if (btn) btn.disabled = false; }
}

function openDialog(html, bind) {
  $('#dlg-body').innerHTML = html;
  dlg.showModal();
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  bind?.($('#dlg-body'));
}

function chip(item, cls = '', extra = '') {
  const name = isAdmin() ? fullName(item.id) : '';
  const label = esc(item.initials) + (S.showNames && name ? ` <span class="t">${esc(name)}</span>` : '');
  return `<span class="chip ${cls} ${item.diet ? 'diet' : ''} ${item.guest ? 'guest' : ''}" title="${esc(name)}${item.diet ? ' (regime)' : ''}">${label}${extra ? ` <span class="t">${esc(extra)}</span>` : ''}</span>`;
}

// ---------- Sessão ----------
api.onAuth(async (u) => {
  S.user = u;
  if (!u) { $('#nav').hidden = true; $('#who').innerHTML = ''; return renderLogin(); }
  main.innerHTML = loading;
  try {
    if (await loadSession()) route();
  } catch (e) { console.error(e); main.innerHTML = `<div class="card">Erro ao carregar: ${esc(errMsg(e))}</div>`; }
});

async function loadSession() {
  S.profile = await api.getProfile(S.user.uid);
  if (!S.profile) {
    if (!(await api.bootstrapExists())) renderBootstrap(); else renderNoProfile();
    return false;
  }
  if (S.profile.mustChange && !DEMO) { renderMustChange(); return false; }
  S.role = S.profile.role;
  S.myPid = S.profile.personId || null;
  S.settings = L.mergeSettings(await api.getSettings());
  await loadPeople();
  if (!S.targetPid || !personById(S.targetPid)) S.targetPid = S.myPid || S.people[0]?.id || null;
  renderNav();
  refreshUnread();
  return true;
}

// Mensagens não lidas destinadas a mim (admin ← cozinha, cozinha ← admin)
const inboxDir = () => (isAdmin() ? 'k2a' : S.role === 'cozinha' ? 'a2k' : null);
async function refreshUnread() {
  if (!inboxDir()) return;
  try {
    const msgs = await api.listMessages();
    S.unread = msgs.filter((m) => m.dir === inboxDir() && !m.readAt).length;
    renderNav();
  } catch (e) { console.warn(e); }
}

async function loadPeople() {
  if (S.role === 'admin') {
    [S.people, S.names] = await Promise.all([api.listPeople(), api.listNames()]);
  } else if (isKitchen()) {
    S.people = await api.listPeople(); S.names = {};
  } else {
    const [p, n] = S.myPid ? await Promise.all([api.getPerson(S.myPid), api.getName(S.myPid)]) : [null, null];
    S.people = p ? [p] : []; S.names = n ? { [S.myPid]: n } : {};
  }
  S.people.sort((a, b) => (a.initials || '').localeCompare(b.initials || ''));
}

const NAV = {
  admin: [['painel', 'Painel'], ['semana', 'Semana'], ['estatisticas', 'Estatísticas'], ['mensagens', 'Mensagens'],
    ['minhas', 'Refeições'], ['padrao', 'Regra padrão'], ['temporarias', 'Temporárias'], ['pessoas', 'Pessoas'],
    ['config', 'Configurações'], ['conta', 'Conta']],
  cozinha: [['painel', 'Painel'], ['semana', 'Semana'], ['estatisticas', 'Estatísticas'], ['mensagens', 'Mensagens'],
    ['equipe', 'Equipe'], ['conta', 'Conta']],
  auxiliar: [['painel', 'Painel'], ['semana', 'Semana'], ['estatisticas', 'Estatísticas'], ['mensagens', 'Mensagens'], ['conta', 'Conta']],
  comensal: [['minhas', 'Minhas refeições'], ['padrao', 'Regra padrão'], ['temporarias', 'Temporárias'], ['conta', 'Conta']],
};
const navFor = () => NAV[S.role] || NAV.comensal;

function renderNav() {
  const me = personById(S.myPid);
  $('#who').innerHTML = `${me ? esc(me.initials) + ' · ' : ''}${ROLE_NAME[S.role] || ''}${DEMO ? ' · <b>DEMO</b>' : ''}`;
  const nav = $('#nav');
  const cur = S.view;
  nav.innerHTML = navFor().map(([k, t]) => `<a href="#/${k}" data-k="${k}" class="${k === cur ? 'on' : ''}">${t}${
    k === 'mensagens' && S.unread ? ` <span class="count">${S.unread}</span>` : ''}</a>`).join('');
  nav.hidden = false;
}

window.addEventListener('hashchange', () => { if (S.role) route(); });

async function route() {
  const allowed = navFor().map(([k]) => k);
  let v = location.hash.replace(/^#\/?/, '');
  if (!allowed.includes(v)) v = allowed[0];
  S.view = v;
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === v));
  main.innerHTML = loading;
  try { await VIEWS[v](); } catch (e) { console.error(e); main.innerHTML = `<div class="card">Erro: ${esc(errMsg(e))}</div>`; }
}

// ---------- Login / primeiro acesso ----------
function renderLogin() {
  if (DEMO) {
    main.innerHTML = `<div class="card login stack">
      <h2>Modo demonstração</h2>
      <p class="muted small">${configured ? '' : 'O Firebase ainda não foi configurado (js/firebase-config.js). '}
      Os dados ficam apenas neste navegador. Entre como:</p>
      <button class="primary" data-who="u-admin">Administrador (LK)</button>
      <button data-who="u-gn">Comensal (GN)</button>
      <button data-who="u-cozinha">Administradora da cozinha</button>
      <button data-who="u-aux">Auxiliar de cozinha</button>
    </div>`;
    $$('[data-who]').forEach((b) => b.addEventListener('click', () => api.signIn(b.dataset.who)));
    return;
  }
  main.innerHTML = `<form class="card login stack" id="f-login">
    <h2>Entrar</h2>
    <label>E-mail <input type="email" name="email" autocomplete="username" required></label>
    <label>Senha <input type="password" name="pw" autocomplete="current-password" required></label>
    <button class="primary" type="submit">Entrar</button>
    <button class="link" type="button" id="forgot">Esqueci minha senha</button>
  </form>`;
  const f = $('#f-login');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(() => api.signIn(f.email.value.trim(), f.pw.value), f.querySelector('[type=submit]'));
  });
  $('#forgot').addEventListener('click', () => guard(async () => {
    await api.resetPassword(f.email.value.trim());
    toast('Enviamos um e-mail para redefinir a senha.');
  }));
}

function renderBootstrap() {
  main.innerHTML = `<div class="card login stack">
    <h2>Primeiro acesso</h2>
    <p>Ainda não há administrador. Tornar <b>${esc(S.user.email)}</b> o administrador do sistema?</p>
    <button class="primary" id="b-boot">Sim, sou o administrador</button>
    <button id="b-out">Sair</button></div>`;
  $('#b-boot').addEventListener('click', (e) => guard(async () => {
    await api.bootstrapAdmin(S.user.uid, S.user.email);
    if (await loadSession()) { location.hash = '#/pessoas'; route(); toast('Pronto! Cadastre-se como comensal em Pessoas.'); }
  }, e.target));
  $('#b-out').addEventListener('click', () => api.signOut());
}

function renderMustChange() {
  main.innerHTML = `<form class="card login stack" id="f-first">
    <h2>Crie sua senha</h2>
    <p class="muted small">Primeiro acesso de <b>${esc(S.user.email)}</b>: troque a senha provisória por uma só sua.</p>
    <label>Nova senha <input type="password" name="pw1" minlength="6" autocomplete="new-password" required></label>
    <label>Repita a nova senha <input type="password" name="pw2" minlength="6" autocomplete="new-password" required></label>
    <button class="primary" type="submit">Salvar senha</button>
    <button type="button" id="b-out">Sair</button></form>`;
  const f = $('#f-first');
  $('#b-out').addEventListener('click', () => api.signOut());
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (f.pw1.value !== f.pw2.value) return toast('As senhas não conferem.');
    guard(async () => {
      await api.setNewPassword(f.pw1.value);
      await api.clearMustChange(S.user.uid);
      toast('Senha criada.');
      if (await loadSession()) route();
    }, f.querySelector('[type=submit]'));
  });
}

function renderNoProfile() {
  main.innerHTML = `<div class="card login stack">
    <p>A conta <b>${esc(S.user.email)}</b> ainda não foi liberada pelo administrador.</p>
    <button id="b-out">Sair</button></div>`;
  $('#b-out').addEventListener('click', () => api.signOut());
}

// ---------- Painel (admin e cozinha) ----------
function mealCard(meal, s) {
  const chips = (arr, cls, timeFn) => `<div class="chips">${arr.map((i) => chip(i, cls, timeFn?.(i))).join('')}</div>`;
  const parts = [];
  parts.push(`<div class="meal-head"><h3>${L.MEAL_LABEL[meal]}</h3><span class="total">${s.total}</span></div>`);
  const resumo = [`${s.diet} de regime`];
  if (s.extras) resumo.push(`${s.extras} extra${s.extras > 1 ? 's' : ''}`);
  if (s.early.length) resumo.push(`${s.early.length} +cedo`);
  if (s.late.length) resumo.push(`${s.late.length} +tarde`);
  if (s.takeaway.length) resumo.push(`${s.takeaway.length} p/ levar`);
  parts.push(`<div class="muted small">${resumo.join(' · ')}</div>`);
  if (s.dietAbsent.length) {
    parts.push(`<div class="sub">Regimes que NÃO fazem</div>${chips(s.dietAbsent, 'absent')}`);
  }
  if (s.normal.length) parts.push(`<div class="sub">Horário normal (${s.normal.length})</div>${chips(s.normal)}`);
  if (s.early.length) parts.push(`<div class="sub">Mais cedo</div>${chips(s.early, 'early', (i) => i.timeShown || '+cedo')}`);
  if (s.late.length) parts.push(`<div class="sub">Mais tarde</div>${chips(s.late, 'late', (i) => i.timeShown || '+tarde')}`);
  if (s.takeaway.length) parts.push(`<div class="sub">Para levar</div>${chips(s.takeaway, 'take', (i) => i.timeShown)}`);
  if (s.notes.length) {
    parts.push(`<div class="sub">Observações</div><ul class="notes">${s.notes.map((i) =>
      `<li><strong>${esc(i.initials)}</strong>${i.diet ? ' <span class="badge">R</span>' : ''}${i.on ? '' : ' <span class="muted">(não vem)</span>'}: ${esc(i.note)}</li>`).join('')}</ul>`);
  }
  if (s.dayNotes?.length) {
    parts.push(`<div class="sub">Recados do administrador</div><ul class="notes">${s.dayNotes.map(dayNoteItem).join('')}</ul>`);
  }
  if (!s.total && !s.dietAbsent.length && !s.notes.length) parts.push('<p class="muted">Ninguém.</p>');
  return `<section class="card">${parts.join('')}</section>`;
}

function dayNoteItem(n) {
  return `<li class="daynote">${esc(n.text)}${Number(n.extra) > 0 ? ` <span class="badge plus">+${Number(n.extra)}</span>` : ''}${
    isAdmin() ? ` <button class="link small" data-delnote="${n.id}" title="Apagar recado">apagar</button>` : ''}</li>`;
}

// Totais de um dia (com recados) — também grava a "fotografia" do dia para as estatísticas.
async function daySummary(date) {
  const [ovs, pers, notes] = await Promise.all([api.listOverridesRange(date, date), api.listPeriodsFrom(date), api.listDayNotes(date, date)]);
  const sum = L.applyDayNotes(L.summarize(S.people, date, pers, ovs, S.settings), notes);
  saveSnapshot(date, sum);
  return { sum, notes };
}
async function saveSnapshot(date, sum) {
  const t = L.today();
  if (date > t || !(isAdmin() || isKitchen())) return;
  try {
    // Hoje: sempre atualiza. Dias passados: só grava se ainda não houver registro.
    if (date < t && (await api.listDaily(date, date)).length) return;
    await api.saveDaily(date, L.snapshotOf(sum));
  } catch (e) { console.warn('snapshot', e); }
}

function addDayNoteDialog(date) {
  openDialog(`<form id="f-note" class="stack">
      <h3>Recado para a cozinha — ${L.fmtDate(date, true)}</h3>
      <label>Recado <textarea name="text" rows="2" maxlength="300" required placeholder="ex.: O marceneiro Vanderley almoça hoje"></textarea></label>
      <label>Refeição <select name="meal"><option value="">Geral (o dia todo)</option>
        ${L.MEALS.map((m) => `<option value="${m}">${L.MEAL_LABEL[m]}</option>`).join('')}</select></label>
      <label>Pessoas a mais nesta refeição <input type="number" name="extra" min="0" max="50" value="0"></label>
      <p class="muted small">As pessoas a mais entram no total da refeição escolhida.</p>
      <div class="row spread"><span></span><span class="row"><button type="button" data-close>Cancelar</button>
        <button class="primary" type="submit">Enviar</button></span></div></form>`, (root) => {
    const f = $('#f-note', root);
    f.meal.addEventListener('change', () => { f.extra.disabled = !f.meal.value; if (!f.meal.value) f.extra.value = 0; });
    f.extra.disabled = true;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(async () => {
        await api.addDayNote({ date, meal: f.meal.value, text: f.text.value.trim(), extra: f.meal.value ? Number(f.extra.value) || 0 : 0 }, S.user.uid);
        dlg.close(); toast('Recado enviado.'); route();
      }, f.querySelector('[type=submit]'));
    });
  });
}
function bindDayNoteDeletes() {
  $$('[data-delnote]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Apagar este recado?')) return;
    guard(async () => { await api.deleteDayNote(b.dataset.delnote); route(); }, b);
  }));
}

async function viewPainel() {
  const date = S.dashDate;
  const { sum, notes } = await daySummary(date);
  const general = notes.filter((n) => !n.meal);
  main.innerHTML = `
    <div class="card row spread">
      <button data-go="-1" aria-label="Dia anterior">‹</button>
      <div class="center"><strong>${L.fmtDate(date, true)}</strong>${date === L.today() ? ' <span class="muted">· hoje</span>' : ''}<br>
        <input type="date" id="dash-date" value="${date}"></div>
      <button data-go="1" aria-label="Próximo dia">›</button>
    </div>
    <div class="row" style="margin-bottom:12px">
      ${date !== L.today() ? '<button data-go="0">Hoje</button>' : ''}
      <button id="b-reload">Atualizar</button>
      ${isAdmin() ? '<button id="b-note">+ Recado para a cozinha</button>' : ''}
      ${isAdmin() ? `<label class="check"><input type="checkbox" id="ck-names" ${S.showNames ? 'checked' : ''}> mostrar nomes</label>` : ''}
    </div>
    ${general.length ? `<div class="card recado"><div class="sub" style="margin-top:0">Recados do administrador</div>
      <ul class="notes">${general.map(dayNoteItem).join('')}</ul></div>` : ''}
    <div class="grid3">${L.MEALS.map((m) => mealCard(m, sum[m])).join('')}</div>
    <p class="muted small" style="margin-top:12px"><span class="chip diet">XX</span> = regime ·
      <span class="chip absent">XX</span> = regime que não faz a refeição</p>`;
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.go);
    S.dashDate = n === 0 ? L.today() : L.addDays(date, n); route();
  }));
  $('#dash-date').addEventListener('change', (e) => { if (e.target.value) { S.dashDate = e.target.value; route(); } });
  $('#b-reload').addEventListener('click', () => route());
  $('#b-note')?.addEventListener('click', () => addDayNoteDialog(date));
  bindDayNoteDeletes();
  $('#ck-names')?.addEventListener('change', (e) => { S.showNames = e.target.checked; route(); });
}

// ---------- Semana ----------
async function viewSemana() {
  const from = S.dashDate, to = L.addDays(from, 6);
  const [ovs, pers, notes] = await Promise.all([api.listOverridesRange(from, to), api.listPeriodsFrom(from), api.listDayNotes(from, to)]);
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const d = L.addDays(from, i);
    const dn = notes.filter((n) => n.date === d);
    const sum = L.applyDayNotes(L.summarize(S.people, d, pers, ovs, S.settings), dn);
    const cells = L.MEALS.map((m) => {
      const s = sum[m];
      const extra = [];
      if (s.early.length) extra.push(`${s.early.length} +cedo`);
      if (s.late.length) extra.push(`${s.late.length} +tarde`);
      if (s.takeaway.length) extra.push(`${s.takeaway.length} levar`);
      if (s.notes.length) extra.push(`${s.notes.length} obs.`);
      if (s.extras) extra.push(`${s.extras} extra${s.extras > 1 ? 's' : ''}`);
      const abs = s.dietAbsent.length ? `<div class="small" style="color:var(--warn)">regime fora: ${s.dietAbsent.map((x) => esc(x.initials)).join(' ')}</div>` : '';
      return `<td><span class="num">${s.total}</span> <span class="muted small">(${s.diet} reg.)</span>
        ${extra.length ? `<div class="small" style="color:var(--info)">${extra.join(' · ')}</div>` : ''}${abs}</td>`;
    }).join('');
    const gen = dn.filter((n) => !n.meal).length;
    rows.push(`<tr class="clickable" data-d="${d}"><th>${L.fmtDate(d)}${gen ? ' <span class="badge plus" title="Recado do administrador">recado</span>' : ''}</th>${cells}</tr>`);
  }
  main.innerHTML = `
    <div class="card row spread">
      <button data-go="-7">‹ semana</button>
      <strong>${L.fmtDate(from)} a ${L.fmtDate(to)}</strong>
      <button data-go="7">semana ›</button>
    </div>
    <div class="card tablewrap"><table>
      <thead><tr><th>Dia</th>${L.MEALS.map((m) => `<th>${L.MEAL_SHORT[m]}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody></table>
      <p class="muted small">Toque num dia para ver os detalhes.</p></div>`;
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => { S.dashDate = L.addDays(from, Number(b.dataset.go)); route(); }));
  $$('tr[data-d]').forEach((tr) => tr.addEventListener('click', () => { S.dashDate = tr.dataset.d; location.hash = '#/painel'; }));
}

// ---------- Seletor de pessoa (admin gerencia qualquer comensal/convidado) ----------
function targetSelector() {
  if (!isAdmin()) return '';
  const opts = S.people.filter((p) => p.active !== false || p.id === S.targetPid).map((p) =>
    `<option value="${p.id}" ${p.id === S.targetPid ? 'selected' : ''}>${esc(p.initials)} — ${esc(fullName(p.id))}${p.guest ? ' (convidado)' : ''}</option>`).join('');
  return `<div class="card row"><label style="flex:1">Comensal <select id="sel-target">${opts}</select></label></div>`;
}
function bindTargetSelector() {
  $('#sel-target')?.addEventListener('change', (e) => { S.targetPid = e.target.value; route(); });
}
function noPerson() {
  main.innerHTML = targetSelector() + `<div class="card">${isAdmin()
    ? 'Nenhum comensal cadastrado ainda. Vá em <a href="#/pessoas">Pessoas</a>.'
    : 'Sua conta não está vinculada a um comensal. Fale com o administrador.'}</div>`;
  bindTargetSelector();
}

// ---------- Minhas refeições ----------
async function viewMinhas() {
  const person = personById(S.targetPid);
  if (!person) return noPerson();
  const [ovs, pers] = await Promise.all([api.listOverridesByPerson(person.id), api.listPeriodsByPerson(person.id)]);
  const ovMap = L.overrideMap(ovs);
  const t = L.today();
  const days = [];
  for (let i = 0; i < S.daysAhead; i++) {
    const d = L.addDays(t, i);
    const meals = L.MEALS.map((m) => {
      const r = L.resolve(person, d, m, pers, ovMap, S.settings);
      const extra = [r.on && r.when !== 'N' ? `${L.WHEN_LABEL[r.when]}${r.timeShown ? ' ' + r.timeShown : ''}` : '', r.note].filter(Boolean).join(' · ');
      const src = r.source === 'pontual' ? 'alterado' : r.source === 'temporária' ? `temporária${r.periodLabel ? ': ' + r.periodLabel : ''}` : 'padrão';
      return `<button class="mealbtn ${r.on ? 'on' : 'off'}" data-d="${d}" data-m="${m}">
        <span><span class="st">${r.on ? '✓' : '✗'} ${L.MEAL_SHORT[m]}</span>
          ${extra ? `<br><span class="extra">${esc(extra)}</span>` : ''}</span>
        <span class="src">${esc(src)}</span></button>`;
    }).join('');
    days.push(`<div class="card day ${d === t ? 'today' : ''}"><h3>${L.fmtDate(d, true)}</h3>${meals}</div>`);
  }
  main.innerHTML = `${targetSelector()}
    <p class="muted small">${isAdmin() ? esc(person.initials) + ': t' : 'T'}oque numa refeição para desmarcar, marcar,
      mudar o horário ou deixar uma observação.</p>
    ${days.join('')}
    <div class="center"><button id="b-more">Ver mais dias</button></div>`;
  bindTargetSelector();
  $('#b-more').addEventListener('click', () => { S.daysAhead += 14; route(); });
  $$('.mealbtn').forEach((b) => b.addEventListener('click', () => editMeal(person, b.dataset.d, b.dataset.m, pers, ovMap)));
}

function editMeal(person, date, meal, pers, ovMap) {
  const cur = L.resolve(person, date, meal, pers, ovMap, S.settings);
  const base = L.resolve(person, date, meal, pers, null, S.settings);
  const hint = { C: S.settings.early[meal], T: S.settings.late[meal] };
  const radio = (name, val, label, checked) =>
    `<label><input type="radio" name="${name}" value="${val}" ${checked ? 'checked' : ''}> ${label}</label>`;
  openDialog(`<form id="f-meal" class="stack">
      <h3>${L.MEAL_LABEL[meal]} — ${L.fmtDate(date, true)}</h3>
      <p class="muted small">Padrão: ${base.on ? 'faz' + (base.when !== 'N' ? ` (${L.WHEN_LABEL[base.when]} ${base.timeShown})` : '') : 'não faz'}${base.source === 'temporária' ? ' (regra temporária)' : ''}.</p>
      <div class="seg">${radio('on', '1', 'Vou', cur.on)}${radio('on', '0', 'Não vou', !cur.on)}</div>
      <fieldset id="whenbox"><legend>Horário</legend>
        <div class="seg">${['N', 'C', 'T', 'L'].map((w) => radio('when', w, { N: 'Normal', C: 'Mais cedo', T: 'Mais tarde', L: 'Para levar' }[w], cur.when === w)).join('')}</div>
        <label id="timebox" style="margin-top:8px">Horário <span id="timehint"></span>
          <input type="time" name="time" value="${esc(cur.time)}"></label>
      </fieldset>
      <label>Observação <input name="note" maxlength="140" value="${esc(cur.note)}" placeholder="ex.: jantar +leve"></label>
      <div class="row small">${['+leve', 'lanche para levar', 'guardar um prato'].map((n) => `<button type="button" class="link" data-note="${n}">${n}</button>`).join('')}</div>
      <div class="row spread">
        ${cur.source === 'pontual' ? '<button type="button" id="b-reset">Voltar ao padrão</button>' : '<span></span>'}
        <span class="row"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">Salvar</button></span>
      </div></form>`, (root) => {
    const f = $('#f-meal', root);
    const sync = () => {
      const on = f.on.value === '1', w = f.when.value;
      $('#whenbox', root).hidden = !on;
      $('#timebox', root).hidden = w === 'N';
      $('#timehint', root).textContent = w === 'L' ? '(retirada, opcional)'
        : hint[w] ? `(vazio = ${hint[w]})` : '(opcional)';
    };
    f.addEventListener('change', sync); sync();
    $$('[data-note]', root).forEach((b) => b.addEventListener('click', () => {
      f.note.value = f.note.value ? `${f.note.value}; ${b.dataset.note}` : b.dataset.note;
      if (b.dataset.note === 'lanche para levar') { f.on.value = '1'; f.when.value = 'L'; sync(); }
    }));
    $('#b-reset', root)?.addEventListener('click', (e) => guard(async () => {
      await api.deleteOverride(person.id, date, meal); dlg.close(); toast('Voltou ao padrão.'); route();
    }, e.target));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const on = f.on.value === '1';
      const when = on ? f.when.value || 'N' : 'N';
      const time = on && when !== 'N' ? f.time.value : '';
      const note = f.note.value.trim();
      const same = on === base.on && (!on || (when === base.when && time === base.time)) && !note;
      guard(async () => {
        if (same) await api.deleteOverride(person.id, date, meal);
        else await api.setOverride({ personId: person.id, date, meal, status: on ? 'on' : 'off', when, time, note }, S.user.uid);
        dlg.close(); toast('Salvo.'); route();
      }, f.querySelector('[type=submit]'));
    });
  });
}

// ---------- Editor de grade semanal ----------
const GRID_ORDER = [1, 2, 3, 4, 5, 6, 0];
function gridEditor(grid) {
  const opt = (v, t, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`;
  return `<div class="tablewrap"><table class="gridedit">
    <thead><tr><th></th>${L.MEALS.map((m) => `<th>${L.MEAL_SHORT[m]}</th>`).join('')}</tr></thead><tbody>
    ${GRID_ORDER.map((d) => `<tr><th>${L.DOW[d]}</th>${L.MEALS.map((m) => {
      const c = L.parseCell(grid?.[d]?.[m]);
      const v = c.on ? c.when : '';
      return `<td><div class="cell"><select data-d="${d}" data-m="${m}">
        ${opt('', '—', v)}${opt('N', '✓', v)}${opt('C', '+cedo', v)}${opt('T', '+tarde', v)}${opt('L', 'p/ levar', v)}</select>
        <input type="time" data-d="${d}" data-m="${m}" value="${esc(c.time)}" ${v && v !== 'N' ? '' : 'hidden'} title="Horário (opcional)"></div></td>`;
    }).join('')}</tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">✓ = faz no horário normal. Horário vazio em +cedo/+tarde usa o padrão
      (almoço +tarde ${esc(S.settings.late.almoco)}, jantar +tarde ${esc(S.settings.late.jantar)}).</p>`;
}
function bindGrid(root) {
  $$('select[data-d]', root).forEach((s) => s.addEventListener('change', () => {
    const inp = $(`input[data-d="${s.dataset.d}"][data-m="${s.dataset.m}"]`, root);
    inp.hidden = !s.value || s.value === 'N';
  }));
}
function readGrid(root) {
  const g = L.emptyGrid();
  $$('select[data-d]', root).forEach((s) => {
    const inp = $(`input[data-d="${s.dataset.d}"][data-m="${s.dataset.m}"]`, root);
    g[s.dataset.d][s.dataset.m] = L.cellCode({ on: !!s.value, when: s.value, time: inp.value });
  });
  return g;
}
const presetOptions = (sel = '') => Object.entries(L.PRESETS)
  .map(([k, p]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${p.label}</option>`).join('');

// ---------- Regra padrão ----------
async function viewPadrao() {
  const person = personById(S.targetPid);
  if (!person) return noPerson();
  main.innerHTML = `${targetSelector()}
    <div class="card stack" id="grid-card">
      <h2>Regra padrão${isAdmin() ? ' — ' + esc(person.initials) : ''}</h2>
      <p class="muted small">Refeições que ${isAdmin() ? 'esta pessoa faz' : 'você faz'} normalmente, a cada semana.</p>
      <div class="row"><select id="sel-preset"><option value="">Modelos…</option>${presetOptions()}</select>
        <button id="b-preset">Aplicar modelo</button></div>
      <div id="grid-box">${gridEditor(person.defaultRule)}</div>
      <div class="row"><button class="primary" id="b-save">Salvar regra padrão</button></div>
    </div>`;
  bindTargetSelector();
  const box = $('#grid-box');
  bindGrid(box);
  $('#b-preset').addEventListener('click', () => {
    const k = $('#sel-preset').value;
    if (k) { box.innerHTML = gridEditor(L.PRESETS[k].grid()); bindGrid(box); }
  });
  $('#b-save').addEventListener('click', (e) => guard(async () => {
    const g = readGrid(box);
    await api.updatePerson(person.id, { defaultRule: g });
    person.defaultRule = g;
    toast('Regra padrão salva.');
  }, e.target));
}

// ---------- Regras temporárias ----------
async function viewTemporarias() {
  const person = personById(S.targetPid);
  if (!person) return noPerson();
  const pers = (await api.listPeriodsByPerson(person.id)).sort((a, b) => b.from.localeCompare(a.from));
  const t = L.today();
  const isAbsent = (g) => L.MEALS.every((m) => [0, 1, 2, 3, 4, 5, 6].every((d) => !g?.[d]?.[m]));
  const items = pers.map((p) => `<div class="list-item ${p.to < t ? 'inactive' : ''}">
      <div><strong>${esc(p.label || (isAbsent(p.grid) ? 'Ausência' : 'Regra temporária'))}</strong><br>
        <span class="small muted">${L.fmtDate(p.from)} a ${L.fmtDate(p.to)} · ${isAbsent(p.grid) ? 'não faz refeições' : 'regra personalizada'}${p.to < t ? ' · encerrada' : ''}</span></div>
      <button class="danger" data-del="${p.id}">Excluir</button></div>`).join('');
  main.innerHTML = `${targetSelector()}
    <div class="card"><h2>Regras temporárias${isAdmin() ? ' — ' + esc(person.initials) : ''}</h2>
      ${items || '<p class="muted">Nenhuma.</p>'}</div>
    <form class="card stack" id="f-per">
      <h2>Nova regra temporária</h2>
      <label>Motivo <input name="label" placeholder="ex.: viagem" maxlength="60"></label>
      <div class="row"><label>De <input type="date" name="from" value="${t}" required></label>
        <label>Até (inclusive) <input type="date" name="to" value="${t}" required></label></div>
      <div class="seg"><label><input type="radio" name="kind" value="aus" checked> Ausente (nenhuma refeição)</label>
        <label><input type="radio" name="kind" value="custom"> Regra personalizada</label></div>
      <div id="per-grid" hidden>${gridEditor(person.defaultRule)}</div>
      <p class="muted small">No período, esta regra substitui a regra padrão. Desmarcações pontuais continuam valendo por cima.</p>
      <div class="row"><button class="primary" type="submit">Criar</button></div>
    </form>`;
  bindTargetSelector();
  const f = $('#f-per'), gbox = $('#per-grid');
  bindGrid(gbox);
  f.addEventListener('change', () => { gbox.hidden = f.kind.value !== 'custom'; });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (f.to.value < f.from.value) return toast('A data final é anterior à inicial.');
    guard(async () => {
      await api.addPeriod({
        personId: person.id, from: f.from.value, to: f.to.value, label: f.label.value.trim(),
        grid: f.kind.value === 'custom' ? readGrid(gbox) : L.emptyGrid(),
      });
      toast('Regra temporária criada.'); route();
    }, f.querySelector('[type=submit]'));
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Excluir esta regra temporária?')) return;
    guard(async () => { await api.deletePeriod(b.dataset.del); route(); }, b);
  }));
}

// ---------- Pessoas (admin) ----------
async function viewPessoas() {
  await loadPeople();
  S.users = await api.listUsers();
  const userOf = (uid) => S.users.find((u) => u.id === uid);
  const rows = S.people.map((p) => {
    const u = p.uid && userOf(p.uid);
    const acc = u ? `${esc(u.email || S.names[p.id]?.email || '')} · ${u.role}` : (p.guest ? 'convidado' : 'sem conta');
    return `<div class="list-item ${p.active === false ? 'inactive' : ''}">
      <div><strong>${esc(p.initials)}</strong> ${p.diet ? '<span class="badge">regime</span>' : ''} ${esc(fullName(p.id))}
        <br><span class="small muted">${acc}${p.active === false ? ' · inativo' : ''}${p.uid === S.user.uid ? ' · você' : ''}</span></div>
      <button data-edit="${p.id}">Editar</button></div>`;
  }).join('');
  const kitchens = S.users.filter((u) => isKitchenRole(u.role)).map((u) => `<div class="list-item">
      <span>${esc(u.email)}<br><span class="small muted">${ROLE_NAME[u.role]}</span></span>
      <button class="danger" data-rmk="${u.id}">Remover acesso</button></div>`).join('');
  main.innerHTML = `
    <div class="card"><div class="row spread"><h2>Comensais</h2>
      <span class="row"><button id="b-import">Importar planilha</button><button class="primary" id="b-add">+ Adicionar</button></span></div>
      ${!S.myPid ? '<p class="alert small">Você ainda não está cadastrado como comensal. Use “+ Adicionar” e escolha “É a minha conta”.</p>' : ''}
      ${rows || '<p class="muted">Ninguém cadastrado.</p>'}</div>
    <div class="card"><h2>Cozinha</h2>
      <p class="muted small">A administradora da cozinha vê totais, horários, regimes e observações, apenas com as iniciais;
        pode criar contas de auxiliares (mesma visão) e mandar mensagens para você.</p>
      ${kitchens || '<p class="muted">Nenhuma conta.</p>'}
      <form id="f-k" class="stack" style="margin-top:10px"><h3>Criar conta da administradora da cozinha</h3>
        ${accountFields()}
        <button type="submit">Criar conta</button></form></div>`;
  $('#b-add').addEventListener('click', () => personForm(null));
  $('#b-import').addEventListener('click', () => importDialog());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => personForm(personById(b.dataset.edit))));
  const fk = $('#f-k');
  fk.addEventListener('submit', (e) => {
    e.preventDefault();
    if (fk.pw.value && fk.pw.value.length < 6) return toast('A senha precisa ter pelo menos 6 caracteres.');
    guard(async () => { await api.createKitchen(fk.email.value.trim(), fk.pw.value || undefined, 'cozinha'); toast('Conta da cozinha criada.'); route(); }, fk.querySelector('button'));
  });
  $$('[data-rmk]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remover o acesso desta conta? (O login continua existindo no Firebase, mas não verá mais nada.)')) return;
    guard(async () => { await api.removeUserProfile(b.dataset.rmk); route(); }, b);
  }));
}

function personForm(p) {
  const isNew = !p;
  const u = p?.uid && S.users.find((x) => x.id === p.uid);
  const isMe = p?.uid === S.user.uid;
  const accountNew = `
    <div class="seg">
      <label><input type="radio" name="acc" value="none" checked> Sem conta</label>
      <label><input type="radio" name="acc" value="new"> Criar login</label>
      ${isNew && !S.myPid ? '<label><input type="radio" name="acc" value="self"> É a minha conta</label>' : ''}
    </div>
    <div id="accbox" class="stack" hidden>
      <label>E-mail <input type="email" name="email"></label>
      <label>Senha provisória (opcional) <input type="text" name="pw" minlength="6" autocomplete="off"></label>
      <label>Papel <select name="role"><option value="comensal">Comensal</option><option value="admin">Administrador</option></select></label>
      <p class="muted small">Com senha provisória, passe-a à pessoa: ela troca no primeiro acesso. Sem senha, ela recebe
        um e-mail para criar a própria senha (pode cair no spam).</p>
    </div>`;
  const accountEdit = u ? `
    <p class="small">Login: <b>${esc(u.email)}</b></p>
    ${isMe ? '' : `<label>Papel <select name="role"><option value="comensal" ${u.role === 'comensal' ? 'selected' : ''}>Comensal</option>
      <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label>`}
    <button type="button" id="b-resetpw">Enviar e-mail para redefinir senha</button>` : accountNew;
  openDialog(`<form id="f-p" class="stack">
      <h3>${isNew ? 'Adicionar comensal' : 'Editar ' + esc(p.initials)}</h3>
      <div class="row"><label style="width:90px">Iniciais <input name="initials" maxlength="4" required value="${esc(p?.initials)}" style="text-transform:uppercase"></label>
        <label style="flex:1">Nome e sobrenome <input name="fullName" value="${esc(p ? fullName(p.id) : '')}"></label></div>
      <label class="check"><input type="checkbox" name="diet" ${p?.diet ? 'checked' : ''}> Faz regime</label>
      <label class="check"><input type="checkbox" name="guest" ${p?.guest ? 'checked' : ''}> Convidado</label>
      ${isNew ? `<label>Regra padrão inicial <select name="preset">${presetOptions('todas')}</select></label>
        <p class="muted small">Para convidado, use “Nenhuma refeição” e marque os dias em Refeições ou Temporárias.</p>`
        : `<label class="check"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Ativo (desmarque para tirar dos totais)</label>`}
      <fieldset><legend>Acesso ao app</legend>${isNew ? accountNew : accountEdit}</fieldset>
      <div class="row spread">${!isNew && !isMe ? '<button type="button" class="danger" id="b-delp">Excluir</button>' : '<span></span>'}
        <span class="row"><button type="button" data-close>Cancelar</button>
        <button class="primary" type="submit">Salvar</button></span></div></form>`, (root) => {
    const f = $('#f-p', root);
    $('#b-delp', root)?.addEventListener('click', (e) => {
      if (!confirm(`Excluir ${p.initials} definitivamente? Somem também as regras e alterações dessa pessoa`
        + (p.uid ? ' e o acesso ao app.' : '.') + '\n\nPara só tirar dos totais, desmarque “Ativo”.')) return;
      guard(async () => {
        await api.deletePerson(p.id, p.uid);
        if (S.targetPid === p.id) S.targetPid = S.myPid;
        dlg.close(); toast(`${p.initials} excluído.`); route();
      }, e.target);
    });
    const sync = () => { const b = $('#accbox', root); if (b) b.hidden = f.acc?.value !== 'new'; };
    f.addEventListener('change', (e) => {
      sync();
      if (isNew && e.target.name === 'guest' && f.guest.checked) f.preset.value = 'nenhuma';
    });
    sync();
    $('#b-resetpw', root)?.addEventListener('click', (e) => guard(async () => {
      await api.resetPassword(u.email); toast('E-mail de redefinição enviado.');
    }, e.target));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const initials = f.initials.value.trim().toUpperCase();
      if (S.people.some((x) => x.initials === initials && x.id !== p?.id && x.active !== false)) {
        if (!confirm(`Já existe um comensal ativo com as iniciais ${initials}. Continuar?`)) return;
      }
      const acc = f.acc?.value;
      if (acc === 'new' && (!f.email.value.trim() || (f.pw.value && f.pw.value.length < 6))) return toast('Informe o e-mail; a senha, se houver, precisa de 6 caracteres.');
      guard(async () => {
        const person = { initials, diet: f.diet.checked, guest: f.guest.checked };
        const name = { fullName: f.fullName.value.trim() };
        if (isNew) {
          person.defaultRule = L.PRESETS[f.preset.value].grid();
          const account = acc === 'new' ? { email: f.email.value.trim(), password: f.pw.value || undefined, role: f.role.value }
            : acc === 'self' ? { linkSelfUid: S.user.uid, email: S.user.email } : null;
          const pid = await api.createPerson(person, name, account);
          if (acc === 'self') { S.myPid = pid; S.profile.personId = pid; S.targetPid = pid; renderNav(); }
        } else {
          person.active = f.active.checked;
          await api.updatePersonFull(p.id, person, name, u && !isMe ? f.role.value : null, p.uid);
          if (!u && acc === 'new') await api.createAccountFor(p.id, f.email.value.trim(), f.pw.value || undefined, f.role.value);
        }
        dlg.close(); toast('Salvo.'); route();
      }, f.querySelector('[type=submit]'));
    });
  });
}

// ---------- Configurações (admin) ----------
async function viewConfig() {
  const s = S.settings;
  const row = (m) => `<tr><th>${L.MEAL_SHORT[m]}</th>
    <td><input type="time" name="early_${m}" value="${esc(s.early[m])}"></td>
    <td><input type="time" name="late_${m}" value="${esc(s.late[m])}"></td></tr>`;
  main.innerHTML = `<form class="card stack" id="f-cfg">
      <h2>Horários padrão</h2>
      <p class="muted small">Usados quando alguém marca +cedo ou +tarde sem informar o horário.</p>
      <div class="tablewrap"><table><thead><tr><th></th><th>+cedo</th><th>+tarde</th></tr></thead>
        <tbody>${L.MEALS.map(row).join('')}</tbody></table></div>
      <div class="row"><button class="primary" type="submit">Salvar</button></div></form>
    ${DEMO ? '<div class="card"><h2>Demonstração</h2><button class="danger" id="b-demo-reset">Restaurar dados de exemplo</button></div>' : ''}`;
  const f = $('#f-cfg');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const ns = { early: {}, late: {} };
    for (const m of L.MEALS) { ns.early[m] = f[`early_${m}`].value; ns.late[m] = f[`late_${m}`].value; }
    guard(async () => { await api.saveSettings(ns); S.settings = L.mergeSettings(ns); toast('Configurações salvas.'); }, f.querySelector('button'));
  });
  $('#b-demo-reset')?.addEventListener('click', () => { api.reset(); location.reload(); });
}

// ---------- Conta ----------
async function viewConta() {
  main.innerHTML = `<div class="card stack"><h2>Minha conta</h2>
      <p>${esc(S.user.email)}${S.myPid ? ` · ${esc(personById(S.myPid)?.initials)}` : ''}</p>
      <button id="b-logout">Sair</button></div>
    ${DEMO ? '' : `<form class="card stack" id="f-pw"><h2>Trocar senha</h2>
      <label>Senha atual <input type="password" name="old" autocomplete="current-password" required></label>
      <label>Nova senha <input type="password" name="pw1" minlength="6" autocomplete="new-password" required></label>
      <label>Repita a nova senha <input type="password" name="pw2" minlength="6" autocomplete="new-password" required></label>
      <div class="row"><button class="primary" type="submit">Trocar senha</button></div></form>`}`;
  $('#b-logout').addEventListener('click', () => { S.role = null; location.hash = ''; api.signOut(); });
  const f = $('#f-pw');
  f?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (f.pw1.value !== f.pw2.value) return toast('As senhas não conferem.');
    guard(async () => { await api.changePassword(f.old.value, f.pw1.value); f.reset(); toast('Senha alterada.'); }, f.querySelector('button'));
  });
}


// ---------- Estatísticas (admin e cozinha) ----------
async function collectDays(from, to) {
  const t = L.today();
  const [ovs, pers, notes, daily] = await Promise.all([api.listOverridesRange(from, to), api.listPeriodsFrom(from),
    api.listDayNotes(from, to), api.listDaily(from, to)]);
  const snap = Object.fromEntries(daily.map((x) => [x.date, x.meals]));
  const days = [];
  for (let d = from; d <= to; d = L.addDays(d, 1)) {
    if (d < t && snap[d]) { days.push({ date: d, meals: snap[d], saved: true }); continue; }
    const sum = L.applyDayNotes(L.summarize(S.people, d, pers, ovs, S.settings), notes.filter((n) => n.date === d));
    days.push({ date: d, meals: L.snapshotOf(sum), saved: false });
  }
  return days;
}

const SERIES = { cafe: 'var(--s1)', almoco: 'var(--s2)', jantar: 'var(--s3)' };

function barChart(days, meal) {
  const meals = meal ? [meal] : L.MEALS;
  const W = 720, H = 220, padL = 30, padB = 22, padT = 8;
  const totals = days.map((d) => meals.reduce((a, m) => a + d.meals[m].total, 0));
  const maxV = Math.max(1, ...totals);
  const step = maxV <= 10 ? 2 : maxV <= 25 ? 5 : 10;
  const top = Math.ceil(maxV / step) * step;
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const slot = (W - padL) / days.length;
  const bw = Math.max(2, Math.min(28, slot - 2));
  const every = Math.ceil(days.length / 10);
  let g = '';
  for (let v = 0; v <= top; v += step) {
    g += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
  }
  days.forEach((d, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    let acc = 0;
    meals.forEach((m) => {
      const v = d.meals[m].total;
      if (!v) return;
      const y1 = y(acc + v), y0 = y(acc);
      // 2px de folga entre os segmentos empilhados
      g += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(1, y0 - y1 - (acc ? 2 : 0))}" rx="2" fill="${SERIES[m]}"/>`;
      acc += v;
    });
    if (i % every === 0) g += `<text x="${x + bw / 2}" y="${H - 6}" class="ax" text-anchor="middle">${d.date.slice(8)}/${d.date.slice(5, 7)}</text>`;
    const tip = `${L.fmtDate(d.date)}: ${totals[i]}` + (meal ? '' : ` (${L.MEALS.map((m) => `${L.MEAL_SHORT[m]} ${d.meals[m].total}`).join(', ')})`);
    g += `<rect x="${padL + i * slot}" y="${padT}" width="${slot}" height="${H - padT - padB}" class="hit"><title>${esc(tip)}</title></rect>`;
  });
  const legend = meal ? '' : `<div class="legend">${L.MEALS.map((m) => `<span><i style="background:${SERIES[m]}"></i>${L.MEAL_SHORT[m]}</span>`).join('')}</div>`;
  return `${legend}<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pessoas por dia">${g}</svg>`;
}

async function viewEstatisticas() {
  const st = S.stats, t = L.today();
  const [from, to] = st.range === 'next7' ? [t, L.addDays(t, 6)] : [L.addDays(t, -(Number(st.range) - 1)), t];
  const days = await collectDays(from, to);
  const ag = L.aggregate(days, st.meal);
  const what = st.meal ? L.MEAL_LABEL[st.meal].toLowerCase() : 'todas as refeições';
  const f1 = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const tile = (label, value, sub = '') => `<div class="tile"><div class="tl">${label}</div><div class="tv">${value}</div>${sub ? `<div class="ts">${sub}</div>` : ''}</div>`;
  const order = [1, 2, 3, 4, 5, 6, 0];
  main.innerHTML = `
    <div class="card row">
      <label>Período <select id="st-range">
        ${[['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['next7', 'Próximos 7 dias (previsão)']]
          .map(([v, l]) => `<option value="${v}" ${st.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Refeição <select id="st-meal"><option value="">Todas</option>
        ${L.MEALS.map((m) => `<option value="${m}" ${st.meal === m ? 'selected' : ''}>${L.MEAL_LABEL[m]}</option>`).join('')}</select></label>
    </div>
    <p class="muted small">${L.fmtDate(from)} a ${L.fmtDate(to)} · ${what}</p>
    <div class="tiles">
      ${tile('Média por dia', f1(ag.avg), st.meal ? 'pessoas' : 'refeições servidas')}
      ${tile('Maior dia', ag.max, ag.maxDate ? L.fmtDate(ag.maxDate) : '')}
      ${tile('Menor dia', ag.min, ag.minDate ? L.fmtDate(ag.minDate) : '')}
      ${tile('Total no período', ag.sum, `${ag.days} dias`)}
    </div>
    <div class="card">${barChart(days, st.meal)}</div>
    <div class="card"><h3>Detalhes no período</h3>
      <div class="tiles small-tiles">
        ${tile('De regime', ag.counts.diet)}${tile('+cedo', ag.counts.early)}${tile('+tarde', ag.counts.late)}
        ${tile('P/ levar', ag.counts.takeaway)}${tile('Extras (recados)', ag.counts.extras)}
      </div></div>
    <div class="card tablewrap"><h3>Média por dia da semana</h3><table>
      <thead><tr><th></th>${L.MEALS.map((m) => `<th>${L.MEAL_SHORT[m]}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${order.filter((d) => ag.byDow[d].n).map((d) => {
        const w = ag.byDow[d];
        return `<tr><th>${L.DOW_LONG[d]}</th>${L.MEALS.map((m) => `<td>${f1(w[m])}</td>`).join('')}<td><b>${f1(w.cafe + w.almoco + w.jantar)}</b></td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="muted small">Dias passados usam o registro gravado quando o painel daquele dia foi aberto; dias sem registro
      são recalculados pelas regras atuais.</p>`;
  $('#st-range').addEventListener('change', (e) => { st.range = e.target.value; route(); });
  $('#st-meal').addEventListener('change', (e) => { st.meal = e.target.value; route(); });
}

// ---------- Mensagens (administrador ⇄ administradora da cozinha) ----------
async function viewMensagens() {
  const msgs = await api.listMessages();
  const canSend = isAdmin() || S.role === 'cozinha';
  const label = { k2a: 'Cozinha → Administrador', a2k: 'Administrador → Cozinha' };
  const mine = inboxDir();
  const list = msgs.map((m) => `<div class="msg ${m.dir === mine && !m.readAt ? 'unread' : ''}">
      <div class="row spread small"><b>${label[m.dir]}</b><span class="muted">${fmtDateTime(m.createdAt)}${
        m.dir !== mine && m.readAt ? ' · lida' : ''}</span></div>
      <div class="msgtext">${esc(m.text)}</div>
      ${isAdmin() ? `<button class="link small" data-delmsg="${m.id}">apagar</button>` : ''}</div>`).join('');
  main.innerHTML = `
    ${canSend ? `<form class="card stack" id="f-msg">
      <h2>Nova mensagem ${isAdmin() ? 'para a cozinha' : 'para o administrador'}</h2>
      <textarea name="text" rows="3" maxlength="1000" required></textarea>
      <div class="row"><button class="primary" type="submit">Enviar</button></div></form>` : ''}
    <div class="card"><h2>Mensagens</h2>${list || '<p class="muted">Nenhuma mensagem.</p>'}</div>`;
  const f = $('#f-msg');
  f?.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(async () => {
      await api.sendMessage(isAdmin() ? 'a2k' : 'k2a', f.text.value.trim(), S.user.uid, S.user.email);
      toast('Mensagem enviada.'); route();
    }, f.querySelector('button'));
  });
  $$('[data-delmsg]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Apagar esta mensagem?')) return;
    guard(async () => { await api.deleteMessage(b.dataset.delmsg); route(); }, b);
  }));
  const toMark = msgs.filter((m) => m.dir === mine && !m.readAt);
  if (toMark.length) {
    await Promise.all(toMark.map((m) => api.markRead(m.id).catch(console.warn)));
    S.unread = 0; renderNav();
  }
}

// ---------- Equipe da cozinha (administradora cria auxiliares) ----------
async function viewEquipe() {
  const aux = await api.listAuxiliaries();
  main.innerHTML = `<div class="card"><h2>Auxiliares de cozinha</h2>
      <p class="muted small">Veem o mesmo painel que você (somente iniciais), mas não criam contas nem mandam mensagens.</p>
      ${aux.map((u) => `<div class="list-item"><span>${esc(u.email)}</span>
        <button class="danger" data-rm="${u.id}">Remover acesso</button></div>`).join('') || '<p class="muted">Nenhuma.</p>'}</div>
    <form class="card stack" id="f-aux"><h2>Criar conta de auxiliar</h2>
      ${accountFields()}
      <div class="row"><button class="primary" type="submit">Criar conta</button></div></form>`;
  const f = $('#f-aux');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (f.pw.value && f.pw.value.length < 6) return toast('A senha precisa ter pelo menos 6 caracteres.');
    guard(async () => {
      await api.createKitchen(f.email.value.trim(), f.pw.value || undefined, 'auxiliar');
      toast(f.pw.value ? 'Conta criada.' : 'Conta criada; a pessoa recebeu um e-mail para criar a senha.'); route();
    }, f.querySelector('[type=submit]'));
  });
  $$('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remover o acesso desta auxiliar?')) return;
    guard(async () => { await api.removeUserProfile(b.dataset.rm); route(); }, b);
  }));
}

// Campos de e-mail + senha provisória (opcional: sem senha, a pessoa recebe e-mail para criar a sua)
function accountFields() {
  return `<label>E-mail <input type="email" name="email" required></label>
    <label>Senha provisória (opcional) <input type="text" name="pw" minlength="6" autocomplete="off"></label>
    <p class="muted small">Com senha provisória, a pessoa troca a senha no primeiro acesso. Sem senha, ela recebe
      um e-mail para criar a própria senha (pode cair no spam).</p>`;
}

// ---------- Importação da planilha (admin) ----------
const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

function importDialog() {
  let parsed = null;
  openDialog(`<div class="stack" id="imp">
      <h3>Importar planilha de comensais</h3>
      <p class="muted small">Colunas: Iniciais, E-mail, Nome, Regime, Papel e uma coluna por refeição
        (“Seg Café”, “Seg Almoço”… “Dom Jantar”) com x, cedo, tarde ou levar (pode ter horário: “tarde 21:30”).
        Quem já existe (mesmas iniciais) é atualizado.</p>
      <input type="file" id="imp-file" accept=".xlsx,.xls,.csv">
      <fieldset><legend>Logins para quem tem e-mail e ainda não tem conta</legend>
        <div class="seg">
          <label><input type="radio" name="impacc" value="link" checked> E-mail para cada um criar a senha</label>
          <label><input type="radio" name="impacc" value="pw"> Senha provisória comum</label>
          <label><input type="radio" name="impacc" value="none"> Não criar logins agora</label>
        </div>
        <label id="imp-pwbox" hidden style="margin-top:8px">Senha provisória (todos trocam no 1º acesso)
          <input type="text" id="imp-pw" minlength="6" autocomplete="off"></label>
      </fieldset>
      <div id="imp-preview"></div>
      <div class="row spread"><span id="imp-status" class="small muted"></span>
        <span class="row"><button type="button" data-close>Fechar</button>
        <button class="primary" id="imp-go" disabled>Importar</button></span></div>
    </div>`, (root) => {
    const accMode = () => $('input[name=impacc]:checked', root).value;
    root.addEventListener('change', (e) => {
      if (e.target.name === 'impacc') { $('#imp-pwbox', root).hidden = accMode() !== 'pw'; if (parsed) preview(); }
    });
    const preview = () => {
      const rows = parsed.records.map((r) => {
        const ex = S.people.find((p) => p.initials === r.initials);
        const action = r.errors.length ? `<span class="err">${esc(r.errors.join('; '))}</span>` : ex ? 'atualizar' : 'novo';
        const login = ex?.uid ? 'já tem' : !r.email ? '—' : !L.isEmail(r.email) ? '<span class="err">e-mail inválido</span>'
          : r.email === S.user.email ? 'você' : accMode() === 'none' ? 'não' : 'criar';
        return `<tr><td><b>${esc(r.initials)}</b></td><td>${esc(r.fullName)}</td><td>${r.diet ? 'sim' : ''}</td>
          <td>${action}</td><td>${login}</td><td class="small">${esc(r.warnings.join('; '))}</td></tr>`;
      }).join('');
      $('#imp-preview', root).innerHTML = `<div class="tablewrap"><table class="small">
        <thead><tr><th>Inic.</th><th>Nome</th><th>Regime</th><th>Ação</th><th>Login</th><th>Avisos</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        ${parsed.hasRule ? '' : '<p class="alert small">A planilha não tem colunas de refeições: novos comensais entram com “todas as refeições”, e as regras de quem já existe não mudam.</p>'}`;
    };
    $('#imp-file', root).addEventListener('change', (e) => guard(async () => {
      const file = e.target.files[0];
      if (!file) return;
      $('#imp-status', root).textContent = 'Lendo…';
      const XLSX = await import(SHEETJS);
      const wb = XLSX.read(await file.arrayBuffer());
      const name = wb.SheetNames.find((n) => L.norm(n) === 'comensais') || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
      parsed = L.parseImportRows(rows);
      if (parsed.error) { $('#imp-status', root).textContent = parsed.error; return; }
      $('#imp-status', root).textContent = `${parsed.records.length} linhas na aba “${name}”.`;
      preview();
      $('#imp-go', root).disabled = false;
    }));
    $('#imp-go', root).addEventListener('click', (e) => {
      const mode = accMode(), pw = $('#imp-pw', root).value;
      if (mode === 'pw' && pw.length < 6) return toast('A senha provisória precisa ter pelo menos 6 caracteres.');
      guard(async () => {
        const log = [];
        const status = $('#imp-status', root);
        const todo = parsed.records.filter((r) => !r.errors.length);
        for (const [k, r] of todo.entries()) {
          status.textContent = `Importando ${k + 1} de ${todo.length} (${r.initials})…`;
          const ex = S.people.find((p) => p.initials === r.initials);
          const person = { initials: r.initials };
          if (r.diet !== null) person.diet = r.diet;
          if (r.grid) person.defaultRule = r.grid;
          const name = { fullName: r.fullName, email: r.email };
          const self = r.email && r.email === S.user.email;
          const wantLogin = mode !== 'none' && L.isEmail(r.email) && !self;
          const account = wantLogin ? { email: r.email, password: mode === 'pw' ? pw : undefined, role: r.role } : null;
          try {
            if (ex) {
              await api.importUpdate(ex.id, person, name);
              if (!ex.uid && wantLogin) {
                try { await api.createAccountFor(ex.id, r.email, account.password, r.role); log.push(`${r.initials}: atualizado + login criado`); }
                catch (err) { log.push(`${r.initials}: atualizado, mas login falhou (${errMsg(err)})`); }
              } else log.push(`${r.initials}: atualizado`);
            } else {
              Object.assign(person, { guest: false, defaultRule: r.grid || L.PRESETS.todas.grid(), diet: !!r.diet });
              if (self && !S.myPid) {
                const pid = await api.createPerson(person, name, { linkSelfUid: S.user.uid, email: S.user.email });
                S.myPid = pid; S.profile.personId = pid; S.targetPid = pid;
                log.push(`${r.initials}: criado e vinculado à sua conta`);
              } else {
                try { await api.createPerson(person, name, account); log.push(`${r.initials}: criado${account ? ' + login' : ''}`); }
                catch (err) {
                  if (!account) throw err;
                  await api.createPerson(person, name, null);
                  log.push(`${r.initials}: criado sem login (${errMsg(err)})`);
                }
              }
            }
          } catch (err) { log.push(`${r.initials}: ERRO ${errMsg(err)}`); }
        }
        await loadPeople(); renderNav();
        status.textContent = 'Concluído.';
        e.target.hidden = true;
        $('#imp-preview', root).innerHTML = `<ul class="notes small">${log.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
        dlg.addEventListener('close', () => route(), { once: true });
      }, e.target);
    });
  });
}

const VIEWS = {
  painel: viewPainel, semana: viewSemana, minhas: viewMinhas, padrao: viewPadrao,
  temporarias: viewTemporarias, pessoas: viewPessoas, config: viewConfig, conta: viewConta,
  estatisticas: viewEstatisticas, mensagens: viewMensagens, equipe: viewEquipe,
};
