// Camada de dados — Firebase (Auth + Firestore).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, writeBatch,
  orderBy, limit, onSnapshot, getCountFromServer,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export function createFirebaseApi(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let secondaryAuth = null; // usado para o admin criar contas sem sair da própria sessão

  // Dados de cada casa ficam em houses/{casa}/...; users, houses e settings/bootstrap são comuns.
  let H = null;
  const GLOBAL = new Set(['users', 'houses']);
  const d = (n, ...rest) => (GLOBAL.has(n) || (n === 'settings' && rest[0] === 'bootstrap')
    ? doc(db, n, ...rest) : doc(db, 'houses', H, n, ...rest));
  const col = (n) => (GLOBAL.has(n) ? collection(db, n) : collection(db, 'houses', H, n));
  const count = async (q) => (await getCountFromServer(q)).data().count;
  const DAY = 864e5;
  const rows = (snap) => snap.docs.map((x) => ({ id: x.id, ...x.data() }));
  // Coleções novas: se as regras publicadas ainda não as conhecem, não derruba a tela
  const soft = async (fn) => { try { return await fn(); } catch (e) { console.warn('sem acesso (regras desatualizadas?)', e.code); return []; } };
  const one = async (ref) => { const s = await getDoc(ref); return s.exists() ? { id: s.id, ...s.data() } : null; };

  // Cria o login sem derrubar a sessão atual. Sem senha: gera uma aleatória e manda
  // à pessoa um e-mail para ela definir a própria senha.
  async function newAuthUser(email, password) {
    if (!secondaryAuth) secondaryAuth = getAuth(initializeApp(config, 'secundario'));
    const sendLink = !password;
    if (sendLink) password = crypto.getRandomValues(new Uint32Array(4)).join('-') + 'Aa!';
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await signOut(secondaryAuth);
    if (sendLink) await sendPasswordResetEmail(auth, email);
    return { uid: cred.user.uid, mustChange: !sendLink };
  }

  return {
    demo: false,
    onAuth: (cb) => onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null)),
    signIn: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
    signOut: () => signOut(auth),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    setNewPassword: (pw) => updatePassword(auth.currentUser, pw),
    async changePassword(oldPw, newPw) {
      const u = auth.currentUser;
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldPw));
      await updatePassword(u, newPw);
    },

    getProfile: (uid) => one(d('users', uid)),
    setHouse: (h) => { H = h; },
    getHouse: (h) => one(d('houses', h || H)),
    bootstrapExists: async () => !!(await one(d('settings', 'bootstrap'))),
    // Instalação nova: o primeiro usuário vira gestor geral e CL da casa "principal"
    async bootstrapAdmin(uid, email) {
      const b = writeBatch(db);
      b.set(d('users', uid), { role: 'admin', personId: null, email, houseId: 'principal', gestor: true });
      b.set(d('houses', 'principal'), { name: 'Casa principal', createdAt: Date.now() });
      b.set(d('settings', 'bootstrap'), { by: uid, at: Date.now() });
      await b.commit();
    },

    // ---------- Gestor geral: casas e CLs ----------
    listHouses: async () => rows(await getDocs(collection(db, 'houses'))),
    createHouse: (id, name) => setDoc(d('houses', id), { name, createdAt: Date.now() }),
    renameHouse: (id, name) => updateDoc(d('houses', id), { name }),
    listHouseAdmins: async (h) => rows(await getDocs(query(col('users'), where('houseId', '==', h), where('role', '==', 'admin')))),
    async createHouseAdmin(h, email, password) {
      const { uid, mustChange } = await newAuthUser(email, password);
      await setDoc(d('users', uid), { role: 'admin', houseId: h, personId: null, email, mustChange });
    },
    // Uma vez: copia os dados do formato antigo (coleções na raiz) para a casa h e põe houseId nas contas
    async migrateLegacyInto(h, onStep = () => {}) {
      const LEGACY = ['people', 'names', 'overrides', 'periods', 'notes', 'kitchenNotes', 'dayNotes', 'messages', 'events', 'alerts', 'calls', 'daily'];
      const out = {};
      for (const c of LEGACY) {
        const snap = await getDocs(collection(db, c));
        out[c] = snap.size;
        onStep(`${c}: ${snap.size}`);
        for (let i = 0; i < snap.docs.length; i += 400) {
          const b = writeBatch(db);
          snap.docs.slice(i, i + 400).forEach((x) => b.set(doc(db, 'houses', h, c, x.id), x.data()));
          await b.commit();
        }
      }
      const app = await getDoc(doc(db, 'settings', 'app'));
      if (app.exists()) await setDoc(doc(db, 'houses', h, 'settings', 'app'), app.data());
      const users = await getDocs(collection(db, 'users'));
      let nu = 0;
      for (const x of users.docs) {
        const u = x.data();
        if (u.houseId) continue;
        await updateDoc(x.ref, { houseId: h, role: u.role === 'cl' ? 'admin' : u.role }); nu++;
      }
      out.users = nu;
      await setDoc(d('houses', h), { migratedAt: Date.now() }, { merge: true });
      return out;
    },
    // CL: apaga registros velhos para manter o app leve (os totais diários ficam nas estatísticas)
    async cleanupOld(keepDays = 45) {
      const cut = new Date(Date.now() - keepDays * DAY).toISOString().slice(0, 10), cutMs = Date.now() - keepDays * DAY;
      const qs = [
        query(col('overrides'), where('date', '<', cut)), query(col('notes'), where('date', '<', cut)),
        query(col('kitchenNotes'), where('date', '<', cut)), query(col('dayNotes'), where('date', '<', cut)),
        query(col('events'), where('date', '<', cut)), query(col('alerts'), where('createdAt', '<', cutMs)),
        query(col('calls'), where('createdAt', '<', cutMs)),
      ];
      let n = 0;
      for (const q of qs) {
        const snap = await getDocs(q);
        for (let i = 0; i < snap.docs.length; i += 400) {
          const b = writeBatch(db);
          snap.docs.slice(i, i + 400).forEach((x) => b.delete(x.ref));
          await b.commit();
        }
        n += snap.size;
      }
      // viagens únicas já terminadas
      const per = await getDocs(query(col('periods'), where('to', '<', cut)));
      for (const x of per.docs) if (!x.data().repeat) { await deleteDoc(x.ref); n++; }
      return n;
    },

    getSettings: () => one(d('settings', 'app')),
    saveSettings: (s) => setDoc(d('settings', 'app'), s),

    listPeople: async () => rows(await getDocs(col('people'))),
    getPerson: (pid) => one(d('people', pid)),
    updatePerson: (pid, data) => updateDoc(d('people', pid), { ...data, updatedAt: Date.now() }),
    listNames: async () => Object.fromEntries(rows(await getDocs(col('names'))).map((n) => [n.id, n])),
    getName: (pid) => one(d('names', pid)),
    listUsers: async () => rows(await getDocs(query(col('users'), where('houseId', '==', H)))),

    clearMustChange: (uid) => updateDoc(d('users', uid), { mustChange: false }),

    // account: null | { email, password?, role } (sem password = e-mail para definir senha) | { linkSelfUid, email }
    async createPerson(person, name, account) {
      let uid = null, mustChange = false;
      if (account?.email && !account.linkSelfUid) ({ uid, mustChange } = await newAuthUser(account.email, account.password));
      else if (account?.linkSelfUid) uid = account.linkSelfUid;
      const pid = doc(col('people')).id;
      const b = writeBatch(db);
      b.set(d('people', pid), { ...person, uid, active: true, createdAt: Date.now() });
      b.set(d('names', pid), { fullName: name.fullName || '', email: account?.email || name.email || '' });
      if (uid && !account.linkSelfUid) b.set(d('users', uid), { role: account.role || 'comensal', personId: pid, email: account.email, mustChange, houseId: H });
      if (account?.linkSelfUid) b.set(d('users', uid), { personId: pid }, { merge: true });
      await b.commit();
      return pid;
    },
    async updatePersonFull(pid, person, name, role, uid) {
      const b = writeBatch(db);
      b.update(d('people', pid), { ...person, updatedAt: Date.now() });
      b.set(d('names', pid), name, { merge: true });
      if (uid && role) b.set(d('users', uid), { role }, { merge: true });
      await b.commit();
    },
    // Atualiza um comensal existente pela importação (sem mexer em login)
    async importUpdate(pid, person, name) {
      const b = writeBatch(db);
      b.update(d('people', pid), { ...person, updatedAt: Date.now() });
      b.set(d('names', pid), name, { merge: true });
      await b.commit();
    },
    async createAccountFor(pid, email, password, role) {
      const { uid, mustChange } = await newAuthUser(email, password);
      const b = writeBatch(db);
      b.set(d('users', uid), { role, personId: pid, email, mustChange, houseId: H });
      b.update(d('people', pid), { uid });
      b.set(d('names', pid), { email }, { merge: true });
      await b.commit();
    },
    async createKitchen(email, password, role = 'cozinha') {
      const { uid, mustChange } = await newAuthUser(email, password);
      await setDoc(d('users', uid), { role, personId: null, email, mustChange, houseId: H });
    },
    listAuxiliaries: async () => rows(await getDocs(query(col('users'), where('houseId', '==', H), where('role', '==', 'auxiliar')))),
    removeUserProfile: (uid) => deleteDoc(d('users', uid)),
    setUserRole: (uid, role) => updateDoc(d('users', uid), { role }),
    // Apaga o comensal e tudo dele (regras, alterações, acesso). O login em si só sai pelo console do Firebase.
    async deletePerson(pid, uid) {
      const [ovs, pers] = await Promise.all([
        getDocs(query(col('overrides'), where('personId', '==', pid))),
        getDocs(query(col('periods'), where('personId', '==', pid)))]);
      const refs = [...ovs.docs, ...pers.docs].map((x) => x.ref);
      refs.push(d('people', pid), d('names', pid));
      if (uid) refs.push(d('users', uid));
      for (let i = 0; i < refs.length; i += 400) {
        const b = writeBatch(db);
        refs.slice(i, i + 400).forEach((r) => b.delete(r));
        await b.commit();
      }
    },

    listOverridesRange: async (from, to) =>
      rows(await getDocs(query(col('overrides'), where('date', '>=', from), where('date', '<=', to)))),
    listOverridesByPerson: async (pid) => rows(await getDocs(query(col('overrides'), where('personId', '==', pid)))),
    setOverride: (o, uid) => setDoc(d('overrides', `${o.personId}_${o.date}_${o.meal}`), { ...o, note: '', updatedAt: Date.now(), updatedBy: uid }),

    // Observações: `notes` (com autor) só para administrador e autor; ao liberar, uma cópia ANÔNIMA vai para
    // `kitchenNotes` (data, refeição e texto), que é o que a cozinha lê.
    listNotes: (from, to) => soft(async () =>
      rows(await getDocs(query(col('notes'), where('date', '>=', from), where('date', '<=', to))))),
    listKitchenNotes: (from, to) => soft(async () =>
      rows(await getDocs(query(col('kitchenNotes'), where('date', '>=', from), where('date', '<=', to))))),
    listNotesByPerson: (pid) => soft(async () => rows(await getDocs(query(col('notes'), where('personId', '==', pid))))),
    // share = visível para a cozinha (só o administrador libera); prevKitchenId = cópia anterior, se houver
    async saveNote({ personId, date, meal, text }, share, prevKitchenId, uid) {
      const b = writeBatch(db);
      let kitchenId = null;
      if (share) {
        const kref = prevKitchenId ? d('kitchenNotes', prevKitchenId) : doc(col('kitchenNotes'));
        kitchenId = kref.id;
        b.set(kref, { date, meal, text, updatedAt: Date.now() });
      } else if (prevKitchenId) b.delete(d('kitchenNotes', prevKitchenId));
      b.set(d('notes', `${personId}_${date}_${meal}`), { personId, date, meal, text, approved: !!share, kitchenId, updatedAt: Date.now(), updatedBy: uid });
      await b.commit();
    },
    async deleteNote(pid, date, meal, kitchenId) {
      const b = writeBatch(db);
      b.delete(d('notes', `${pid}_${date}_${meal}`));
      if (kitchenId) b.delete(d('kitchenNotes', kitchenId));
      await b.commit();
    },
    // Uma vez: tira as observações antigas de dentro das alterações (que a cozinha lê) e as guarda ocultas
    async migrateNotes() {
      const snap = await getDocs(query(col('overrides'), where('note', '>', '')));
      for (const x of snap.docs) {
        const o = x.data();
        const b = writeBatch(db);
        b.set(d('notes', `${o.personId}_${o.date}_${o.meal}`), { personId: o.personId, date: o.date, meal: o.meal, text: o.note, approved: false, updatedAt: Date.now() });
        b.update(x.ref, { note: '' });
        await b.commit();
      }
      // observações já liberadas no formato anterior: cria a cópia anônima da cozinha
      const appr = await getDocs(query(col('notes'), where('approved', '==', true)));
      let n = snap.size;
      for (const x of appr.docs) {
        const o = x.data();
        if (o.kitchenId) continue;
        const kref = doc(col('kitchenNotes'));
        const b = writeBatch(db);
        b.set(kref, { date: o.date, meal: o.meal, text: o.text, updatedAt: Date.now() });
        b.update(x.ref, { kitchenId: kref.id });
        await b.commit(); n++;
      }
      return n;
    },
    deleteOverride: (pid, date, meal) => deleteDoc(d('overrides', `${pid}_${date}_${meal}`)),

    listPeriodsFrom: async (from) => rows(await getDocs(query(col('periods'), where('to', '>=', from)))),
    listPeriodsByPerson: async (pid) => rows(await getDocs(query(col('periods'), where('personId', '==', pid)))),
    addPeriod: (p) => addDoc(col('periods'), { ...p, createdAt: Date.now() }),
    updatePeriod: (id, data) => updateDoc(d('periods', id), data),
    deletePeriod: (id) => deleteDoc(d('periods', id)),

    listDayNotes: async (from, to) =>
      rows(await getDocs(query(col('dayNotes'), where('date', '>=', from), where('date', '<=', to)))),
    addDayNote: (n, uid) => addDoc(col('dayNotes'), { ...n, by: uid, createdAt: Date.now() }),
    deleteDayNote: (id) => deleteDoc(d('dayNotes', id)),

    listMessages: async () => rows(await getDocs(query(col('messages'), orderBy('createdAt', 'desc'), limit(60)))),
    countUnread: (dir) => count(query(col('messages'), where('dir', '==', dir), where('readAt', '==', null))),
    // extra: { replyTo (id da mensagem respondida), fromRole }
    sendMessage: (dir, text, uid, email, extra = {}) => addDoc(col('messages'), { dir, text, from: uid, fromEmail: email, ...extra, createdAt: Date.now(), readAt: null }),
    markRead: (id) => updateDoc(d('messages', id), { readAt: Date.now() }),
    deleteMessage: (id) => deleteDoc(d('messages', id)),

    // Churrasco e outros eventos que substituem a contagem de uma refeição
    listEvents: (from, to) => soft(async () =>
      rows(await getDocs(query(col('events'), where('date', '>=', from), where('date', '<=', to))))),
    setEvent: (e, uid) => setDoc(d('events', `${e.date}_${e.meal}`), { ...e, by: uid, updatedAt: Date.now() }),
    deleteEvent: (date, meal) => deleteDoc(d('events', `${date}_${meal}`)),

    // Alertas para a cozinha (mudanças depois do horário de aviso)
    addAlert: (a, uid) => addDoc(col('alerts'), { ...a, by: uid, createdAt: Date.now(), ackAt: null, ackBy: null }),
    // pendentes + os dos últimos 2 dias
    listAlerts: () => soft(async () => {
      const [a, b] = await Promise.all([getDocs(query(col('alerts'), where('ackAt', '==', null))),
        getDocs(query(col('alerts'), where('createdAt', '>=', Date.now() - 2 * DAY)))]);
      const m = new Map([...rows(a), ...rows(b)].map((x) => [x.id, x]));
      return [...m.values()].sort((x, y) => y.createdAt - x.createdAt);
    }),
    countOpenAlerts: () => count(query(col('alerts'), where('ackAt', '==', null))),
    ackAlert: (id, uid) => updateDoc(d('alerts', id), { ackAt: Date.now(), ackBy: uid }),
    deleteAlert: (id) => deleteDoc(d('alerts', id)),

    // Chamados da cozinha para o administrador
    addCall: (c, uid) => addDoc(col('calls'), { ...c, by: uid, createdAt: Date.now(), seenAt: null, seenBy: null }),
    listCalls: () => soft(async () => rows(await getDocs(query(col('calls'), where('createdAt', '>=', Date.now() - DAY))))
      .sort((x, y) => y.createdAt - x.createdAt)),
    markCallSeen: (id, uid) => updateDoc(d('calls', id), { seenAt: Date.now(), seenBy: uid }),
    // Em tempo real: chamados ainda não vistos (devolve a função para parar de ouvir)
    watchOpenCalls: (cb) => onSnapshot(query(col('calls'), where('seenAt', '==', null)),
      (snap) => cb(rows(snap)), (e) => console.warn('watchOpenCalls', e.code)),

    listDaily: async (from, to) =>
      rows(await getDocs(query(col('daily'), where('date', '>=', from), where('date', '<=', to)))),
    saveDaily: (date, meals) => setDoc(d('daily', date), { date, meals, at: Date.now() }),
  };
}
