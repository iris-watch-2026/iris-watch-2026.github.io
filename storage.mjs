/* One IndexedDB read-modify-write transaction per change, shared by every window. */
import { KEY, RSS_SOURCE_KEY, V051_KEY, V05_KEY, LEGACY_KEYS, loadData, validateData, encodeBackup } from './core.mjs';
import { readV05Snapshot, readV05Raw } from './migration.mjs';
export const DB_NAME = KEY;
const STORE = 'state', MAIN = 'main';
const fail = message => { throw new Error(message); };
const copy = value => JSON.parse(JSON.stringify(value));
function clean(data) { return JSON.parse(encodeBackup(data)); }
function record(value) {
  if (!value || value.schema !== 1 || value.data?.version !== 5 || !Number.isSafeInteger(value.revision) || value.revision < 1) fail('V0.51 UI保存記録が破損しています。生データを保存してからバックアップで復元してください。');
  return { schema: 1, revision: value.revision, data: clean(value.data) };
}
export function createStore(options = {}) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const dbName = options.dbName ?? DB_NAME;
  let dbPromise, activeDb;
  function legacyStorage() { return Object.prototype.hasOwnProperty.call(options, 'localStorage') ? options.localStorage : globalThis.localStorage; }
  function open() {
    if (!factory?.open) return Promise.reject(new Error('端末内保存（IndexedDB）を利用できません。通常モードの対応ブラウザで開いてください。'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let request, settled = false;
      const rejectOpen = error => { settled = true; reject(error); };
      try { request = factory.open(dbName, 1); } catch (error) { reject(error); return; }
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
      request.onerror = () => rejectOpen(request.error ?? new Error('端末内保存を開けません。'));
      request.onblocked = () => rejectOpen(new Error('別の画面で保存領域を使用中です。X巡回アシスタントの画面を閉じてから再度開いてください。'));
      request.onsuccess = () => {
        const opened = request.result;
        if (settled) { opened.close(); return; }
        settled = true; activeDb = opened;
        opened.onversionchange = () => { opened.close(); if (activeDb === opened) { dbPromise = undefined; activeDb = undefined; } };
        resolve(opened);
      };
    }).catch(error => { dbPromise = undefined; throw error; });
    return dbPromise;
  }
  async function seedForEmpty(db) {
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'), request = tx.objectStore(STORE).get(MAIN);
      let value;
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error('保存領域を読み取れません。'));
    });
    if (existing !== undefined) return null;
    const rssSource = await new Promise(resolve=>{
  let request;
  try { request=factory.open(RSS_SOURCE_KEY); }catch { resolve(null); return; }
  request.onupgradeneeded=()=>{try{request.transaction.abort()}catch{}};
  request.onerror=()=>resolve(null);
  request.onsuccess=()=>{
    const db=request.result;if(!db.objectStoreNames.contains('state')){db.close();resolve(null);return}
    const tx=db.transaction('state','readonly'),q=tx.objectStore('state').get('main');
    q.onsuccess=()=>{const x=q.result;db.close();resolve(x?.data?.version===5?{data:x.data,source:'rss051'}:null)};
    q.onerror=()=>{db.close();resolve(null)};
  };
});
    if(rssSource)return rssSource;
    const priorUi = await readV05Snapshot(factory, V051_KEY);
    if (priorUi) return { ...priorUi, source: 'v051-ui-idb' };
    const snapshot = await readV05Snapshot(factory);
    if (snapshot) return snapshot;
    const storage = legacyStorage();
    if (!storage?.getItem) fail('旧版データの保存領域を読み取れません。ブラウザの保存設定を確認してください。');
    const loaded = loadData(storage);
    return { data: clean(loaded.data), source: loaded.source };
  }
  async function transaction(mutator, replace = false) {
    const db = await open();
    // Source reads happen before opening the write transaction. Every window
    // then rechecks main atomically, so only the first seeds and later edits
    // apply to the latest V0.51 UI record rather than an old migration snapshot.
    const seed = replace ? null : await seedForEmpty(db);
    return new Promise((resolve, reject) => {
      let tx, error, answer;
      try { tx = db.transaction(STORE, 'readwrite'); } catch (cause) { reject(cause); return; }
      const store = tx.objectStore(STORE), request = store.get(MAIN);
      request.onsuccess = () => {
        try {
          let current, source = 'v051', migration;
          if (replace) {
            const revision = Number.isSafeInteger(request.result?.revision) && request.result.revision > 0 ? request.result.revision : 0;
            current = { revision, data: null };
          } else if (request.result === undefined) {
            if (!seed) fail('初期データを読み取れません。画面を再読み込みしてください。');
            current = { revision: 0, data: clean(seed.data) }; source = seed.source; migration = seed.migration;
          } else current = record(request.result);
          let result = {}, next = current.data;
          if (mutator) {
            const returned = mutator(copy(current.data));
            if (returned?.then) fail('保存処理には同期のデータ更新関数を指定してください。');
            if (returned && typeof returned === 'object' && Object.prototype.hasOwnProperty.call(returned, 'data')) {
              const { data, ...rest } = returned; next = data; result = rest;
            } else next = returned;
          }
          const data = clean(next);
          if (current.revision >= Number.MAX_SAFE_INTEGER) fail('保存回数の上限です。バックアップを保存してください。');
          const revision = current.revision + (mutator || !current.revision ? 1 : 0);
          // load() on an existing record only validates. It never rewrites valid data.
          if (mutator || !current.revision) store.put({ schema: 1, revision, data }, MAIN);
          answer = { data, revision, source, result, ...(migration ? { migration } : {}) };
        } catch (cause) { error = cause; tx.abort(); }
      };
      request.onerror = () => { error = request.error; };
      tx.oncomplete = () => resolve(answer);
      tx.onabort = () => reject(error ?? tx.error ?? new Error('保存処理を中止しました。入力内容は再送してください。'));
      tx.onerror = () => { if (!error) error = tx.error; };
    });
  }
  return {
    load: () => transaction(),
    update: mutator => {
      if (typeof mutator !== 'function') return Promise.reject(new Error('データ更新関数が必要です。'));
      return transaction(mutator);
    },
    replace: data => {
      const valid = validateData(data);
      return transaction(() => valid, true);
    },
    raw: async () => {
      const db = await open();
      const primary = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly'), request = tx.objectStore(STORE).get(MAIN);
        let value;
        request.onsuccess = () => { value = request.result; };
        tx.oncomplete = () => resolve(value ?? null);
        tx.onabort = () => reject(tx.error ?? new Error('生データを読み取れません。'));
      });
      const legacy = {};
      for (const key of [KEY, V051_KEY, V05_KEY, ...LEGACY_KEYS]) {
        try { legacy[key] = legacyStorage()?.getItem(key) ?? null; }
        catch (error) { legacy[key] = { readError: error.message }; }
      }
      let v05;
      try { v05 = await readV05Raw(factory); } catch (error) { v05 = { readError: error.message }; }
      return { format: 'xpatrol-v051-ui-recovery', primary, v05, legacy };
    },
    close: async () => { if (dbPromise) { const db = await dbPromise; db.close(); } activeDb = undefined; dbPromise = undefined; }
  };
}
