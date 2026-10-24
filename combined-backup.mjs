// Standalone, local-only transport for candidates + analytics.
// Pure codec: no network, storage writes, or collection of personal data.
export const COMBINED_FORMAT = 'sns-watch-box-combined-v1';
export const COMBINED_MAX_BYTES = 20_000_000;
const byteSize = text => new TextEncoder().encode(text).length;
const problem = message => { throw new Error(message); };
export function encodeCombinedBackup(candidateJson, analyticsSnapshot) {
  if (typeof candidateJson !== 'string') problem('候補データがありません。');
  let candidates;
  try { candidates = JSON.parse(candidateJson); } catch { problem('候補データを読み込めません。'); }
  const envelope = {
    format: COMBINED_FORMAT,
    exportedAt: new Date().toISOString(),
    candidates,
    analytics: analyticsSnapshot
  };
  const result = JSON.stringify(envelope, null, 2);
  if (byteSize(result) > COMBINED_MAX_BYTES) problem('まとめたデータが20MBを超えています。個別保存をご利用ください。');
  return result;
}
export function decodeCombinedBackup(text, decodeCandidates, validateAnalytics) {
  if (typeof text !== 'string' || byteSize(text) > COMBINED_MAX_BYTES) problem('20MB以内のまとめ保存JSONを指定してください。');
  let envelope;
  try { envelope = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { problem('まとめ保存JSONを読み込めません。'); }
  if (!envelope || Array.isArray(envelope) || envelope.format !== COMBINED_FORMAT || !envelope.candidates || !envelope.analytics) {
    problem('SNS WATCH BOXのまとめ保存ファイルではありません。');
  }
  // Fully validate BOTH sections before allowing either to be written.
  const candidates = decodeCandidates(JSON.stringify(envelope.candidates));
  const analytics = validateAnalytics(envelope.analytics);
  return { candidates, analytics, exportedAt: envelope.exportedAt || '' };
}
