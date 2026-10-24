/* V0.51 uses the compatible V0.5 backup schema in an independent save area. */
export const KEY = 'xpatrol-v054-watch-test';
export const RSS_SOURCE_KEY = 'xpatrol-v051-rss-test';
export const V051_KEY = 'xpatrol-v051-ui-test';
export const V05_KEY = 'xpatrol-v05-test';
export const LEGACY_KEYS = Object.freeze(['xpatrol-v04-test', 'xpatrol-v03', 'x-patrol-v01']);
export const STATES = Object.freeze(['新規発見', '興味あり', '交流中', 'フォロー中', '保留']);
export const LIMITS = Object.freeze({ genres: 200, people: 5000, posts: 20000, inbox: 10000, history: 50000, batch: 100, bytes: 10000000, input: 32000 });
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const RESERVED = new Set(['i', 'home', 'search', 'intent', 'share', 'messages', 'settings', 'explore', 'notifications', 'compose', 'hashtag']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const uid = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
function string(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(label + 'を確認してください。');
  return value;
}
function array(value, max, label) {
  if (!Array.isArray(value) || value.length > max) fail(label + 'の形式または件数を確認してください。');
  return value;
}
function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(label + 'が不正です。');
  return value;
}
function handle(value) {
  if (typeof value !== 'string' || !HANDLE.test(value) || RESERVED.has(value.toLowerCase())) fail('Xのユーザー名は英数字・_の15文字以内で指定してください。');
  return value.toLowerCase();
}
function timestamp(value, label, required = false) {
  string(value, 40, label, required);
  if (value && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))) fail(label + 'の日時が不正です。');
  if (value) {
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) fail(label + 'の日時が不正です。');
  }
  return value;
}
function refs(value, allowed, label) {
  array(value, LIMITS.genres, label);
  if (value.some(id => typeof id !== 'string' || !allowed.has(id))) fail(label + 'に存在しないジャンルがあります。');
  return [...new Set(value)];
}
function selected(value, legacy = false) {
  if (legacy && value === undefined) return true;
  if (typeof value !== 'boolean') fail('選択状態を確認してください。');
  return value;
}
function setIds(values, label) {
  if (!Array.isArray(values)) values = [values];
  array(values, Math.max(LIMITS.people, LIMITS.inbox), label);
  if (values.some(id => typeof id !== 'string')) fail(label + 'を確認してください。');
  return new Set(values);
}

export function parsePostUrl(value) {
  const raw = string(value, 2048, '投稿リンク', true).trim();
  // Check original spelling before URL normalizes credentials, ports and dot segments.
  if (/[\s\u0000-\u001f\u007f\\]/.test(raw) || !/^https:\/\/(?:x\.com|twitter\.com|www\.x\.com|www\.twitter\.com|mobile\.twitter\.com)\//i.test(raw)) fail('https://x.com/ユーザー名/status/数字 の投稿リンクが必要です。');
  let url;
  try { url = new URL(raw); } catch { fail('投稿リンクの形式を確認してください。'); }
  if (url.username || url.password || url.port || url.protocol !== 'https:' || !['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname)) fail('Xの正規投稿リンクではありません。');
  const path = raw.replace(/^https:\/\/[^/]+/i, '').split(/[?#]/, 1)[0];
  const m = /^\/(?:(?<handle>[A-Za-z0-9_]{1,15})\/status|i\/(?:web\/)?status)\/(?<id>[1-9][0-9]{0,19})(?:\/(?:photo\/[1-4]|video\/1))?\/?$/.exec(path);
  if (!m || BigInt(m.groups.id) > 18446744073709551615n) fail('投稿URLを確認してください。プロフィール・短縮リンクは登録できません。');
  const h = m.groups.handle && m.groups.handle !== 'i' ? handle(m.groups.handle) : '';
  const id = m.groups.id;
  return { handle: h, id, url: `https://x.com/${h || 'i/web'}/status/${id}` };
}

export function shareText(value) {
  if (typeof value === 'string') return string(value, LIMITS.input, '貼り付け内容', true);
  if (!object(value)) fail('共有内容を確認してください。');
  const text = ['title', 'text', 'url'].map(key => string(value[key] ?? '', LIMITS.input, '共有内容')).filter(Boolean).join('\n');
  return string(text, LIMITS.input, '共有内容', true);
}
export function extractPostUrls(value) {
  const text = shareText(value);
  // Shared captions and Japanese punctuation may surround a URL. Only the URL is data.
  const tokens = text.match(/https?:\/\/[^\s<>"'`\u3000,、。，））」』】〉》]+/gi) ?? [];
  if (!tokens.length) fail('投稿リンクが見つかりません。Xの投稿からリンクをコピーしてください。');
  if (tokens.length > LIMITS.batch) fail('一度に取り込める投稿リンクは100件までです。');
  return tokens.map(token => token.replace(/[)\]}.,!;:。、！？，）」』】〉》]+$/u, ''));
}
export function parseWords(value) {
  const words = [...new Set(string(value, 4000, '検索キーワード').split(/[,、\n]/).map(word => word.trim()).filter(Boolean))];
  if (words.length > 25 || words.some(word => word.length > 120)) fail('検索キーワードは25個まで、各120文字以内にしてください。');
  return words;
}
export function searchUrl(word) {
  string(word, 120, '検索キーワード', true);
  const url = new URL('https://x.com/search');
  url.search = new URLSearchParams({ q: word, f: 'live' }).toString();
  return url.href;
}
export function defaults() {
  return { version: 5, genres: [
    { id: 'g1', name: 'サバゲー', target: 30, words: ['サバゲー', 'サバゲー初心者'] },
    { id: 'g2', name: 'エアガン', target: 30, words: ['エアガン', '愛銃紹介'] },
    { id: 'g3', name: 'カスタム', target: 20, words: ['エアガンカスタム', '外装カスタム'] }
  ], people: [], session: null, inbox: [], history: [], rss: [] };
}

export function validateData(input) {
  if (!object(input) || ![undefined, 3, 4, 5].includes(input.version)) fail('対応するV0.3 / V0.4 / V0.5データではありません。');
  const legacy = input.version !== 5;
  const gids = new Set(), names = new Set();
  const genres = array(input.genres, LIMITS.genres, 'ジャンル').map(g => {
    if (!object(g)) fail('ジャンルの形式を確認してください。');
    const id = identifier(g.id, 'ジャンルID'), name = string(g.name, 32, 'ジャンル名', true).trim();
    if (gids.has(id) || names.has(name)) fail('ジャンルIDまたは名前が重複しています。');
    gids.add(id); names.add(name);
    if (!Number.isInteger(g.target) || g.target < 1 || g.target > 100000) fail('目標人数は1〜100000の整数にしてください。');
    const words = [...new Set(array(g.words, 25, '検索キーワード').map(w => string(w, 120, '検索キーワード', true).trim()))];
    return { id, name, target: g.target, words };
  });
  const pids = new Set(), postOwners = new Map(), people = [];
  let postCount = 0;
  for (const p of array(input.people, LIMITS.people, '交流候補')) {
    if (!object(p)) fail('交流候補の形式を確認してください。');
    const id = identifier(p.id, '候補ID'), h = handle(p.handle);
    if (pids.has(id) || !STATES.includes(p.status)) fail('候補IDまたは状態を確認してください。');
    pids.add(id);
    const pg = refs(p.genres, gids, '候補');
    const person = { id, handle: h, genres: pg, note: string(p.note ?? '', 160, 'メモ'), status: p.status,
      selected: selected(p.selected, legacy), checked: string(p.checked ?? '', 120, '最終確認'), checkedAt: timestamp(p.checkedAt ?? '', '最終確認'), posts: [] };
    if ((!legacy || input.version === 4) && !Array.isArray(p.posts)) fail('投稿リンクの形式を確認してください。');
    for (const post of array(p.posts ?? [], LIMITS.posts, '投稿リンク')) {
      if (++postCount > LIMITS.posts || !object(post)) fail('投稿リンクの件数または形式を確認してください。');
      const parsed = parsePostUrl(post.url);
      if (parsed.handle !== h || post.id !== parsed.id) fail('投稿リンクと候補のユーザー名・投稿IDが一致しません。');
      if (postOwners.has(parsed.id) && postOwners.get(parsed.id) !== h) fail('同じ投稿IDに異なるユーザー名が指定されています。');
      postOwners.set(parsed.id, h);
      const genreRefs = refs(post.genres, gids, '投稿リンク');
      if (genreRefs.some(gid => !pg.includes(gid))) fail('投稿リンクのジャンルが候補に紐付いていません。');
      const prior = person.posts.find(item => item.id === parsed.id);
      if (prior) {
        if (!legacy) fail('投稿IDが重複しています。');
        prior.genres = [...new Set([...prior.genres, ...genreRefs])];
      } else person.posts.push({ id: parsed.id, url: parsed.url, genres: genreRefs, addedAt: timestamp(post.addedAt ?? '', '登録') });
    }
    const prior = people.find(item => item.handle === h);
    if (prior) {
      if (!legacy) fail('候補のユーザー名が重複しています。');
      prior.genres = [...new Set([...prior.genres, ...pg])];
      if (!prior.note) prior.note = person.note;
      if (!prior.checked || (person.checkedAt && (!prior.checkedAt || Date.parse(person.checkedAt) > Date.parse(prior.checkedAt)))) { prior.checked = person.checked; prior.checkedAt = person.checkedAt; }
      for (const post of person.posts) {
        const found = prior.posts.find(item => item.id === post.id);
        if (found) found.genres = [...new Set([...found.genres, ...post.genres])];
        else prior.posts.push(post);
      }
    } else people.push(person);
  }
  let session = null;
  if (input.session != null && input.session !== '') {
    if (!object(input.session) || !['朝', '夜'].includes(input.session.period)) fail('巡回情報を確認してください。');
    session = { period: input.session.period, startedAt: timestamp(input.session.startedAt, '巡回', true) };
  }
  const inbox = [], inboxIds = new Set();
  for (const item of array(legacy ? (input.inbox ?? []) : input.inbox, LIMITS.inbox, '収集BOX')) {
    if (!object(item)) fail('収集BOXの形式を確認してください。');
    const parsed = parsePostUrl(item.url);
    if (item.id !== parsed.id || item.handle !== parsed.handle || inboxIds.has(item.id) || postOwners.has(item.id)) fail('収集BOXの投稿ID・ユーザー名が不正または重複しています。');
    if (!['share', 'manual'].includes(item.source)) fail('収集経路を確認してください。');
    inboxIds.add(item.id);
    inbox.push({ ...parsed, addedAt: timestamp(item.addedAt, '収集', true), source: item.source, selected: selected(item.selected) });
  }
  const history = [], hids = new Set(), peopleById = new Map(people.map(p => [p.id, p]));
  for (const item of array(legacy ? (input.history ?? []) : input.history, LIMITS.history, '確認履歴')) {
    if (!object(item)) fail('確認履歴の形式を確認してください。');
    const id = identifier(item.id, '確認履歴ID');
    if (hids.has(id) || !['朝', '夜', '手動'].includes(item.period)) fail('確認履歴IDまたは巡回区分を確認してください。');
    hids.add(id);
    const personId = item.personId === '' ? '' : identifier(item.personId, '確認履歴の候補ID');
    const h = handle(item.handle), person = peopleById.get(personId);
    if (person && person.handle !== h) fail('確認履歴のユーザー名が候補と一致しません。');
    const at = timestamp(item.at, '確認履歴'), legacyText = string(item.legacyText ?? '', 160, '旧版確認記録');
    if (!at && !legacyText) fail('確認履歴の日時または旧版記録が必要です。');
    history.push({ id, personId, handle: h, at, period: item.period, sessionStartedAt: timestamp(item.sessionStartedAt ?? '', '巡回開始'), legacyText });
  }
  // V0.3 stored a localized display string only. Preserve it without inventing a timestamp.
  if (legacy) {
    for (const p of people) if (p.checked || p.checkedAt) {
      let serial = history.length, id = 'migrated-check-' + serial;
      while (hids.has(id)) id = 'migrated-check-' + (++serial);
      hids.add(id);
      history.push({ id, personId: p.id, handle: p.handle, at: p.checkedAt, period: /(?:^|\s)朝$/.test(p.checked) ? '朝' : /(?:^|\s)夜$/.test(p.checked) ? '夜' : '手動', sessionStartedAt: '', legacyText: p.checked });
    }
    if (history.length > LIMITS.history) fail('確認履歴の上限に達しました。');
  }
  const rss = [], seenHandles = new Set();
  for (const entry of array(input.rss ?? [], LIMITS.people, 'RSS記録')) {
    if (!object(entry)) fail('RSS記録を確認してください。');
    const h = handle(entry.handle);
    if (seenHandles.has(h)) fail('RSS記録のユーザー名が重複しています。');
    seenHandles.add(h);
    const id = (value, label) => {
      const text = string(value ?? '', 20, label);
      if (text && (!/^[1-9][0-9]{0,19}$/.test(text) || BigInt(text) > 18446744073709551615n)) fail(label + 'を確認してください。');
      return text;
    };
    rss.push({ handle: h, latestId: id(entry.latestId, 'RSS最新投稿ID'), ackId: id(entry.ackId, 'RSS確認済みID'), undoAckId: id(entry.undoAckId, 'RSS取消用ID'), fetchedAt: timestamp(entry.fetchedAt ?? '', 'RSS取得'), attemptedAt: timestamp(entry.attemptedAt ?? entry.fetchedAt ?? '', 'RSS照合') });
  }
  return { version: 5, genres, people, session, inbox, history, rss };
}

export function migrateV02(input) {
  if (!object(input)) fail('V0.2データの形式を確認してください。');
  const genreMap = new Map(), people = [];
  for (const u of array(input.users, 100, 'V0.2候補')) {
    if (!object(u)) fail('V0.2候補の形式を確認してください。');
    const h = handle(u.h), name = string(u.k, 32, 'V0.2分類', true).trim();
    if (!genreMap.has(name)) genreMap.set(name, { id: 'legacy-' + (genreMap.size + 1), name, target: 20, words: [name] });
    const gid = genreMap.get(name).id, prior = people.find(p => p.handle === h);
    if (prior) { if (!prior.genres.includes(gid)) prior.genres.push(gid); }
    else people.push({ id: 'legacy-person-' + (people.length + 1), handle: h, genres: [gid], selected: true, status: STATES[0], note: '', checked: '', checkedAt: '', posts: [] });
  }
  const history = [];
  for (const log of array(input.logs, LIMITS.history, 'V0.2確認履歴')) {
    if (!object(log)) fail('V0.2確認記録を確認してください。');
    const h = handle(log.h), at = timestamp(log.at, 'V0.2確認記録', true), label = string(log.session ?? '', 160, 'V0.2巡回名');
    const period = /^朝(?:\s|$)/.test(label) ? '朝' : /^夜(?:\s|$)/.test(label) ? '夜' : '手動';
    const p = people.find(item => item.handle === h);
    history.push({ id: 'legacy-log-' + history.length, personId: p?.id ?? '', handle: h, at, period, sessionStartedAt: '', legacyText: label });
    if (p && (!p.checkedAt || Date.parse(at) > Date.parse(p.checkedAt))) { p.checkedAt = at; p.checked = (at + (label ? ' ' + label : '')).slice(0, 120); }
  }
  return validateData({ version: 5, genres: [...genreMap.values()], people, session: null, inbox: [], history });
}
export function decodeBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMITS.bytes) fail('バックアップは10MB以内のJSONにしてください。');
  let input;
  try { input = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { fail('JSONを読み込めません。ファイルの内容を確認してください。'); }
  return object(input) && own(input, 'users') ? migrateV02(input) : validateData(input);
}
export function encodeBackup(data) {
  const json = JSON.stringify(validateData(data), null, 2);
  if (new TextEncoder().encode(json).length > LIMITS.bytes) fail('データが10MBを超えています。バックアップ後に不要な記録を整理してください。');
  return json;
}
export function loadData(storage) {
  for (const [key, source] of [[KEY, 'v051-rss-local'], [V051_KEY, 'v051-ui-local'], [V05_KEY, 'v05-local'], [LEGACY_KEYS[0], 'v04'], [LEGACY_KEYS[1], 'v03'], [LEGACY_KEYS[2], 'v02']]) {
    const text = storage.getItem(key);
    if (text !== null) return { data: decodeBackup(text), source };
  }
  return { data: defaults(), source: 'new' };
}

function knownPosts(data) {
  const map = new Map();
  data.people.forEach(p => p.posts.forEach(post => map.set(post.id, { ...post, handle: p.handle, person: p })));
  data.inbox.forEach(item => map.set(item.id, item));
  return map;
}
export function collectPosts(data, input, options = {}, makeId = uid, at = now()) {
  void makeId; // Inbox identity is the global X status ID, not an arbitrary generated ID.
  const source = options.source ?? 'manual';
  if (!['manual', 'share'].includes(source)) fail('収集経路を確認してください。');
  timestamp(at, '収集', true);
  const next = validateData(data), known = knownPosts(next), results = [];
  for (const raw of extractPostUrls(input)) {
    try {
      const parsed = parsePostUrl(raw), prior = known.get(parsed.id);
      if (prior?.handle && parsed.handle && prior.handle !== parsed.handle) fail('同じ投稿IDに異なるユーザー名があります。投稿元を確認してください。');
      if (prior) {
        if (!prior.handle && parsed.handle && !prior.person) {
          const item = next.inbox.find(item => item.id === parsed.id);
          Object.assign(item, parsed); Object.assign(prior, parsed);
          results.push({ raw, valid: true, ...parsed, duplicate: true, added: false, action: '投稿者名を補完' });
        } else results.push({ raw, valid: true, ...parsed, duplicate: true, added: false, action: '登録済み' });
        continue;
      }
      if (next.inbox.length >= LIMITS.inbox) fail('収集BOXは10000件までです。候補への登録や不要なリンクの削除を行ってください。');
      const item = { ...parsed, addedAt: at, source, selected: true };
      next.inbox.push(item); known.set(item.id, item);
      results.push({ raw, valid: true, ...parsed, duplicate: false, added: true, action: '収集BOXに追加' });
    } catch (error) { results.push({ raw, valid: false, error: error.message }); }
  }
  return { data: validateData(next), results };
}
export function promoteInbox(data, values, genreId, overrides = {}, makeId = uid, at = now()) {
  const next = validateData(data), requested = setIds(values, '収集BOXの選択');
  if (!next.genres.some(g => g.id === genreId)) fail('登録先のジャンルを選んでください。');
  if (!object(overrides)) fail('投稿者名の指定を確認してください。');
  timestamp(at, '登録', true);
  const results = [], removed = new Set();
  let postCount = next.people.reduce((n, p) => n + p.posts.length, 0);
  for (const id of requested) {
    const item = next.inbox.find(item => item.id === id);
    if (!item) { results.push({ id, valid: false, error: '収集BOXに投稿がありません。ほかの画面で処理された可能性があります。' }); continue; }
    try {
      const override = own(overrides, id) ? overrides[id] : '';
      const h = item.handle || (override ? handle(override.trim().replace(/^@/, '')) : '');
      if (!h) fail('投稿者名がないリンクです。Xで開き、投稿者名を入力してから候補へ登録してください。');
      if (item.handle && override && handle(override.trim().replace(/^@/, '')) !== item.handle) fail('投稿リンクと指定した投稿者名が一致しません。');
      const other = next.people.find(p => p.handle !== h && p.posts.some(post => post.id === id));
      if (other) fail('同じ投稿IDに異なるユーザー名があります。');
      let p = next.people.find(p => p.handle === h);
      if (!p && next.people.length >= LIMITS.people) fail('候補人数は5000人までです。');
      const post = p?.posts.find(post => post.id === id);
      if (!post && postCount >= LIMITS.posts) fail('候補の投稿リンクは20000件までです。');
      const existed = Boolean(p);
      if (!p) {
        p = { id: makeId(), handle: h, genres: [], note: '', status: STATES[0], selected: true, checked: '', checkedAt: '', posts: [] };
        next.people.push(p);
      }
      if (!p.genres.includes(genreId)) p.genres.push(genreId);
      if (post) { if (!post.genres.includes(genreId)) post.genres.push(genreId); }
      else { p.posts.push({ id, url: `https://x.com/${h}/status/${id}`, genres: [genreId], addedAt: at }); postCount++; }
      removed.add(id);
      results.push({ id, handle: h, valid: true, action: existed ? '候補に投稿リンクを追加' : '交流候補を追加' });
    } catch (error) { results.push({ id, valid: false, error: error.message }); }
  }
  next.inbox = next.inbox.filter(item => !removed.has(item.id));
  return { data: validateData(next), results };
}
// Compatibility helper: direct registration still uses the collection and promotion rules.
export function addPosts(data, text, genreId, makeId = uid, at = now()) {
  const collected = collectPosts(data, text, { source: 'manual' }, makeId, at);
  const requested = collected.results.filter(r => r.valid && collected.data.inbox.some(item => item.id === r.id)).map(r => r.id);
  const promoted = promoteInbox(collected.data, requested, genreId, {}, makeId, at);
  return { data: promoted.data, results: [...collected.results.filter(r => !r.valid || !requested.includes(r.id)), ...promoted.results] };
}
export function removeInbox(data, values) {
  const next = validateData(data), ids = setIds(values, '収集BOXの選択');
  next.inbox = next.inbox.filter(item => !ids.has(item.id));
  return next;
}
export function setInboxSelected(data, values, value) {
  selected(value); const next = validateData(data), ids = setIds(values, '収集BOXの選択');
  next.inbox.forEach(item => { if (ids.has(item.id)) item.selected = value; }); return next;
}
export function setSelected(data, values, value) {
  selected(value); const next = validateData(data), ids = setIds(values, '候補の選択');
  next.people.forEach(p => { if (ids.has(p.id)) p.selected = value; }); return next;
}
export function upsertGenre(data, input, makeId = uid) {
  const next = validateData(data), name = string(input.name, 32, 'ジャンル名', true).trim();
  if (next.genres.some(g => g.name === name && g.id !== input.id)) fail('同じジャンル名が登録されています。');
  if (!Number.isInteger(input.target) || input.target < 1 || input.target > 100000) fail('目標人数は1〜100000の整数にしてください。');
  const words = Array.isArray(input.words) ? parseWords(input.words.join('\n')) : parseWords(input.words ?? '');
  if (input.id) {
    const genre = next.genres.find(g => g.id === input.id);
    if (!genre) fail('編集対象のジャンルがありません。');
    Object.assign(genre, { name, target: input.target, words });
  } else {
    if (next.genres.length >= LIMITS.genres) fail('ジャンルは200個までです。');
    next.genres.push({ id: makeId(), name, target: input.target, words });
  }
  return validateData(next);
}
export function deleteGenre(data, id) {
  const next = validateData(data);
  next.genres = next.genres.filter(g => g.id !== id);
  next.people.forEach(p => { p.genres = p.genres.filter(g => g !== id); p.posts.forEach(post => { post.genres = post.genres.filter(g => g !== id); }); });
  return validateData(next);
}
export function updatePerson(data, id, input) {
  if (!object(input)) fail('候補の編集内容を確認してください。');
  const next = validateData(data), p = next.people.find(p => p.id === id);
  if (!p) fail('候補がありません。');
  if (own(input, 'note')) p.note = string(input.note, 160, 'メモ').trim();
  if (own(input, 'genres')) {
    p.genres = refs(input.genres, new Set(next.genres.map(g => g.id)), '候補');
    p.posts.forEach(post => { post.genres = post.genres.filter(gid => p.genres.includes(gid)); });
  }
  return validateData(next);
}
export function setStatus(data, id, status) {
  if (!STATES.includes(status)) fail('状態を確認してください。');
  const next = validateData(data), p = next.people.find(p => p.id === id);
  if (!p) fail('候補がありません。');
  p.status = status; return next;
}
export function deletePerson(data, id) {
  const next = validateData(data); next.people = next.people.filter(p => p.id !== id);
  const active=new Set(next.people.map(person=>person.handle));
  next.rss=next.rss.filter(entry=>active.has(entry.handle));
  // Confirmations are retained even after removing a candidate.
  return next;
}
export function removePost(data, personId, postId) {
  const next = validateData(data), p = next.people.find(p => p.id === personId);
  if (!p) fail('候補がありません。');
  p.posts = p.posts.filter(post => post.id !== postId); return next;
}
export function startSession(data, period, at = now()) {
  if (!['朝', '夜'].includes(period)) fail('朝または夜の巡回を選んでください。');
  const next = validateData(data); next.session = { period, startedAt: timestamp(at, '巡回開始', true) }; return next;
}
export function markChecked(data, id, at = now(), makeId = uid) {
  const next = validateData(data), p = next.people.find(p => p.id === id);
  if (!p) fail('候補がありません。');
  if (next.history.length >= LIMITS.history) fail('確認履歴は50000件までです。バックアップしてから記録を整理してください。');
  timestamp(at, '確認', true);
  const period = next.session?.period ?? '手動';
  p.checkedAt = at; p.checked = at + ' ' + period;
  const feed = next.rss.find(item => item.handle === p.handle);
  if (feed && feed.latestId) { feed.undoAckId = feed.ackId; feed.ackId = feed.latestId; }
  next.history.push({ id: makeId(), personId: p.id, handle: p.handle, at, period, sessionStartedAt: next.session?.startedAt ?? '', legacyText: '' });
  return validateData(next);
}
// Undo changes the present marker only. Historical human checks remain in the
// backup as past events and are never replayed to recreate the current marker.
export function undoChecked(data, id) {
  const next = validateData(data), person = next.people.find(p => p.id === id);
  if (!person) fail('候補がありません。');
  person.checked = ''; person.checkedAt = '';
  const feed = next.rss.find(item => item.handle === person.handle);
  if (feed && feed.latestId) { feed.ackId = feed.undoAckId; feed.undoAckId = ''; }
  return validateData(next);
}
// Reorder only the visible subset's occupied slots in the latest saved record.
// Hidden users, concurrent additions and all person fields remain untouched.
export function reorderPeople(data, visibleIds, orderedIds) {
  const next = validateData(data);
  if (!Array.isArray(visibleIds) || !Array.isArray(orderedIds) || visibleIds.length > LIMITS.people || visibleIds.length !== orderedIds.length) fail('並べ替える候補を確認してください。');
  const before = new Set(visibleIds), after = new Set(orderedIds);
  if (before.size !== visibleIds.length || after.size !== orderedIds.length || visibleIds.some(id => typeof id !== 'string' || !after.has(id))) fail('候補が重複しているか、並べ替える範囲が変わりました。');
  const people = new Map(next.people.map(person => [person.id, person]));
  if (visibleIds.some(id => !people.has(id))) fail('候補が変更されています。一覧を更新して再度お試しください。');
  let cursor = 0;
  next.people = next.people.map(person => before.has(person.id) ? people.get(orderedIds[cursor++]) : person);
  return next;
}
export function counts(data) {
  return data.genres.map(g => ({ ...g, count: data.people.filter(p => p.genres.includes(g.id)).length, selectedCount: data.people.filter(p => p.selected && p.genres.includes(g.id)).length }));
}
