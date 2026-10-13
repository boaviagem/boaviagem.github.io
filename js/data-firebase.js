// Camada de dados — Firebase (Auth + Firestore).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, writeBatch,
  orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export function createFirebaseApi(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let secondaryAuth = null; // usado para o admin criar contas sem sair da própria sessão

  const d = (...p) => doc(db, ...p);
  const col = (n) => collection(db, n);
  const rows = (snap) => snap.docs.map((x) => ({ id: x.id, ...x.data() }));
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
    bootstrapExists: async () => !!(await one(d('settings', 'bootstrap'))),
    async bootstrapAdmin(uid, email) {
      const b = writeBatch(db);
      b.set(d('users', uid), { role: 'admin', personId: null, email });
      b.set(d('settings', 'bootstrap'), { by: uid, at: Date.now() });
      await b.commit();
    },

    getSettings: () => one(d('settings', 'app')),
    saveSettings: (s) => setDoc(d('settings', 'app'), s),

    listPeople: async () => rows(await getDocs(col('people'))),
    getPerson: (pid) => one(d('people', pid)),
    updatePerson: (pid, data) => updateDoc(d('people', pid), { ...data, updatedAt: Date.now() }),
    listNames: async () => Object.fromEntries(rows(await getDocs(col('names'))).map((n) => [n.id, n])),
    getName: (pid) => one(d('names', pid)),
    listUsers: async () => rows(await getDocs(col('users'))),

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
      if (uid && !account.linkSelfUid) b.set(d('users', uid), { role: account.role || 'comensal', personId: pid, email: account.email, mustChange });
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
      b.set(d('users', uid), { role, personId: pid, email, mustChange });
      b.update(d('people', pid), { uid });
      b.set(d('names', pid), { email }, { merge: true });
      await b.commit();
    },
    async createKitchen(email, password, role = 'cozinha') {
      const { uid, mustChange } = await newAuthUser(email, password);
      await setDoc(d('users', uid), { role, personId: null, email, mustChange });
    },
    listAuxiliaries: async () => rows(await getDocs(query(col('users'), where('role', '==', 'auxiliar')))),
    removeUserProfile: (uid) => deleteDoc(d('users', uid)),
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
    setOverride: (o, uid) => setDoc(d('overrides', `${o.personId}_${o.date}_${o.meal}`), { ...o, updatedAt: Date.now(), updatedBy: uid }),
    deleteOverride: (pid, date, meal) => deleteDoc(d('overrides', `${pid}_${date}_${meal}`)),

    listPeriodsFrom: async (from) => rows(await getDocs(query(col('periods'), where('to', '>=', from)))),
    listPeriodsByPerson: async (pid) => rows(await getDocs(query(col('periods'), where('personId', '==', pid)))),
    addPeriod: (p) => addDoc(col('periods'), { ...p, createdAt: Date.now() }),
    deletePeriod: (id) => deleteDoc(d('periods', id)),

    listDayNotes: async (from, to) =>
      rows(await getDocs(query(col('dayNotes'), where('date', '>=', from), where('date', '<=', to)))),
    addDayNote: (n, uid) => addDoc(col('dayNotes'), { ...n, by: uid, createdAt: Date.now() }),
    deleteDayNote: (id) => deleteDoc(d('dayNotes', id)),

    listMessages: async () => rows(await getDocs(query(col('messages'), orderBy('createdAt', 'desc'), limit(200)))),
    sendMessage: (dir, text, uid, email) => addDoc(col('messages'), { dir, text, from: uid, fromEmail: email, createdAt: Date.now(), readAt: null }),
    markRead: (id) => updateDoc(d('messages', id), { readAt: Date.now() }),
    deleteMessage: (id) => deleteDoc(d('messages', id)),

    listDaily: async (from, to) =>
      rows(await getDocs(query(col('daily'), where('date', '>=', from), where('date', '<=', to)))),
    saveDaily: (date, meals) => setDoc(d('daily', date), { date, meals, at: Date.now() }),
  };
}
