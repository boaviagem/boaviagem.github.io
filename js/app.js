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
  stats: { range: '30', meal: '' }, unread: 0, alerts: 0,
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

function chip(item, cls = '', extra = '', meal = '') {
  const name = isAdmin() ? fullName(item.id) : '';
  const label = esc(item.initials) + (S.showNames && name ? ` <span class="t">${esc(name)}</span>` : '');
  const edit = meal && isAdmin() ? ` data-pid="${item.id}" data-meal="${meal}" role="button" tabindex="0"` : '';
  const dietText = item.diet ? personById(item.id)?.dietText : '';
  return `<span class="chip ${cls} ${item.diet ? 'diet' : ''} ${item.guest ? 'guest' : ''} ${edit ? 'editable' : ''}"${edit} title="${esc(name)}${item.diet ? ` (regime${dietText ? ': ' + esc(dietText) : ''})` : ''}${edit ? ' — tocar para alterar' : ''}">${label}${extra ? ` <span class="t">${esc(extra)}</span>` : ''}</span>`;
}

// ---------- Sessão ----------
api.onAuth(async (u) => {
  S.user = u;
  stopWatchingCalls();
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
  if (isAdmin()) startWatchingCalls();
  if (isAdmin()) api.migrateNotes().then((n) => n && console.info(`${n} observação(ões) movidas`)).catch((e) => console.warn('migrateNotes', e));
  return true;
}

// Mensagens não lidas destinadas a mim (admin ← cozinha, cozinha ← admin)
const inboxDir = () => (isAdmin() ? 'k2a' : S.role === 'cozinha' ? 'a2k' : null);
async function refreshUnread() {
  try {
    if (inboxDir()) S.unread = (await api.listMessages()).filter((m) => m.dir === inboxDir() && !m.readAt).length;
    if (isKitchen()) S.alerts = (await api.listAlerts()).filter((a) => !a.ackAt).length;
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
    k === 'mensagens' && S.unread ? ` <span class="count">${S.unread}</span>` : ''}${
    k === 'painel' && S.alerts ? ` <span class="count" title="Mudanças depois do aviso">${S.alerts}</span>` : ''}</a>`).join('');
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
function mealCard(meal, s, date) {
  const chips = (arr, cls, timeFn) => `<div class="chips">${arr.map((i) => chip(i, cls, timeFn?.(i), meal)).join('')}</div>`;
  const parts = [];
  const ev = s.event;
  parts.push(`<div class="meal-head"><h3>${L.MEAL_LABEL[meal]}${ev ? ' <span class="badge bbq">🔥 churrasco</span>' : ''}</h3><span class="total">${s.total}</span></div>`);
  if (ev) {
    parts.push(`<div class="event">🔥 <b>Churrasco</b>: ${Number(ev.count) || 0} participantes · ${esc(L.AUDIENCE[ev.audience] || ev.audience || '')}
      ${ev.note ? `<br><span class="small">${esc(ev.note)}</span>` : ''}${s.extras ? `<br><span class="small">+ ${s.extras} extra(s)</span>` : ''}</div>`);
    parts.push(`<details class="residents"><summary>Moradores marcados: ${s.residents} (não somam ao total)</summary>`);
  }
  const resumo = [`${s.diet} de regime`];
  if (s.extras) resumo.push(`${s.extras} extra${s.extras > 1 ? 's' : ''}`);
  if (s.early.length) resumo.push(`${s.early.length} +cedo`);
  if (s.late.length) resumo.push(`${s.late.length} +tarde`);
  if (s.takeaway.length) resumo.push(`${s.takeaway.length} p/ levar`);
  parts.push(`<div class="muted small">${resumo.join(' · ')}</div>`);
  if (s.dietAbsent.length) {
    parts.push(`<div class="sub">Regimes ausentes</div>${chips(s.dietAbsent, 'absent')}`);
  }
  if (s.normal.length) parts.push(`<div class="sub">Horário normal (${s.normal.length})</div>${chips(s.normal)}`);
  if (s.early.length) parts.push(`<div class="sub">Mais cedo</div>${chips(s.early, 'early', (i) => i.timeShown || '+cedo')}`);
  if (s.late.length) parts.push(`<div class="sub">Mais tarde</div>${chips(s.late, 'late', (i) => i.timeShown || '+tarde')}`);
  if (s.takeaway.length) parts.push(`<div class="sub">Para levar</div>${chips(s.takeaway, 'take', (i) => i.timeShown)}`);
  if (isAdmin() && s.notes.length) {
    const ctl = (i) => !i.noteId ? ''
      : (i.noteApproved ? ' <span class="badge plus">cozinha vê (sem autor)</span>' : ' <span class="badge">só você vê</span>')
        + ` <button class="link small" data-editnote="${i.noteId}">editar</button>`
        + ` <button class="link small" data-approve="${i.noteId}" data-v="${i.noteApproved ? 0 : 1}">${i.noteApproved ? 'ocultar' : 'liberar para a cozinha'}</button>`;
    parts.push(`<div class="sub">Observações</div><ul class="notes">${s.notes.map((i) =>
      `<li><strong>${esc(i.initials)}</strong>${i.diet ? ' <span class="badge">R</span>' : ''}${i.on ? '' : ' <span class="muted">(não vem)</span>'}: ${esc(i.note)}${ctl(i)}</li>`).join('')}</ul>`);
  } else if (!isAdmin() && s.anonNotes?.length) {
    parts.push(`<div class="sub">Observações</div><ul class="notes">${s.anonNotes.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul>`);
  }
  if (s.dayNotes?.length) {
    parts.push(`<div class="sub">Recados do administrador</div><ul class="notes">${s.dayNotes.map(dayNoteItem).join('')}</ul>`);
  }
  if (!s.total && !s.dietAbsent.length && !s.notes.length && !s.anonNotes?.length) parts.push('<p class="muted">Ninguém.</p>');
  if (ev) parts.push('</details>');
  const st = L.mealStatus(date, meal, S.settings);
  if (st === 'late') parts.push(`<p class="small muted" style="margin-top:8px">🔔 Cozinha avisada (prazo: ${L.fmtDeadline(date, meal, S.settings)})</p>`);
  if (isAdmin()) {
    parts.push(`<div class="row adminbar"><button class="small" data-plus="${meal}">+ Pessoas</button>
      ${L.isBbqMeal(date, meal) || ev ? `<button class="small" data-bbq="${meal}">🔥 Churrasco</button>` : ''}
      <button class="small" data-other="${meal}">Alterar pessoa…</button></div>`);
  }
  return `<section class="card">${parts.join('')}</section>`;
}

function dayNoteItem(n) {
  return `<li class="daynote">${esc(n.text)}${Number(n.extra) > 0 ? ` <span class="badge plus">+${Number(n.extra)}</span>` : ''}${
    isAdmin() ? ` <button class="link small" data-delnote="${n.id}" title="Apagar recado">apagar</button>` : ''}</li>`;
}

// Totais de um dia (com recados) — também grava a "fotografia" do dia para as estatísticas.
async function daySummary(date) {
  const [ovs0, pers, notes, events, cnotes] = await Promise.all([api.listOverridesRange(date, date), api.listPeriodsFrom(date),
    api.listDayNotes(date, date), api.listEvents(date, date),
    isAdmin() ? api.listNotes(date, date) : api.listKitchenNotes(date, date)]);
  // administrador: observações com autor; cozinha: só as cópias anônimas
  const ovs = isAdmin() ? L.mergeNotes(ovs0, cnotes) : L.mergeNotes(ovs0, []);
  const sum = L.applyKitchenNotes(L.applyEvents(L.applyDayNotes(L.summarize(S.people, date, pers, ovs, S.settings), notes), events),
    isAdmin() ? [] : cnotes);
  saveSnapshot(date, sum);
  return { sum, notes, ovs, pers, events, cnotes };
}

// ---------- Chamados: a cozinha chama o administrador ----------
const CALL_REASONS = ['Urgente', 'Falta de ingrediente', 'Dúvida sobre refeição', 'Outro'];
async function kitchenCallCard() {
  const recent = (await api.listCalls()).filter((c) => Date.now() - c.createdAt < 864e5).slice(0, 5);
  return `<div class="card callcard"><div class="row spread">
      <span class="small muted">Precisa do administrador?</span>
      <button class="primary" id="b-call">🔔 Chamar o administrador</button></div>
    ${recent.length ? `<ul class="notes small" style="margin-top:8px">${recent.map((c) => `<li>${fmtDateTime(c.createdAt)} — <b>${esc(c.reason)}</b>${
      c.text ? ': ' + esc(c.text) : ''} · ${c.seenAt ? `<span class="muted">visto ${fmtDateTime(c.seenAt)}</span>` : '<span style="color:var(--warn)">aguardando</span>'}</li>`).join('')}</ul>` : ''}</div>`;
}
function callDialog() {
  openDialog(`<form id="f-call" class="stack">
      <h3>🔔 Chamar o administrador</h3>
      <div class="seg">${CALL_REASONS.map((r, i) => `<label><input type="radio" name="reason" value="${r}" ${i === 0 ? 'checked' : ''}> ${r}</label>`).join('')}</div>
      <label>Mensagem (opcional) <input name="text" maxlength="200" placeholder="ex.: acabou o gás"></label>
      <div class="row spread"><span></span><span class="row"><button type="button" data-close>Cancelar</button>
        <button class="primary" type="submit">Chamar</button></span></div></form>`, (root) => {
    const f = $('#f-call', root);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(async () => {
        await api.addCall({ reason: f.reason.value, text: f.text.value.trim(), role: S.role, email: S.user.email }, S.user.uid);
        dlg.close(); toast('Administrador chamado.'); route();
      }, f.querySelector('[type=submit]'));
    });
  });
}

// Administrador: faixa no topo com os chamados não vistos, atualizada em tempo real
let unwatchCalls = null, knownCalls = new Set();
function stopWatchingCalls() { unwatchCalls?.(); unwatchCalls = null; knownCalls = new Set(); $('#callbar').hidden = true; }
function startWatchingCalls() {
  stopWatchingCalls();
  let first = true;
  unwatchCalls = api.watchOpenCalls((calls) => {
    calls.sort((a, b) => b.createdAt - a.createdAt);
    const fresh = calls.filter((c) => !knownCalls.has(c.id));
    calls.forEach((c) => knownCalls.add(c.id));
    if (!first && fresh.length) notifyCall(fresh[0]);
    first = false;
    renderCallbar(calls);
  });
}
function renderCallbar(calls) {
  const bar = $('#callbar');
  if (!calls.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.innerHTML = calls.map((c) => `<div class="call-item"><span>🔔 <b>A cozinha está chamando</b> — ${esc(c.reason)}${
    c.text ? ': ' + esc(c.text) : ''} <span class="small">(${fmtDateTime(c.createdAt)})</span></span>
    <button class="small" data-seen="${c.id}">Visto</button></div>`).join('');
  bar.hidden = false;
  $$('[data-seen]', bar).forEach((b) => b.addEventListener('click', () => guard(() => api.markCallSeen(b.dataset.seen, S.user.uid), b)));
}
function notifyCall(c) {
  try { // bipe curto
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.4);
  } catch { /* sem áudio */ }
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { new Notification('Cozinha chamando', { body: c.reason + (c.text ? ': ' + c.text : '') }); } catch { /* */ }
  }
}

// ---------- Aniversários e regimes (visíveis para a cozinha) ----------
function birthdayCard(date) {
  const list = L.birthdaysBetween(S.people, date, 8);
  if (!list.length) return '';
  const today = list.filter((x) => x.date === date), next = list.filter((x) => x.date !== date);
  return `<div class="card bday">${today.length ? `<div>🎂 <b>Hoje é aniversário de ${today.map((x) => esc(x.person.initials)).join(', ')}</b></div>` : ''}
    ${next.length ? `<div class="small muted">Próximos: ${next.map((x) => `${esc(x.person.initials)} (${L.fmtDate(x.date).toLowerCase()})`).join(' · ')}</div>` : ''}</div>`;
}
function dietCard() {
  const diet = S.people.filter((p) => p.active !== false && p.diet);
  if (!diet.length) return '';
  return `<details class="card diets"><summary><b>Regimes (${diet.length})</b> <span class="small muted">— toque para ver</span></summary>
    <ul class="notes">${diet.map((p) => `<li><span class="chip diet">${esc(p.initials)}</span> ${p.dietText ? esc(p.dietText) : '<span class="muted">(sem descrição)</span>'}</li>`).join('')}</ul></details>`;
}

// ---------- Alertas: mudanças depois do horário de aviso ----------
async function sendAlert(person, items) {
  if (!items.length) return;
  await api.addAlert({ personId: person?.id || null, initials: person ? person.initials : 'Administrador', items }, S.user.uid);
}
// Para o administrador: alerta se a refeição já foi avisada (churrasco, +pessoas, recados)
async function adminLateAlert(date, meal, text) {
  if (L.mealStatus(date, meal, S.settings) !== 'late') return false;
  await sendAlert(null, [{ date, meal, text: `${L.MEAL_SHORT[meal]} ${L.fmtDate(date).toLowerCase()}: ${text}` }]);
  return true;
}
// Mudanças de regra (padrão ou temporária) que atingem refeições já avisadas: confirma e devolve os itens.
async function lateRuleCheck(person, change) {
  const [ovs, pers] = await Promise.all([api.listOverridesByPerson(person.id), api.listPeriodsByPerson(person.id)]);
  const a = { person, periods: pers, ovMap: L.overrideMap(ovs) };
  const items = L.lateDiffs(a, { ...a, ...change(a) }, S.settings);
  if (items.length && !confirm(`Já passou o horário de avisar a cozinha destas refeições:\n\n${items.map((i) => '• ' + i.text).join('\n')}\n\nSe continuar, a cozinha receberá um alerta. Continuar?`)) return null;
  return items;
}

function alertsCard(alerts) {
  const recent = alerts.filter((a) => !a.ackAt || Date.now() - a.createdAt < 2 * 864e5);
  if (!recent.length) return '';
  const pending = recent.filter((a) => !a.ackAt).length;
  return `<div class="card alerts"><div class="row spread"><div class="sub" style="margin:0">⚠ Mudanças depois do aviso${pending ? ` (${pending} nova${pending > 1 ? 's' : ''})` : ''}</div>
      ${isKitchen() && pending > 1 ? '<button class="small" data-ackall>Ciente de todas</button>' : ''}</div>
    ${recent.map((a) => `<div class="alert-item ${a.ackAt ? 'acked' : ''}">
      <div><b>${esc(a.initials)}</b> <span class="muted small">· ${fmtDateTime(a.createdAt)}</span>
        <ul class="notes">${(a.items || []).map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul></div>
      <div class="small">${a.ackAt ? `<span class="muted">ciente ✓ ${fmtDateTime(a.ackAt)}</span>`
        : isKitchen() ? `<button class="primary small" data-ack="${a.id}">Ciente</button>` : '<span class="muted">aguardando a cozinha</span>'}
        ${isAdmin() ? ` <button class="link small" data-delalert="${a.id}">apagar</button>` : ''}</div></div>`).join('')}</div>`;
}
function bindAlerts(alerts) {
  const ack = async (ids) => { await Promise.all(ids.map((id) => api.ackAlert(id, S.user.uid))); S.alerts = 0; refreshUnread(); route(); };
  $$('[data-ack]').forEach((b) => b.addEventListener('click', () => guard(() => ack([b.dataset.ack]), b)));
  $('[data-ackall]')?.addEventListener('click', (e) => guard(() => ack(alerts.filter((a) => !a.ackAt).map((a) => a.id)), e.target));
  $$('[data-delalert]').forEach((b) => b.addEventListener('click', () => guard(async () => { await api.deleteAlert(b.dataset.delalert); route(); }, b)));
}

// ---------- Administrador: editar a observação de um comensal ----------
function editNoteDialog(n) {
  const who = personById(n.personId);
  openDialog(`<form id="f-enote" class="stack">
      <h3>Observação de ${esc(who?.initials || '?')} · ${L.MEAL_LABEL[n.meal]} — ${L.fmtDate(n.date, true)}</h3>
      <label>Texto <textarea name="text" rows="3" maxlength="300" required>${esc(n.text)}</textarea></label>
      <label class="check"><input type="checkbox" name="share" ${n.approved ? 'checked' : ''}> visível para a cozinha (sem o autor)</label>
      <div class="row spread"><button type="button" class="danger" id="b-delnote">Apagar</button>
        <span class="row"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">Salvar</button></span></div></form>`, (root) => {
    const f = $('#f-enote', root);
    $('#b-delnote', root).addEventListener('click', (e) => {
      if (!confirm('Apagar esta observação?')) return;
      guard(async () => { await api.deleteNote(n.personId, n.date, n.meal, n.kitchenId); dlg.close(); toast('Observação apagada.'); route(); }, e.target);
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(async () => {
        await api.saveNote({ ...n, text: f.text.value.trim() }, f.share.checked, n.kitchenId, S.user.uid);
        dlg.close(); toast('Observação salva.'); route();
      }, f.querySelector('[type=submit]'));
    });
  });
}

// ---------- Administrador: + pessoas e churrasco numa refeição ----------
function plusPeopleDialog(date, meal) {
  openDialog(`<form id="f-plus" class="stack">
      <h3>+ Pessoas · ${L.MEAL_LABEL[meal]} — ${L.fmtDate(date, true)}</h3>
      <div class="row">${[1, 2, 5, 10].map((n) => `<button type="button" data-n="${n}">+${n}</button>`).join('')}</div>
      <label>Quantidade <input type="number" name="n" min="1" max="200" value="1" required></label>
      <label>Quem são (opcional) <input name="text" maxlength="200" placeholder="ex.: visitantes, o marceneiro Vanderley"></label>
      <div class="row spread"><span></span><span class="row"><button type="button" data-close>Cancelar</button>
        <button class="primary" type="submit">Acrescentar</button></span></div></form>`, (root) => {
    const f = $('#f-plus', root);
    $$('[data-n]', root).forEach((b) => b.addEventListener('click', () => { f.n.value = b.dataset.n; }));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Math.max(1, Number(f.n.value) || 1);
      const text = f.text.value.trim() || `${n} pessoa${n > 1 ? 's' : ''} a mais`;
      guard(async () => {
        await api.addDayNote({ date, meal, text, extra: n }, S.user.uid);
        const late = await adminLateAlert(date, meal, `+${n} (${text})`);
        dlg.close(); toast(late ? 'Acrescentado — a cozinha foi alertada.' : 'Acrescentado.'); route();
      }, f.querySelector('[type=submit]'));
    });
  });
}

function bbqDialog(date, meal, ev) {
  const radio = (v, l) => `<label><input type="radio" name="aud" value="${v}" ${(ev?.audience || 'estudantes') === v ? 'checked' : ''}> ${l}</label>`;
  openDialog(`<form id="f-bbq" class="stack">
      <h3>🔥 Churrasco · ${L.MEAL_LABEL[meal]} — ${L.fmtDate(date, true)}</h3>
      <p class="muted small">O total da refeição passa a ser o número de participantes (os moradores marcados não somam).</p>
      <label>Participantes <input type="number" name="count" min="1" max="500" value="${ev?.count || ''}" required></label>
      <div class="seg">${radio('estudantes', 'Estudantes')}${radio('profissionais', 'Profissionais')}${radio('misto', 'Misto')}</div>
      <label>Observação (opcional) <input name="note" maxlength="200" value="${esc(ev?.note)}"></label>
      <div class="row spread">${ev ? '<button type="button" class="danger" id="b-nobbq">Não é mais churrasco</button>' : '<span></span>'}
        <span class="row"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">Salvar</button></span></div></form>`, (root) => {
    const f = $('#f-bbq', root);
    $('#b-nobbq', root)?.addEventListener('click', (e) => guard(async () => {
      await api.deleteEvent(date, meal);
      const late = await adminLateAlert(date, meal, 'churrasco cancelado (volta a refeição normal)');
      dlg.close(); toast(late ? 'Churrasco removido — a cozinha foi alertada.' : 'Churrasco removido.'); route();
    }, e.target));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const count = Number(f.count.value) || 0, audience = f.aud.value;
      guard(async () => {
        await api.setEvent({ date, meal, type: 'churrasco', count, audience, note: f.note.value.trim() }, S.user.uid);
        const late = await adminLateAlert(date, meal, `churrasco, ${count} participantes (${L.AUDIENCE[audience]})`);
        dlg.close(); toast(late ? 'Churrasco salvo — a cozinha foi alertada.' : 'Churrasco salvo.'); route();
      }, f.querySelector('[type=submit]'));
    });
  });
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
        const extra = f.meal.value ? Number(f.extra.value) || 0 : 0;
        await api.addDayNote({ date, meal: f.meal.value, text: f.text.value.trim(), extra }, S.user.uid);
        if (f.meal.value && extra) await adminLateAlert(date, f.meal.value, `+${extra} (${f.text.value.trim()})`);
        dlg.close(); toast('Recado enviado.'); route();
      }, f.querySelector('[type=submit]'));
    });
  });
}
function bindDayNoteDeletes(notes = []) {
  $$('[data-delnote]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Apagar este recado?')) return;
    const n = notes.find((x) => x.id === b.dataset.delnote);
    guard(async () => {
      await api.deleteDayNote(b.dataset.delnote);
      if (n?.meal && Number(n.extra) > 0) await adminLateAlert(n.date, n.meal, `retirado +${n.extra} (${n.text})`);
      route();
    }, b);
  }));
}

async function viewPainel() {
  const date = S.dashDate;
  const { sum, notes, ovs, pers, events, cnotes } = await daySummary(date);
  const general = notes.filter((n) => !n.meal);
  const alerts = isAdmin() || isKitchen() ? await api.listAlerts() : [];
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
    ${isKitchen() ? await kitchenCallCard() : ''}
    ${alertsCard(alerts)}
    ${birthdayCard(date)}
    ${general.length ? `<div class="card recado"><div class="sub" style="margin-top:0">Recados do administrador</div>
      <ul class="notes">${general.map(dayNoteItem).join('')}</ul></div>` : ''}
    <div class="grid3">${L.MEALS.map((m) => mealCard(m, sum[m], date)).join('')}</div>
    ${dietCard()}
    ${isAdmin() ? '<p class="muted small">Toque numa pessoa para tirá-la da refeição, mudar o horário ou deixar observação.</p>' : ''}
    <p class="muted small" style="margin-top:12px"><span class="chip diet">XX</span> = regime ·
      <span class="chip absent">XX</span> = regime ausente</p>`;
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.go);
    S.dashDate = n === 0 ? L.today() : L.addDays(date, n); route();
  }));
  $('#dash-date').addEventListener('change', (e) => { if (e.target.value) { S.dashDate = e.target.value; route(); } });
  $('#b-reload').addEventListener('click', () => route());
  $('#b-note')?.addEventListener('click', () => addDayNoteDialog(date));
  bindAlerts(alerts);
  $('#b-call')?.addEventListener('click', callDialog);
  const noteById = (id) => cnotes.find((n) => n.id === id);
  $$('[data-approve]').forEach((b) => b.addEventListener('click', () => guard(async () => {
    const n = noteById(b.dataset.approve);
    await api.saveNote(n, b.dataset.v === '1', n.kitchenId, S.user.uid);
    toast(b.dataset.v === '1' ? 'Observação liberada para a cozinha (sem o autor).' : 'Observação ocultada da cozinha.'); route();
  }, b)));
  $$('[data-editnote]').forEach((b) => b.addEventListener('click', () => editNoteDialog(noteById(b.dataset.editnote))));
  $$('[data-plus]').forEach((b) => b.addEventListener('click', () => plusPeopleDialog(date, b.dataset.plus)));
  $$('[data-bbq]').forEach((b) => b.addEventListener('click', () => bbqDialog(date, b.dataset.bbq, events.find((e) => e.meal === b.dataset.bbq))));
  if (isAdmin()) {
    const ovMap = L.overrideMap(ovs);
    const open = (pid, meal) => { const p = personById(pid); if (p) editMeal(p, date, meal, pers, ovMap); };
    $$('.chip[data-pid]').forEach((c) => {
      c.addEventListener('click', () => open(c.dataset.pid, c.dataset.meal));
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(c.dataset.pid, c.dataset.meal); });
    });
    $$('[data-other]').forEach((b) => b.addEventListener('click', () => {
      const meal = b.dataset.other;
      const opts = S.people.filter((p) => p.active !== false).map((p) => {
        const r = L.resolve(p, date, meal, pers, ovMap, S.settings);
        return `<option value="${p.id}">${esc(p.initials)} — ${esc(fullName(p.id))} (${r.on ? 'faz' : 'não faz'})</option>`;
      }).join('');
      openDialog(`<form id="f-other" class="stack"><h3>${L.MEAL_LABEL[meal]} — ${L.fmtDate(date, true)}</h3>
          <label>Pessoa <select name="pid">${opts}</select></label>
          <div class="row spread"><span></span><span class="row"><button type="button" data-close>Cancelar</button>
          <button class="primary" type="submit">Continuar</button></span></div></form>`, (root) => {
        const f = $('#f-other', root);
        f.addEventListener('submit', (e) => { e.preventDefault(); open(f.pid.value, meal); });
      });
    }));
  }
  bindDayNoteDeletes(notes);
  $('#ck-names')?.addEventListener('change', (e) => { S.showNames = e.target.checked; route(); });
}

// ---------- Semana ----------
async function viewSemana() {
  const from = S.dashDate, to = L.addDays(from, 6);
  const [ovs0, pers, notes, events, cnotes] = await Promise.all([api.listOverridesRange(from, to), api.listPeriodsFrom(from),
    api.listDayNotes(from, to), api.listEvents(from, to),
    isAdmin() ? api.listNotes(from, to) : api.listKitchenNotes(from, to)]);
  const ovs = L.mergeNotes(ovs0, isAdmin() ? cnotes : []);
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const d = L.addDays(from, i);
    const dn = notes.filter((n) => n.date === d);
    const sum = L.applyKitchenNotes(L.applyEvents(L.applyDayNotes(L.summarize(S.people, d, pers, ovs, S.settings), dn), events.filter((e) => e.date === d)),
      isAdmin() ? [] : cnotes.filter((n) => n.date === d));
    const cells = L.MEALS.map((m) => {
      const s = sum[m];
      const extra = [];
      if (s.event) extra.push(`🔥 churrasco (${esc(L.AUDIENCE[s.event.audience] || '')})`);
      if (s.early.length) extra.push(`${s.early.length} +cedo`);
      if (s.late.length) extra.push(`${s.late.length} +tarde`);
      if (s.takeaway.length) extra.push(`${s.takeaway.length} levar`);
      const nobs = s.notes.length + (s.anonNotes?.length || 0);
      if (nobs) extra.push(`${nobs} obs.`);
      if (s.extras) extra.push(`${s.extras} extra${s.extras > 1 ? 's' : ''}`);
      const abs = s.dietAbsent.length ? `<div class="small" style="color:var(--warn)">regime fora: ${s.dietAbsent.map((x) => esc(x.initials)).join(' ')}</div>` : '';
      return `<td><span class="num">${s.total}</span> <span class="muted small">(${s.diet} reg.)</span>
        ${extra.length ? `<div class="small" style="color:var(--info)">${extra.join(' · ')}</div>` : ''}${abs}</td>`;
    }).join('');
    const gen = dn.filter((n) => !n.meal).length;
    const bd = L.birthdaysBetween(S.people, d, 1).map((x) => esc(x.person.initials)).join(' ');
    rows.push(`<tr class="clickable" data-d="${d}"><th>${L.fmtDate(d)}${gen ? ' <span class="badge plus" title="Recado do administrador">recado</span>' : ''}${bd ? ` <span class="badge bbq" title="Aniversário">🎂 ${bd}</span>` : ''}</th>${cells}</tr>`);
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
  const t = L.today();
  const [ovs0, pers, events, cnotes] = await Promise.all([api.listOverridesByPerson(person.id), api.listPeriodsByPerson(person.id),
    api.listEvents(t, L.addDays(t, S.daysAhead)), api.listNotesByPerson(person.id)]);
  const ovMap = L.overrideMap(L.mergeNotes(ovs0, cnotes));
  const days = [];
  for (let i = 0; i < S.daysAhead; i++) {
    const d = L.addDays(t, i);
    const meals = L.MEALS.map((m) => {
      const r = L.resolve(person, d, m, pers, ovMap, S.settings);
      const extra = [r.on && r.when !== 'N' ? `${L.WHEN_LABEL[r.when]}${r.timeShown ? ' ' + r.timeShown : ''}` : '',
        r.note ? `${r.note}${r.noteApproved ? '' : ' 🔒'}` : ''].filter(Boolean).join(' · ');
      const src0 = r.source === 'pontual' ? 'alterado' : r.source === 'temporária' ? `temporária${r.periodLabel ? ': ' + r.periodLabel : ''}` : 'padrão';
      const st = L.mealStatus(d, m, S.settings);
      const src = st === 'past' ? '🔒 passou' : st === 'late' ? `🔔 avisado · ${src0}` : src0;
      const bbq = events.some((e) => e.date === d && e.meal === m) ? ' 🔥 churrasco' : '';
      return `<button class="mealbtn ${r.on ? 'on' : 'off'} ${st}" data-d="${d}" data-m="${m}">
        <span><span class="st">${r.on ? '✓' : '✗'} ${L.MEAL_SHORT[m]}${bbq}</span>
          ${extra ? `<br><span class="extra">${esc(extra)}</span>` : ''}</span>
        <span class="src">${esc(src)}</span></button>`;
    }).join('');
    days.push(`<div class="card day ${d === t ? 'today' : ''}"><h3>${L.fmtDate(d, true)}</h3>${meals}</div>`);
  }
  main.innerHTML = `${targetSelector()}
    <p class="muted small">${isAdmin() ? esc(person.initials) + ': t' : 'T'}oque numa refeição para desmarcar, marcar,
      mudar o horário ou deixar uma observação. Mudanças até as ${S.settings.deadline.replace(':', 'h')} do dia em que a
      cozinha é avisada (na sexta, para todo o fim de semana).</p>
    ${days.join('')}
    <div class="center"><button id="b-more">Ver mais dias</button></div>`;
  bindTargetSelector();
  $('#b-more').addEventListener('click', () => { S.daysAhead += 14; route(); });
  $$('.mealbtn').forEach((b) => b.addEventListener('click', () => editMeal(person, b.dataset.d, b.dataset.m, pers, ovMap)));
}

function editMeal(person, date, meal, pers, ovMap) {
  const cur = L.resolve(person, date, meal, pers, ovMap, S.settings);
  const base = L.resolve(person, date, meal, pers, null, S.settings);
  const status = L.mealStatus(date, meal, S.settings);
  if (status === 'past' && !isAdmin()) {
    openDialog(`<div class="stack"><h3>${L.MEAL_LABEL[meal]} — ${L.fmtDate(date, true)}</h3>
      <p>🔒 Esta refeição já passou e não pode mais ser alterada.</p>
      <p class="muted small">Situação: ${esc(L.describeState(cur))}.</p>
      <div class="row spread"><span></span><button type="button" data-close>Fechar</button></div></div>`);
    return;
  }
  const warn = status === 'late'
    ? `<p class="alert small">⚠ Já passou o horário de avisar os comensais à cozinha (${L.fmtDeadline(date, meal, S.settings)}).
        Se mudar agora, a cozinha receberá um alerta desta mudança.</p>`
    : status === 'past' ? '<p class="muted small">Refeição já passou (correção pelo administrador).</p>' : '';
  // Depois de salvar: se a cozinha já foi avisada e algo mudou, manda o alerta
  const afterSave = async (newOv) => {
    if (status !== 'late') return false;
    const m2 = new Map(ovMap || []);
    const k = L.ovKey(person.id, date, meal);
    if (newOv) m2.set(k, newOv); else m2.delete(k);
    const s0 = L.describeState(cur), s1 = L.describeState(L.resolve(person, date, meal, pers, m2, S.settings));
    if (s0 === s1) return false;
    await sendAlert(person, [{ date, meal, text: `${L.MEAL_SHORT[meal]} ${L.fmtDate(date).toLowerCase()}: ${s0} → ${s1}` }]);
    return true;
  };
  const hint = { C: S.settings.early[meal], T: S.settings.late[meal] };
  const radio = (name, val, label, checked) =>
    `<label><input type="radio" name="${name}" value="${val}" ${checked ? 'checked' : ''}> ${label}</label>`;
  openDialog(`<form id="f-meal" class="stack">
      <h3>${isAdmin() ? esc(person.initials) + ' · ' : ''}${L.MEAL_LABEL[meal]} — ${L.fmtDate(date, true)}</h3>
      ${warn}
      <p class="muted small">Padrão: ${base.on ? 'faz' + (base.when !== 'N' ? ` (${L.WHEN_LABEL[base.when]} ${base.timeShown})` : '') : 'não faz'}${base.source === 'temporária' ? ' (regra temporária)' : ''}.</p>
      <div class="seg">${radio('on', '1', 'Vou', cur.on)}${radio('on', '0', 'Não vou', !cur.on)}</div>
      <fieldset id="whenbox"><legend>Horário</legend>
        <div class="seg">${['N', 'C', 'T', 'L'].map((w) => radio('when', w, { N: 'Normal', C: 'Mais cedo', T: 'Mais tarde', L: 'Para levar' }[w], cur.when === w)).join('')}</div>
        <label id="timebox" style="margin-top:8px">Horário <span id="timehint"></span>
          <input type="time" name="time" value="${esc(cur.time)}"></label>
      </fieldset>
      <label>Observação <input name="note" maxlength="140" value="${esc(cur.note)}" placeholder="ex.: jantar +leve"></label>
      ${isAdmin() ? `<label class="check"><input type="checkbox" name="share" ${cur.noteId ? (cur.noteApproved ? 'checked' : '') : 'checked'}> observação visível para a cozinha (sem o autor)</label>`
        : '<p class="muted small">🔒 A observação vai para o administrador; a cozinha só a vê se ele liberar, e sem o seu nome.</p>'}
      <div class="row small">${['+leve', 'lanche para levar', 'guardar um prato'].map((n) => `<button type="button" class="link" data-note="${n}">${n}</button>`).join('')}</div>
      <div class="row spread">
        ${cur.source === 'pontual' || cur.noteId ? '<button type="button" id="b-reset">Voltar ao padrão</button>' : '<span></span>'}
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
      await api.deleteOverride(person.id, date, meal);
      if (cur.noteId) await api.deleteNote(person.id, date, meal, cur.noteKitchenId);
      const alerted = await afterSave(null);
      dlg.close(); toast(alerted ? 'Voltou ao padrão — a cozinha foi alertada.' : 'Voltou ao padrão.'); route();
    }, e.target));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const on = f.on.value === '1';
      const when = on ? f.when.value || 'N' : 'N';
      const time = on && when !== 'N' ? f.time.value : '';
      const note = f.note.value.trim();
      const same = on === base.on && (!on || (when === base.when && time === base.time));
      const share = isAdmin() ? f.share.checked : false;
      guard(async () => {
        const ov = { personId: person.id, date, meal, status: on ? 'on' : 'off', when, time };
        if (same) { if (cur.source === 'pontual') await api.deleteOverride(person.id, date, meal); }
        else await api.setOverride(ov, S.user.uid);
        if (!note) { if (cur.noteId) await api.deleteNote(person.id, date, meal, cur.noteKitchenId); }
        else if (note !== cur.note || (isAdmin() && share !== cur.noteApproved)) {
          await api.saveNote({ personId: person.id, date, meal, text: note }, share, cur.noteKitchenId, S.user.uid);
        }
        const alerted = await afterSave(same ? null : ov);
        dlg.close(); toast(alerted ? 'Salvo — a cozinha foi alertada da mudança.' : 'Salvo.'); route();
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
    const items = await lateRuleCheck(person, () => ({ person: { ...person, defaultRule: g } }));
    if (!items) return;
    await api.updatePerson(person.id, { defaultRule: g });
    person.defaultRule = g;
    await sendAlert(person, items);
    toast(items.length ? 'Regra padrão salva — a cozinha foi alertada.' : 'Regra padrão salva.');
  }, e.target));
}

// ---------- Regras temporárias ----------
async function viewTemporarias() {
  const person = personById(S.targetPid);
  if (!person) return noPerson();
  const pers = (await api.listPeriodsByPerson(person.id)).sort((a, b) => b.from.localeCompare(a.from));
  const t = L.today();
  const isAbsent = (g) => L.MEALS.every((m) => [0, 1, 2, 3, 4, 5, 6].every((d) => !g?.[d]?.[m]));
  const when = (p) => p.repeat
    ? `${L.describeRepeat(p.repeat)} · desde ${L.fmtDate(p.from)}${p.to && p.to !== L.NO_END ? ` até ${L.fmtDate(p.to)}` : ''}`
    : L.describePeriod(p);
  const items = pers.map((p) => `<div class="list-item ${p.to < t ? 'inactive' : ''}">
      <div><strong>${esc(p.label || (p.repeat ? 'Repetição mensal' : isAbsent(p.grid) ? 'Ausência' : 'Regra temporária'))}</strong>
        ${p.repeat ? '<span class="badge plus">todo mês</span>' : ''}<br>
        <span class="small muted">${esc(when(p))} · ${isAbsent(p.grid) ? 'não faz refeições' : 'regra personalizada'}${p.to < t ? ' · encerrada' : ''}</span></div>
      <button class="danger" data-del="${p.id}">Excluir</button></div>`).join('');
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const offs = (sign) => [0, 1, 2, 3, 4, 5, 6].map((n) => [sign * n, n === 0 ? 'no próprio dia' : `${n} dia${n > 1 ? 's' : ''} ${sign < 0 ? 'antes' : 'depois'}`]);
  main.innerHTML = `${targetSelector()}
    <div class="card"><h2>Regras temporárias${isAdmin() ? ' — ' + esc(person.initials) : ''}</h2>
      ${items || '<p class="muted">Nenhuma.</p>'}</div>
    <form class="card stack" id="f-per">
      <h2>Nova regra temporária</h2>
      <label>Motivo <input name="label" placeholder="ex.: viagem" maxlength="60"></label>
      <div class="seg"><label><input type="radio" name="freq" value="once" checked> Um período</label>
        <label><input type="radio" name="freq" value="monthly"> Repetir todo mês</label></div>
      <fieldset id="repbox" hidden><legend>Repetição</legend>
        <div class="row">
          <label>No ${sel('nth', [[1, '1º'], [2, '2º'], [3, '3º'], [4, '4º'], [-1, 'último']], 1)}</label>
          <label>dia ${sel('dow', L.DOW_LONG.map((d, i) => [i, d.toLowerCase()]), 0)}</label>
          <label>de cada mês</label></div>
        <div class="row" style="margin-top:8px">
          <label>Começa ${sel('rstart', offs(-1), 0)}</label>
          <label>Termina ${sel('rend', offs(1), 0)}</label></div>
        <p class="muted small" id="repdesc"></p>
      </fieldset>
      <div class="row"><label><span id="lbl-from">De</span> <input type="date" name="from" value="${t}" required></label>
        <label><span id="lbl-to">Até (inclusive)</span> <input type="date" name="to" value="${t}"></label></div>
      <div class="row" id="mealbounds">
        <label><span id="lbl-fm"></span> ${sel('fromMeal', L.MEALS.map((m) => [m, L.MEAL_LABEL[m]]), 'cafe')}</label>
        <label><span id="lbl-tm"></span> ${sel('toMeal', L.MEALS.map((m) => [m, L.MEAL_LABEL[m]]), 'jantar')}</label></div>
      <div class="seg"><label><input type="radio" name="kind" value="aus" checked> Ausente (nenhuma refeição)</label>
        <label><input type="radio" name="kind" value="custom"> Regra personalizada</label></div>
      <div id="per-grid" hidden>${gridEditor(person.defaultRule)}</div>
      <p class="muted small">No período, esta regra substitui a regra padrão. Desmarcações pontuais continuam valendo por cima.</p>
      <div class="row"><button class="primary" type="submit">Criar</button></div>
    </form>`;
  bindTargetSelector();
  const f = $('#f-per'), gbox = $('#per-grid');
  bindGrid(gbox);
  const repeatOf = () => ({ nth: Number(f.nth.value), dow: Number(f.dow.value), start: Number(f.rstart.value), end: Number(f.rend.value) });
  const sync = () => {
    gbox.hidden = f.kind.value !== 'custom';
    const monthly = f.freq.value === 'monthly';
    $('#repbox').hidden = !monthly;
    $('#lbl-from').textContent = monthly ? 'Valendo a partir de' : 'De';
    $('#lbl-to').textContent = monthly ? 'Até (opcional)' : 'Até (inclusive)';
    $('#mealbounds').hidden = monthly;
    const aus = f.kind.value === 'aus';
    $('#lbl-fm').textContent = aus ? 'Primeira refeição que não faz (no 1º dia)' : 'Começa no 1º dia a partir do';
    $('#lbl-tm').textContent = aus ? 'Última refeição que não faz (no último dia)' : 'Termina no último dia depois do';
    if (monthly) $('#repdesc').textContent = 'Ex.: ' + L.describeRepeat(repeatOf()) + '.';
  };
  f.addEventListener('change', (e) => {
    if (e.target.name === 'freq') f.to.value = f.freq.value === 'monthly' ? '' : f.from.value;
    sync();
  });
  sync();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const monthly = f.freq.value === 'monthly';
    const to = monthly ? f.to.value || L.NO_END : f.to.value;
    if (!to) return toast('Informe a data final.');
    if (to < f.from.value) return toast('A data final é anterior à inicial.');
    if (!monthly && to === f.from.value && L.MEALS.indexOf(f.fromMeal.value) > L.MEALS.indexOf(f.toMeal.value)) {
      return toast('No mesmo dia, a primeira refeição não pode vir depois da última.');
    }
    guard(async () => {
      const np = {
        personId: person.id, from: f.from.value, to, label: f.label.value.trim(),
        grid: f.kind.value === 'custom' ? readGrid(gbox) : L.emptyGrid(),
        ...(monthly ? { repeat: repeatOf() } : { fromMeal: f.fromMeal.value, toMeal: f.toMeal.value }),
      };
      const items = await lateRuleCheck(person, (a) => ({ periods: [...a.periods, { ...np, createdAt: Date.now() }] }));
      if (!items) return;
      await api.addPeriod(np);
      await sendAlert(person, items);
      toast('Regra temporária criada.'); route();
    }, f.querySelector('[type=submit]'));
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Excluir esta regra temporária?')) return;
    guard(async () => {
      const items = await lateRuleCheck(person, (a) => ({ periods: a.periods.filter((x) => x.id !== b.dataset.del) }));
      if (!items) return;
      await api.deletePeriod(b.dataset.del);
      await sendAlert(person, items);
      route();
    }, b);
  }));
}

// ---------- Pessoas (admin) ----------
async function viewPessoas() {
  await loadPeople();
  const tabs = `<div class="row tabs">${[['cadastro', 'Cadastro'], ['geral', 'Visão geral das regras']].map(([k, l]) =>
    `<button data-tab="${k}" class="${(S.pessoasTab || 'cadastro') === k ? 'primary' : ''}">${l}</button>`).join('')}</div>`;
  const bindTabs = () => $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { S.pessoasTab = b.dataset.tab; route(); }));
  if (S.pessoasTab === 'geral') { main.innerHTML = tabs + await overviewHtml(); bindTabs(); bindOverview(); return; }
  S.users = await api.listUsers();
  const userOf = (uid) => S.users.find((u) => u.id === uid);
  const rows = S.people.map((p) => {
    const u = p.uid && userOf(p.uid);
    const acc = u ? `${esc(u.email || S.names[p.id]?.email || '')} · ${u.role}` : (p.guest ? 'convidado' : 'sem conta');
    return `<div class="list-item ${p.active === false ? 'inactive' : ''}">
      <div><strong>${esc(p.initials)}</strong> ${p.diet ? '<span class="badge">regime</span>' : ''} ${esc(fullName(p.id))}${p.birthday ? ` <span class="small muted">🎂 ${L.fmtBday(p.birthday)}</span>` : ''}
        ${p.diet && p.dietText ? `<br><span class="small" style="color:var(--diet)">${esc(p.dietText)}</span>` : ''}
        <br><span class="small muted">${acc}${p.active === false ? ' · inativo' : ''}${p.uid === S.user.uid ? ' · você' : ''}</span></div>
      <button data-edit="${p.id}">Editar</button></div>`;
  }).join('');
  const kitchens = S.users.filter((u) => isKitchenRole(u.role)).map((u) => `<div class="list-item">
      <span>${esc(u.email)}<br><span class="small muted">${ROLE_NAME[u.role]}</span></span>
      <button class="danger" data-rmk="${u.id}">Remover acesso</button></div>`).join('');
  main.innerHTML = `${tabs}
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
  bindTabs();
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

// Visão geral (administrador): regra padrão de todos + temporárias em vigor
async function overviewHtml() {
  const t = L.today();
  const pers = await api.listPeriodsFrom(t);
  const people = S.people.filter((p) => p.active !== false);
  const SYM = { N: '✓', C: '+c', T: '+t', L: 'lv' };
  const cell = (code) => {
    const c = L.parseCell(code);
    return c.on ? `<td class="on" title="${esc(L.WHEN_LABEL[c.when])}${c.time ? ' ' + c.time : ''}">${SYM[c.when]}${c.time ? `<sup>${c.time.replace(':00', 'h')}</sup>` : ''}</td>` : '<td></td>';
  };
  const slots = GRID_ORDER.flatMap((d) => L.MEALS.map((m) => [d, m]));
  const totals = slots.map(([d, m]) => people.filter((p) => L.parseCell(p.defaultRule?.[d]?.[m]).on).length);
  const rows = people.map((p) => {
    const temp = pers.filter((x) => x.personId === p.id).sort((a, b) => a.from.localeCompare(b.from))
      .map((x) => `<div>${esc(x.label || (x.repeat ? 'Todo mês' : 'Ausência'))}: ${esc(L.describePeriod(x))}</div>`).join('');
    return `<tr data-pid="${p.id}" class="clickable"><th class="sticky" title="${esc(fullName(p.id))}">${esc(p.initials)}${p.diet ? ' <span class="badge">R</span>' : ''}${p.guest ? ' <span class="badge plus">conv.</span>' : ''}</th>
      ${slots.map(([d, m]) => cell(p.defaultRule?.[d]?.[m])).join('')}<td class="temp">${temp}</td></tr>`;
  }).join('');
  return `<div class="card"><h2>Visão geral das regras</h2>
    <p class="muted small">Regra padrão semanal de cada comensal ativo e as regras temporárias em vigor ou futuras.
      Toque numa linha para editar. ✓ normal · +c mais cedo · +t mais tarde · lv para levar · <span class="badge">R</span> regime.</p>
    <div class="tablewrap"><table class="overview">
      <thead><tr><th class="sticky" rowspan="2"></th>${GRID_ORDER.map((d) => `<th colspan="3" class="dayh">${L.DOW[d]}</th>`).join('')}<th rowspan="2">Temporárias</th></tr>
        <tr>${GRID_ORDER.map(() => L.MEALS.map((m, i) => `<th class="${i === 0 ? 'dayh' : ''}">${'CAJ'[i]}</th>`).join('')).join('')}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th class="sticky">Total</th>${totals.map((n) => `<td>${n}</td>`).join('')}<td class="muted small">pela regra padrão</td></tr></tfoot>
    </table></div></div>`;
}
function bindOverview() {
  $$('.overview tr[data-pid]').forEach((tr) => tr.addEventListener('click', () => { S.targetPid = tr.dataset.pid; location.hash = '#/padrao'; }));
}

// Aniversário: dia e mês ('MM-DD'), sem ano
function bdaySelects(b = '') {
  const [mm, dd] = b ? b.split('-') : ['', ''];
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `<span class="row" style="display:inline-flex">
    <select name="bdd" aria-label="Dia"><option value="">dia</option>${Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
      .map((v) => `<option ${v === dd ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select name="bdm" aria-label="Mês"><option value="">mês</option>${MESES.map((n, i) => {
      const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${v === mm ? 'selected' : ''}>${n}</option>`; }).join('')}</select></span>`;
}
const readBday = (f) => (f.bdd.value && f.bdm.value ? `${f.bdm.value}-${f.bdd.value}` : '');

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
      <label id="dietbox">Regime (a cozinha vê) <textarea name="dietText" rows="2" maxlength="300" placeholder="ex.: sem sal; sem açúcar; pouca gordura">${esc(p?.dietText)}</textarea></label>
      <div><span class="small muted">Aniversário (a cozinha vê)</span> ${bdaySelects(p?.birthday)}</div>
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
    const sync = () => { const b = $('#accbox', root); if (b) b.hidden = f.acc?.value !== 'new'; $('#dietbox', root).hidden = !f.diet.checked; };
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
        const person = { initials, diet: f.diet.checked, guest: f.guest.checked, dietText: f.diet.checked ? f.dietText.value.trim() : '', birthday: readBday(f) };
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
      <h2>Prazo para mudanças</h2>
      <label>Horário-limite no dia do aviso à cozinha <input type="time" name="deadline" value="${esc(s.deadline)}" required></label>
      <p class="muted small">Avisos: almoço e jantar no próprio dia, café na véspera; na sexta, todo o fim de semana até o café de segunda.
        Depois do limite, quem mudar vê um alerta e a cozinha é avisada da mudança. Refeições já passadas ficam bloqueadas.</p>
      <div class="row"><button class="primary" type="submit">Salvar</button></div></form>
    ${DEMO ? '<div class="card"><h2>Demonstração</h2><button class="danger" id="b-demo-reset">Restaurar dados de exemplo</button></div>' : ''}`;
  const f = $('#f-cfg');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const ns = { early: {}, late: {}, deadline: f.deadline.value || '08:15' };
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
    ${isAdmin() && 'Notification' in window ? `<div class="card stack"><h2>Chamados da cozinha</h2>
      <p class="muted small">Com o app aberto (mesmo em outra aba), você recebe uma notificação do navegador quando a cozinha chamar.
        Situação: <b>${{ granted: 'ativadas', denied: 'bloqueadas no navegador', default: 'desativadas' }[Notification.permission]}</b>.</p>
      ${Notification.permission === 'default' ? '<div class="row"><button id="b-notif">Ativar notificações</button></div>' : ''}</div>` : ''}
    ${S.myPid ? `<form class="card stack" id="f-bday"><h2>Aniversário</h2>
      <p class="muted small">Só dia e mês. Fica visível para a cozinha.</p>
      <div>${bdaySelects(personById(S.myPid)?.birthday)}</div>
      <div class="row"><button class="primary" type="submit">Salvar aniversário</button></div></form>` : ''}
    ${DEMO ? '' : `<form class="card stack" id="f-pw"><h2>Trocar senha</h2>
      <label>Senha atual <input type="password" name="old" autocomplete="current-password" required></label>
      <label>Nova senha <input type="password" name="pw1" minlength="6" autocomplete="new-password" required></label>
      <label>Repita a nova senha <input type="password" name="pw2" minlength="6" autocomplete="new-password" required></label>
      <div class="row"><button class="primary" type="submit">Trocar senha</button></div></form>`}`;
  $('#b-logout').addEventListener('click', () => { S.role = null; location.hash = ''; api.signOut(); });
  $('#b-notif')?.addEventListener('click', async () => { await Notification.requestPermission(); route(); });
  const fb = $('#f-bday');
  fb?.addEventListener('submit', (e) => {
    e.preventDefault();
    const b = readBday(fb);
    if ((fb.bdd.value && !fb.bdm.value) || (!fb.bdd.value && fb.bdm.value)) return toast('Escolha o dia e o mês.');
    guard(async () => { await api.updatePerson(S.myPid, { birthday: b }); personById(S.myPid).birthday = b; toast('Aniversário salvo.'); }, fb.querySelector('button'));
  });
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
  const [ovs, pers, notes, daily, events] = await Promise.all([api.listOverridesRange(from, to), api.listPeriodsFrom(from),
    api.listDayNotes(from, to), api.listDaily(from, to), api.listEvents(from, to)]);
  const snap = Object.fromEntries(daily.map((x) => [x.date, x.meals]));
  const days = [];
  for (let d = from; d <= to; d = L.addDays(d, 1)) {
    if (d < t && snap[d]) { days.push({ date: d, meals: snap[d], saved: true }); continue; }
    const sum = L.applyEvents(L.applyDayNotes(L.summarize(S.people, d, pers, ovs, S.settings), notes.filter((n) => n.date === d)),
      events.filter((e) => e.date === d));
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
