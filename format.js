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
export function formatSigned(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return DASH;
  const n = Number(value);
  const body = Math.abs(n).toLocaleString('zh-CN');
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return '0';
}
export function ratioPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return Math.max(0, Math.min(100, Number(value) * 100));
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
  return formatDateTime(valid[0]);
}
export function formatDateTime(value) {
  if (value === null || value === undefined || value === '') return DASH;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    const text = String(value);
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10).replaceAll('-', '/') : DASH;
  }
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(parsed));
}
export function shanghaiDate(value = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function addIsoDays(isoDate, days) {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function sparkline(snapshots, keys) {
  const ordered = [...(snapshots ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const vals = ordered.map(snap => keys.map(key => snap.metrics?.[key]).find(value => value !== null && value !== undefined)).filter(value => value !== undefined);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  return vals.map((value, index) => `${(index * 100 / (vals.length - 1)).toFixed(1)},${(28 - (value - min) * 24 / span).toFixed(1)}`).join(' ');
}
export function sparklinePaths(snapshots, keys) {
  const line = sparkline(snapshots, keys);
  if (!line) return null;
  const pairs = line.split(' ');
  const firstX = pairs[0].split(',')[0];
  const lastX = pairs[pairs.length - 1].split(',')[0];
  return { line, area: `${firstX},30 ${line} ${lastX},30` };
}
export function sparklineFromSeries(series, { width = 100, height = 30, pad = 2 } = {}) {
  if (!series?.values) return null;
  const points = series.values.map((value, index) => (value === null || value === undefined ? null : { index, value })).filter(Boolean);
  if (points.length < 2) return null;
  const min = Math.min(...points.map(point => point.value));
  const max = Math.max(...points.map(point => point.value));
  const span = max - min || 1;
  const lastIndex = Math.max(series.values.length - 1, 1);
  const line = points.map(point => `${(point.index * width / lastIndex).toFixed(1)},${(height - pad - (point.value - min) * (height - pad * 2) / span).toFixed(1)}`).join(' ');
  const pairs = line.split(' ');
  const firstX = pairs[0].split(',')[0];
  const lastX = pairs[pairs.length - 1].split(',')[0];
  return { line, area: `${firstX},${height} ${line} ${lastX},${height}` };
}
export function sortContentsByPlays(contents) {
  return sortContentsBy(contents, 'plays');
}
export function contentTime(content) {
  const value = content?.publishedAt || content?.sourceAsOf;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
export function engagementTotal(contents) {
  const keys = ['likes', 'comments', 'shares', 'collects'];
  let total = 0, found = false;
  for (const content of contents ?? []) {
    const metrics = content.metrics ?? {};
    for (const key of keys) {
      if (metrics[key] !== null && metrics[key] !== undefined && Number.isFinite(Number(metrics[key]))) {
        total += Number(metrics[key]);
        found = true;
      }
    }
  }
  return found ? total : null;
}
export function sortContentsBy(contents, mode = 'plays') {
  const rank = content => {
    if (mode === 'engagement') return engagementTotal([content]);
    if (mode === 'published') return contentTime(content);
    return metricTotal([content], ['plays', 'views']);
  };
  return [...(contents ?? [])].sort((a, b) => {
    const av = rank(a), bv = rank(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}
export function countPublished(contents) {
  return (contents ?? []).filter(content => content.status === 'published' || content.status === 'public').length;
}
export function countHealthyPlatforms(rows) {
  const seen = new Set();
  let count = 0;
  for (const row of rows ?? []) {
    const id = row.platform?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (row.platform.login?.state === 'green') count += 1;
  }
  return count;
}
export function unwrapMetric(value) {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'object' && value !== null && 'value' in value ? value.value : value;
  return raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw);
}
export function platformFollowers(platform) {
  const metrics = platform?.accountMetrics ?? platform?.metrics ?? {};
  const candidates = [metrics.totalSubscriptions, metrics.followers, metrics.fans, metrics.subscribers, platform?.followers, platform?.fans, platform?.subscribers];
  for (const candidate of candidates) {
    const value = unwrapMetric(candidate);
    if (value !== null) return value;
  }
  return null;
}
export function metricWindowChange(contents, keys, days = 7, now = Date.now()) {
  const end = shanghaiDate(now);
  const start = addIsoDays(end, -(Number(days) - 1));
  let total = 0, found = false;
  for (const content of contents ?? []) {
    const snaps = [...(content.daily_snapshots ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date))).filter(snap => snap.date && snap.date >= start && snap.date <= end);
    let change = 0, has = false;
    for (const snap of snaps) {
      const key = keys.find(candidate => snap.deltas?.[candidate] !== null && snap.deltas?.[candidate] !== undefined);
      if (key) { change += Number(snap.deltas[key]); has = true; }
    }
    if (!has && snaps.length >= 2) {
      const first = keys.map(key => snaps[0].metrics?.[key]).find(value => value !== null && value !== undefined);
      const last = keys.map(key => snaps[snaps.length - 1].metrics?.[key]).find(value => value !== null && value !== undefined);
      if (first !== undefined && last !== undefined) { change = Number(last) - Number(first); has = true; }
    }
    if (has) { total += change; found = true; }
  }
  return found ? total : null;
}
export function aggregateDailySeries(contents, keys, days = 7, now = Date.now()) {
  const end = shanghaiDate(now);
  const start = addIsoDays(end, -(Number(days) - 1));
  const totals = new Map();
  for (const content of contents ?? []) {
    for (const snap of content.daily_snapshots ?? []) {
      if (!snap.date || snap.date < start || snap.date > end) continue;
      const value = keys.map(key => snap.metrics?.[key]).find(candidate => candidate !== null && candidate !== undefined);
      if (value === undefined) continue;
      totals.set(snap.date, (totals.get(snap.date) ?? 0) + Number(value));
    }
  }
  const dates = [];
  const values = [];
  const length = Number(days);
  for (let index = 0; index < length; index += 1) {
    const date = addIsoDays(start, index);
    dates.push(date);
    values.push(totals.has(date) ? totals.get(date) : null);
  }
  return values.some(value => value !== null) ? { dates, values } : null;
}
export function parseOpsRoute(hash = '') {
  const parts = String(hash).replace(/^#/, '').split('/').map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  }).filter(Boolean);
  if (parts[0] === 'project' && parts[1] && parts[2] === 'platform' && parts[3]) {
    return { view: 'platform', project: parts[1], platform: parts[3] };
  }
  if (parts[0] === 'project' && parts[1]) {
    return { view: 'overview', project: parts[1], platform: null };
  }
  return { view: 'overview', project: 'all', platform: null };
}
export function buildOpsHash({ view = 'overview', project = 'all', platform } = {}) {
  const projectId = project || 'all';
  if (view === 'platform' && platform) return `#/project/${encodeURIComponent(projectId)}/platform/${encodeURIComponent(platform)}`;
  if (projectId !== 'all') return `#/project/${encodeURIComponent(projectId)}`;
  return '#/';
}
export function recommendationsForPlatform(data, platformId, projectId = 'all') {
  const items = data?.recommendations ?? [];
  if (!platformId) return [];
  const label = Object.fromEntries(CORE_PLATFORMS)[platformId] || platformId;
  const relatedRules = new Set(
    (data?.diagnostics ?? [])
      .filter(item => item.platform === platformId && (projectId === 'all' || item.projectId === projectId || !item.projectId))
      .map(item => item.ruleId)
      .filter(Boolean),
  );
  return items.filter(item => {
    if (item.platform === platformId || item.platformId === platformId) return true;
    const rules = Array.isArray(item.ruleIds) ? item.ruleIds : [item.ruleIds].filter(Boolean);
    if (rules.some(rule => relatedRules.has(rule))) return true;
    const text = `${item.title ?? ''}${item.detail ?? ''}`;
    return text.includes(label);
  });
}
