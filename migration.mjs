/* V0.5 is a read-only source. Never call its store.load(), upgrade, or write. */
import { V05_KEY, encodeBackup } from './core.mjs';
export const SOURCE_DB_NAME = V05_KEY;
const STORE = 'state', MAIN = 'main';
const unavailable = detail => new Error('V0.5保存領域を安全に読み取れません。V0.5からJSONバックアップを書き出し、この画面のバックアップ復元を使ってください。' + (detail ? '（' + detail + '）' : ''));

export async function readV05Raw(factory, dbName = SOURCE_DB_NAME) {
  if (!factory?.open) throw unavailable('IndexedDB未対応');
  // Enumeration lets us skip an absent database without even opening its name.
  // Older Android versions lack databases(); an aborted versionchange below is
  // the safe fallback. Its creation transaction never commits a new source DB.
  if (typeof factory.databases === 'function') {
    let known;
    try { known = await factory.databases(); } catch { /* use abort-only probe */ }
    if (Array.isArray(known) && !known.some(info => info.name === dbName)) return { present: false, reason: 'absent-enumerated' };
  }
  return new Promise((resolve, reject) => {
    let request, settled = false, absent = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(value);
    };
    // Omit the version so an existing source can never be upgraded by us.
    try { request = factory.open(dbName); } catch (error) { finish(unavailable(error.message)); return; }
    request.onupgradeneeded = event => {
      absent = event.oldVersion === 0;
      try { request.transaction.abort(); } catch (error) { finish(unavailable(error.message)); }
    };
    request.onerror = () => {
      if (absent && request.error?.name === 'AbortError') finish(null, { present: false, reason: 'absent-aborted-probe' });
      else finish(unavailable(request.error?.message));
    };
    request.onblocked = () => finish(unavailable('別の画面が使用中です。V0.5を閉じて再度お試しください'));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains(STORE)) { db.close(); finish(unavailable('state領域がありません')); return; }
      let tx, read, value;
      try { tx = db.transaction(STORE, 'readonly'); read = tx.objectStore(STORE).get(MAIN); }
      catch (error) { db.close(); finish(unavailable(error.message)); return; }
      read.onsuccess = () => { value = read.result; };
      tx.oncomplete = () => { db.close(); finish(null, { present: true, value }); };
      tx.onabort = () => { db.close(); finish(unavailable(tx.error?.message)); };
      tx.onerror = () => { /* abort handler reports the final result */ };
    };
  });
}

export async function readV05Snapshot(factory, dbName = SOURCE_DB_NAME) {
  const snapshot = await readV05Raw(factory, dbName);
  if (!snapshot.present || snapshot.value === undefined) return null;
  const value = snapshot.value;
  if (!value || value.schema !== 1 || value.data?.version !== 5 || !Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw unavailable('保存記録が破損しています。旧版データには変更していません');
  }
  let data;
  try { data = JSON.parse(encodeBackup(value.data)); }
  catch (error) { throw unavailable('データ検証失敗: ' + error.message); }
  return { data, source: 'v05-idb', migration: { sourceRevision: value.revision } };
}
