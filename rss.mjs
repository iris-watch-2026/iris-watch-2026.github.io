/* A feed item is evidence only when both the canonical X URL and dc:creator
   identify the registered author. */
export const PILOT_HANDLES = Object.freeze(['tony_sunflower', 'iyokanlove', 'dusmel_clean']);
export const RSS_CHECK_INTERVAL_MS = 6*60*60*1000;
export const RSS_RETRY_INTERVAL_MS = 60*60*1000;
export const RSS_REQUEST_SPACING_MS = 1250;
const FEED_NAME = Object.freeze({ tony_sunflower: 'Tony_sunflower', iyokanlove: 'iyokanLOVE', dusmel_clean: 'dusmel_clean' });
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export function canonicalHandle(value) {
  if (typeof value !== 'string' || !HANDLE.test(value)) throw new Error('Xのユーザー名を確認してください。');
  return value.toLowerCase();
}
export function feedUrl(handle) {
  const name=canonicalHandle(handle);
  return `https://keep.md/api/x-rss/${FEED_NAME[name]||name}.xml?content=posts`;
}
export function newestOwnPost(doc, handle) {
  handle=canonicalHandle(handle);
  if (doc.querySelector('parsererror') || doc.documentElement?.nodeName !== 'rss') throw new Error('RSSを読み取れません。');
  let newest = '';
  for (const item of doc.querySelectorAll('channel > item')) {
    const link = item.querySelector('link')?.textContent?.trim() || '';
    const creator = item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0]?.textContent?.trim().replace(/^@/, '').toLowerCase();
    if (creator !== handle) continue;
    const match = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/([1-9][0-9]{0,19})\/?$/.exec(link);
    if (!match || match[1].toLowerCase() !== handle || BigInt(match[2]) > 18446744073709551615n) continue;
    if (!newest || BigInt(match[2]) > BigInt(newest)) newest = match[2];
  }
  return newest;
}
export async function readFeed(handle, fetcher = fetch, Parser = DOMParser) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(feedUrl(handle), { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal });
    if (response.status === 429) { const error=new Error('RSS取得制限');error.status=429;throw error; }
    if (!response.ok || response.type === 'opaque' || response.redirected) throw new Error('RSS取得失敗');
    const body = await response.text();
    if (body.length > 1000000 || !/\brss\b/.test(body)) throw new Error('RSS形式不正');
    return newestOwnPost(new Parser().parseFromString(body, 'application/xml'), handle);
  } finally { clearTimeout(timeout); }
}
export function applyFeedResults(data, results, at = new Date().toISOString()) {
  if (!Array.isArray(data.rss)) data.rss = [];
  for (const { handle, latestId } of results) {
    if (!data.people.some(p => p.handle === handle) || !/^[1-9][0-9]{0,19}$/.test(latestId || '')) continue;
    let entry = data.rss.find(item => item.handle === handle);
    if (!entry) {
      // First observation is a baseline; existing posts never become false New.
      entry = { handle, latestId, ackId: latestId, undoAckId: '', fetchedAt: at, attemptedAt: at };
      data.rss.push(entry);
    } else {
      if (!entry.latestId) { entry.latestId=latestId;entry.ackId=latestId;entry.undoAckId=''; }
      else if (BigInt(latestId) > BigInt(entry.latestId)) entry.latestId = latestId;
      entry.fetchedAt = at;
      entry.attemptedAt = at;
    }
  }
  return data;
}
export function recordFeedAttempt(data, handle, at = new Date().toISOString()) {
  handle=canonicalHandle(handle);
  if (!Array.isArray(data.rss)) data.rss=[];
  const active=new Set(data.people.map(person=>person.handle));
  data.rss=data.rss.filter(entry=>active.has(entry.handle));
  if (!active.has(handle)) return data;
  let entry=data.rss.find(item=>item.handle===handle);
  if (!entry){entry={handle,latestId:'',ackId:'',undoAckId:'',fetchedAt:'',attemptedAt:at};data.rss.push(entry);}
  else entry.attemptedAt=at;
  return data;
}
export function dueHandles(data, now=Date.now(), force=false) {
  const entries=new Map((data?.rss||[]).map(entry=>[entry.handle,entry]));
  return (data?.people||[]).map(person=>person.handle).filter(handle=>{
    const entry=entries.get(handle),at=Date.parse(entry?.attemptedAt||entry?.fetchedAt||'');
    if(force)return true;
    const lastSuccess=Date.parse(entry?.fetchedAt||'');
    const retry=!entry?.latestId||!Number.isFinite(lastSuccess)||at>lastSuccess;
    return !Number.isFinite(at)||now-at>=(retry?RSS_RETRY_INTERVAL_MS:RSS_CHECK_INTERVAL_MS);
  }).sort((a,b)=>{
    const aa=Date.parse(entries.get(a)?.attemptedAt||entries.get(a)?.fetchedAt||'')||0;
    const bb=Date.parse(entries.get(b)?.attemptedAt||entries.get(b)?.fetchedAt||'')||0;
    return aa-bb;
  });
}
export function feedState(data, handle) {
  const entry = data?.rss?.find(item => item.handle === handle);
  if (!entry?.latestId) return { newPost: false, known: false, label: '−' };
  const newPost = BigInt(entry.latestId) > BigInt(entry.ackId || '0');
  return { newPost, known: true, label: newPost ? '●' : '' };
}
