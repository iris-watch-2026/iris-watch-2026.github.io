/* Local display rules. A human confirmation is never an X new-post signal. */
export function patrolState(person) {
  const parsed = Date.parse(person.checkedAt || '');
  const checked = Number.isFinite(parsed) || Boolean(person.checked);
  return { key: checked ? 'recent' : 'unchecked', label: checked ? '✔' : '−', checked, due: !checked, at: Number.isFinite(parsed) ? parsed : 0 };
}
export function relativeCheck(person, now = Date.now()) {
  const state = patrolState(person);
  if (!state.at) return state.checked ? '確認：日時不明' : '未確認';
  const minutes = Math.max(0, Math.floor((now - state.at) / 60000));
  return '確認：' + (minutes < 1 ? 'たった今' : minutes < 60 ? minutes + '分前' : minutes < 1440 ? Math.floor(minutes / 60) + '時間前' : Math.floor(minutes / 1440) + '日前');
}
export function firstRegistration(person) {
  const times = (person.posts || []).map(post => Date.parse(post.addedAt || '')).filter(Number.isFinite);
  return times.length ? Math.min(...times) : 0;
}
export function sortCandidates(people, order = 'priority') {
  if (order === 'manual') return [...people];
  return people.map((person, index) => ({ person, index })).sort((a, b) => {
    if (order === 'newest') return firstRegistration(b.person) - firstRegistration(a.person) || b.index - a.index;
    const as = patrolState(a.person), bs = patrolState(b.person);
    if (order === 'priority' && as.checked !== bs.checked) return as.checked ? 1 : -1;
    return as.at - bs.at || a.index - b.index;
  }).map(row => row.person);
}
export function shortGenres(names) {
  if (!names.length) return '未分類';
  const first = [...names[0]].slice(0, 5).join('');
  return first + ([...names[0]].length > 5 ? '…' : '') + (names.length > 1 ? ' +' + (names.length - 1) : '');
}
