export const CORE_PLATFORMS = [
  ['douyin', '抖音'], ['shipinhao', '视频号'], ['wechat_mp', '公众号'],
  ['youtube', 'YouTube'], ['xiaoyuzhou', '小宇宙'], ['ximalaya', '喜马拉雅'], ['bilibili', 'B站'],
];
export const DASH = '—';
export function formatMetric(value, suffix = '') {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? DASH : `${Number(value).toLocaleString('zh-CN')}${suffix}`;
}
export const RATIO_KEYS = ['ctr', 'completionRate', 'avgPlayShare', 'retain5s'];
export function formatField(key, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return DASH;
  if (RATIO_KEYS.includes(key)) return `${(Number(value) * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
  return formatMetric(value);
}

export function metricTotal(contents, keys) {
  let total = 0, found = false;
  for (const content of contents ?? []) {
    const metrics = content.metrics ?? {};
    const key = keys.find(candidate => metrics[candidate] !== null && metrics[candidate] !== undefined);
    if (key) { total += Number(metrics[key]); found = true; }
  }
  return found ? total : null;
}
export function metricDelta(contents, keys) {
  let total = 0, found = false;
  for (const content of contents ?? []) {
    const snap = [...(content.daily_snapshots ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
    if (!snap?.deltas) continue;
    const key = keys.find(candidate => snap.deltas[candidate] !== null && snap.deltas[candidate] !== undefined);
    if (key) { total += Number(snap.deltas[key]); found = true; }
  }
  return found ? total : null;
}
export function collectPlatformRows(data) {
  const rows = [];
  for (const project of data?.projects ?? []) for (const account of project.accounts ?? []) for (const platform of account.platforms ?? []) rows.push({ project, account, platform, contents: platform.contents ?? [] });
  return rows;
}
export function summarizeRows(rows) {
  const contents = rows.flatMap(row => row.contents);
  return { plays: metricTotal(contents, ['plays', 'views']), reads: metricTotal(contents, ['reads']), playsDelta: metricDelta(contents, ['plays', 'views']), readsDelta: metricDelta(contents, ['reads']) };
}
export function latestAsOf(data) {
  const values = [data?.generatedAt];
  for (const row of collectPlatformRows(data)) values.push(row.platform.login?.asOf, row.platform.sourceAsOf, ...row.contents.map(content => content.sourceAsOf));
  const valid = values.filter(value => value && !Number.isNaN(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a));
  if (!valid.length) return DASH;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(valid[0]));
}
export function sparkline(snapshots, keys) {
  const ordered = [...(snapshots ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const vals = ordered.map(snap => keys.map(key => snap.metrics?.[key]).find(value => value !== null && value !== undefined)).filter(value => value !== undefined);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  return vals.map((value, index) => `${(index * 100 / (vals.length - 1)).toFixed(1)},${(28 - (value - min) * 24 / span).toFixed(1)}`).join(' ');
}
