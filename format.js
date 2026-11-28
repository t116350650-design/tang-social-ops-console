export const CORE_PLATFORMS = [
  ['douyin', '抖音'], ['shipinhao', '视频号'], ['wechat_mp', '公众号'],
  ['youtube', 'YouTube'], ['xiaoyuzhou', '小宇宙'], ['ximalaya', '喜马拉雅'], ['bilibili', 'B站'],
];
export const DASH = '—';
export function formatMetric(value, suffix = '') {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? DASH : `${Number(value).toLocaleString('zh-CN')}${suffix}`;
}
export const RATIO_KEYS = ['ctr', 'completionRate', 'avgPlayShare', 'retain5s', 'engagementRate'];
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

export function metricValue(content, keys) {
  const metrics = content?.metrics ?? {};
  const direct = keys.find(key => metrics[key] !== null && metrics[key] !== undefined && metrics[key] !== '');
  if (direct) {
    const value = Number(metrics[direct]);
    return Number.isFinite(value) ? value : null;
  }
  const snaps = [...(content?.daily_snapshots ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (let index = snaps.length - 1; index >= 0; index -= 1) {
    const snapMetrics = snaps[index]?.metrics ?? {};
    const key = keys.find(candidate => snapMetrics[candidate] !== null && snapMetrics[candidate] !== undefined && snapMetrics[candidate] !== '');
    if (!key) continue;
    const value = Number(snapMetrics[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}
export function metricTotal(contents, keys) {
  let total = 0, found = false;
  for (const content of contents ?? []) {
    const value = metricValue(content, keys);
    if (value !== null) { total += value; found = true; }
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
export function projectHasCollectedData(project) {
  const rows = collectPlatformRows({ projects: [project] });
  for (const row of rows) {
    if ((row.contents ?? []).length) return true;
    if (platformFollowers(row.platform) !== null) return true;
  }
  return false;
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
    for (const key of keys) {
      const value = metricValue(content, [key]);
      if (value !== null) { total += value; found = true; }
    }
  }
  return found ? total : null;
}
export function contentEngagementRate(content) {
  const base = metricValue(content, ['plays', 'views', 'reads']);
  if (base === null || base <= 0) return null;
  const engagement = engagementTotal([content]);
  if (engagement === null) return null;
  return engagement / base;
}
export function portfolioEngagementRate(contents, keys = ['plays', 'views', 'reads']) {
  const base = metricTotal(contents, keys);
  const engagement = engagementTotal(contents);
  if (base === null || base <= 0 || engagement === null) return null;
  return engagement / base;
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
export function normalizeIsoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  if (text.includes('T') || /[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return shanghaiDate(parsed);
  }
  return day;
}
export function shortDate(value) {
  const day = normalizeIsoDate(value);
  return day ? `${day.slice(5, 7)}-${day.slice(8, 10)}` : '';
}
export function orderedSnaps(content) {
  const byDay = new Map();
  for (const snap of content?.daily_snapshots ?? []) {
    const date = normalizeIsoDate(snap?.date);
    if (date) byDay.set(date, snap);
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, snap]) => ({ date, snap }));
}
function snapNumber(bag, keys) {
  if (!bag) return null;
  const key = keys.find(candidate => bag[candidate] !== null && bag[candidate] !== undefined && bag[candidate] !== '');
  if (!key) return null;
  const value = Number(bag[key]);
  return Number.isFinite(value) ? value : null;
}
export function snapshotDates(contents) {
  const dates = new Set();
  for (const content of contents ?? []) for (const item of orderedSnaps(content)) dates.add(item.date);
  return [...dates].sort();
}
export function consecutiveCollectionDays(contents) {
  const dates = snapshotDates(contents);
  if (!dates.length) return 0;
  let streak = 1;
  for (let index = dates.length - 1; index > 0; index -= 1) {
    if (dates[index - 1] === addIsoDays(dates[index], -1)) streak += 1;
    else break;
  }
  return streak;
}
export function hasSnapshotOn(contents, isoDate) {
  return snapshotDates(contents).includes(isoDate);
}
export function dayNet(contents, keys, isoDate) {
  let total = 0, found = false;
  for (const content of contents ?? []) {
    const snaps = orderedSnaps(content);
    const index = snaps.findIndex(item => item.date === isoDate);
    if (index < 0) continue;
    const delta = snapNumber(snaps[index].snap?.deltas, keys);
    if (delta !== null) { total += delta; found = true; continue; }
    if (index > 0) {
      const current = snapNumber(snaps[index].snap?.metrics, keys);
      const previous = snapNumber(snaps[index - 1].snap?.metrics, keys);
      if (current !== null && previous !== null) { total += current - previous; found = true; }
    }
  }
  return found ? total : null;
}
export function yesterdayChange(contents, keys, now = Date.now()) {
  const date = addIsoDays(shanghaiDate(now), -1);
  if (!hasSnapshotOn(contents, date)) return { status: 'missing', date, value: null };
  return { status: 'ok', date, value: dayNet(contents, keys, date) };
}
export function followerSnapshots(platform) {
  const lists = [platform?.daily_snapshots, platform?.accountMetrics?.daily_snapshots];
  return lists.find(list => Array.isArray(list) && list.length) ?? [];
}
export function yesterdayFollowers(platform, contents, now = Date.now()) {
  const fromWorks = yesterdayChange(contents, ['followersGained'], now);
  if (fromWorks.status === 'ok' && fromWorks.value !== null) return fromWorks;
  const extra = followerSnapshots(platform);
  if (!extra.length) return fromWorks;
  return yesterdayChange([{ daily_snapshots: extra }], ['followersGained', 'fans', 'followers'], now);
}
export function aggregateDailyNet(contents, keys, { days = null, now = Date.now() } = {}) {
  const end = shanghaiDate(now);
  const start = days == null ? null : addIsoDays(end, -(Number(days) - 1));
  const totals = new Map();
  for (const content of contents ?? []) {
    const snaps = orderedSnaps(content);
    snaps.forEach((item, index) => {
      if (item.date > end || (start && item.date < start)) return;
      let net = snapNumber(item.snap?.deltas, keys);
      if (net === null && index > 0) {
        const current = snapNumber(item.snap?.metrics, keys);
        const previous = snapNumber(snaps[index - 1].snap?.metrics, keys);
        if (current !== null && previous !== null) net = current - previous;
      }
      const level = snapNumber(item.snap?.metrics, keys);
      const bucket = totals.get(item.date) ?? { net: null, level: null };
      if (net !== null) bucket.net = (bucket.net ?? 0) + net;
      if (level !== null) bucket.level = (bucket.level ?? 0) + level;
      totals.set(item.date, bucket);
    });
  }
  const dates = [...totals.keys()].sort();
  if (!dates.length) return null;
  return { dates, nets: dates.map(date => totals.get(date).net), levels: dates.map(date => totals.get(date).level) };
}
export function cardTrend(contents, keys, now = Date.now()) {
  const yesterday = addIsoDays(shanghaiDate(now), -1);
  if (!hasSnapshotOn(contents, yesterday)) return { status: 'missing', yesterday };
  const series = aggregateDailyNet(contents, keys, { days: null, now });
  if (!series) return { status: 'missing', yesterday };
  const netCount = series.nets.filter(value => value !== null).length;
  const levelCount = series.levels.filter(value => value !== null).length;
  const values = netCount >= 2 ? series.nets : series.levels;
  const paths = netCount >= 2 || levelCount >= 2 ? sparklineFromSeries({ values }, { width: 100, height: 30, pad: 2 }) : null;
  const index = series.dates.indexOf(yesterday);
  return { status: 'ok', yesterday, start: series.dates[0], end: series.dates.at(-1), paths, yesterdayNet: index >= 0 ? series.nets[index] : null };
}
export function buildTrend(contents, keys, mode = 'daily', now = Date.now()) {
  const days = mode === 'daily' || mode == null || mode === '' ? null : Number(mode);
  const series = aggregateDailyNet(contents, keys, { days, now });
  if (!series) return null;
  const netCount = series.nets.filter(value => value !== null).length;
  const values = netCount >= 2 ? series.nets : series.levels;
  const paths = sparklineFromSeries({ values }, { width: 100, height: 40, pad: 4 });
  return { ...series, paths, usesNet: netCount >= 2 };
}
export const WORK_FIELDS = [
  { id: 'plays', keys: ['plays', 'views'], label: '播放' },
  { id: 'reads', keys: ['reads'], label: '阅读' },
  { id: 'likes', keys: ['likes'], label: '点赞' },
  { id: 'comments', keys: ['comments'], label: '评论' },
  { id: 'shares', keys: ['shares'], label: '分享' },
  { id: 'collects', keys: ['collects'], label: '收藏' },
  { id: 'impressions', keys: ['impressions'], label: '曝光' },
  { id: 'completionRate', keys: ['completionRate'], label: '完播率', ratio: true },
  { id: 'ctr', keys: ['ctr'], label: '点击率', ratio: true },
  { id: 'avgPlayShare', keys: ['avgPlayShare'], label: '平均播放占比', ratio: true },
  { id: 'retain5s', keys: ['retain5s'], label: '5秒留存', ratio: true },
  { id: 'recommends', keys: ['recommends'], label: '推荐' },
];
export function presentWorkFields(content) {
  const fields = [];
  for (const field of WORK_FIELDS) {
    const value = metricValue(content, field.keys);
    if (value === null) continue;
    fields.push({ ...field, value });
  }
  const rate = contentEngagementRate(content);
  if (rate !== null) fields.push({ id: 'engagementRate', label: '互动率', value: rate, ratio: true });
  return fields;
}
const DAY_COLUMNS = [
  { id: 'plays', label: '播放', keys: ['plays', 'views'], source: 'metric' },
  { id: 'reads', label: '阅读', keys: ['reads'], source: 'metric' },
  { id: 'likes', label: '赞', keys: ['likes'], source: 'metric' },
  { id: 'comments', label: '评', keys: ['comments'], source: 'metric' },
  { id: 'collects', label: '藏', keys: ['collects'], source: 'metric' },
  { id: 'shares', label: '转', keys: ['shares'], source: 'metric' },
  { id: 'fans', label: '净增粉', keys: ['followersGained'], source: 'delta' },
  { id: 'completionRate', label: '完播', keys: ['completionRate'], source: 'metric', ratio: true },
  { id: 'ctr', label: '点击', keys: ['ctr'], source: 'metric', ratio: true },
];
export function contentDailyTable(content) {
  const snaps = orderedSnaps(content);
  if (!snaps.length) return null;
  const rows = snaps.map(item => {
    const cells = { date: item.date };
    for (const column of DAY_COLUMNS) {
      cells[column.id] = column.source === 'delta'
        ? snapNumber(item.snap?.deltas, column.keys)
        : snapNumber(item.snap?.metrics, column.keys);
    }
    return cells;
  });
  const columns = DAY_COLUMNS.filter(column => rows.some(row => row[column.id] !== null));
  if (!columns.length) return null;
  return { columns, rows };
}
export function collectionFreshness(rows, { generatedAt = null, now = Date.now() } = {}) {
  const today = shanghaiDate(now);
  const dates = [];
  const push = value => {
    const day = normalizeIsoDate(value);
    if (day) dates.push(day);
  };
  push(generatedAt);
  for (const row of rows ?? []) {
    push(row.platform?.login?.asOf);
    push(row.platform?.sourceAsOf);
    for (const content of row.contents ?? []) {
      push(content.sourceAsOf);
      for (const snap of content.daily_snapshots ?? []) push(snap.date);
    }
  }
  if (!dates.length) return { stale: false, latest: null, today };
  const latest = dates.sort().at(-1);
  return { stale: latest < today, latest, today };
}
