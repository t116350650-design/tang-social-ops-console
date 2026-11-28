import {
  CORE_PLATFORMS, addIsoDays, aggregateDailyNet, consecutiveCollectionDays,
  engagementTotal, formatField, formatMetric, formatSigned, metricValue, normalizeIsoDate,
} from './format.js';

// 阈值是规则本身。文案里的作品名和读数只从当前快照填，不写死某一集。
export const TREND_MIN_DAYS = 3;
const PLATFORM_LABELS = Object.fromEntries(CORE_PLATFORMS);
const LOW_CTR = 0.03;
const CTR_MIN_IMPRESSIONS = 100;
const RETAIN_FLOOR = 0.6;
const COMPLETION_FLOOR = 0.3;
const AVG_PLAY_FLOOR = 0.05;
const PLAY_FLOOR = 50;
const ENGAGE_PLAY_FLOOR = 100;
const ENGAGE_RATE_FLOOR = 0.01;
const TAKEOFF_MULTIPLE = 2;
const LONG_TAIL_DAYS = 5;

function platformLabel(id) {
  return PLATFORM_LABELS[id] || '平台';
}
function workTitle(content) {
  const title = content?.title == null ? '' : String(content.title).trim();
  if (!title || title === '—' || title === '-') return '未采集到标题的作品';
  return title.length > 18 ? `${title.slice(0, 18)}…` : title;
}
function quoteWork(content) {
  const title = content?.title == null ? '' : String(content.title).trim();
  if (!title || title === '—' || title === '-') return '未采集到标题的作品';
  return `《${title}》`;
}
function primaryKeys(platformId) {
  return platformId === 'wechat_mp' ? ['reads', 'plays', 'views'] : ['plays', 'views', 'reads'];
}
function volumeUnit(platformId) {
  return platformId === 'wechat_mp' ? '阅读' : '播放';
}
function scopedProjects(data, projectId) {
  const projects = data?.projects ?? [];
  if (!projectId || projectId === 'all') return projects;
  return projects.filter(project => project.id === projectId || project.title === projectId);
}
function rowsOf(projects) {
  const rows = [];
  for (const project of projects ?? []) {
    for (const account of project.accounts ?? []) {
      for (const platform of account.platforms ?? []) rows.push({ project, platform, contents: platform.contents ?? [] });
    }
  }
  return rows;
}
function checkedAt(value) {
  const day = normalizeIsoDate(value);
  return day ? `最近检测 ${day}。` : '';
}
function loginItem(row, label) {
  const state = row.platform.login?.state;
  const when = checkedAt(row.platform.login?.asOf);
  if (state === 'red') {
    return { priority: 'high', score: 100, kindLabel: '登录', title: `${label}需要重新登录`, detail: `${label}登录态失效。${when}今天这组数不能拿来判断内容。` };
  }
  if (state === 'yellow') {
    return { priority: 'medium', score: 50, kindLabel: '登录', title: `${label}这次采集不完整`, detail: `${label}登录还在，但这次没有采全。${when}` };
  }
  return null;
}
function gapItem(row, rows, label) {
  if ((row.contents ?? []).length) return null;
  const state = row.platform.login?.state;
  if (state === 'red' || state === 'yellow') return null;
  const siblings = rows.some(other => other !== row && other.project?.id === row.project?.id && other.contents.length);
  if (state !== 'green' && !siblings) return null;
  return { priority: 'high', score: 90, kindLabel: '缺位', title: `${label}缺位`, detail: `${label}已经挂在当前项目下，但没有作品快照。补上之前不拿它做经营判断。` };
}
function trendItems(row, label, now) {
  const items = [];
  const keys = primaryKeys(row.platform.id);
  const unit = volumeUnit(row.platform.id);
  const series = aggregateDailyNet(row.contents, keys, { days: null, now });
  const points = series ? series.dates.map((date, index) => ({ date, net: series.nets[index] })).filter(point => point.net !== null) : [];
  if (points.length >= TREND_MIN_DAYS) {
    const latest = points[points.length - 1];
    const prior = points.slice(0, -1).slice(-6);
    if (prior.length >= 2) {
      const average = prior.reduce((sum, point) => sum + point.net, 0) / prior.length;
      if (average > 0 && latest.net > 0 && latest.net >= average * TAKEOFF_MULTIPLE) {
        items.push({
          priority: 'high', score: 80, kindLabel: '起飞',
          title: `${label}出现起飞`,
          detail: `${latest.date} 的${unit}净增是 ${formatSigned(latest.net)}，达到此前 ${prior.length} 个采集日均线 ${formatSigned(Math.round(average))} 的 ${TAKEOFF_MULTIPLE} 倍。顺着这条把高互动段落再切一条短的。`,
        });
      }
    }
  }
  for (const content of row.contents) {
    const impressions = metricValue(content, ['impressions']);
    const ctr = metricValue(content, ['ctr']);
    const plays = metricValue(content, ['plays', 'views', 'reads']);
    if (impressions !== null && impressions >= CTR_MIN_IMPRESSIONS && ctr !== null && ctr < LOW_CTR) {
      items.push({
        priority: 'high', score: 70 + (LOW_CTR - ctr) * 100, kindLabel: '点击率',
        title: `${label} ${workTitle(content)} 点击率偏低`,
        detail: `${quoteWork(content)}展示 ${formatMetric(impressions)}，点击率 ${formatField('ctr', ctr)}。人已经看见，点开的少，优先改封面和标题开头。`,
      });
    }
    const retain = metricValue(content, ['retain5s']);
    const completion = metricValue(content, ['completionRate']);
    const avgPlay = metricValue(content, ['avgPlayShare']);
    const base = plays ?? 0;
    if (base >= PLAY_FLOOR && retain !== null && retain < RETAIN_FLOOR) {
      items.push({
        priority: 'high', score: 60 + (RETAIN_FLOOR - retain) * 20, kindLabel: '留存',
        title: `${label} ${workTitle(content)} 留存偏低`,
        detail: `${quoteWork(content)}5 秒留存 ${formatField('retain5s', retain)}，低于 60%。先改开头钩子，完播等采到再判断中后段。`,
      });
    } else if (base >= PLAY_FLOOR && completion !== null && completion < COMPLETION_FLOOR) {
      items.push({
        priority: 'medium', score: 58, kindLabel: '留存',
        title: `${label} ${workTitle(content)} 完播偏低`,
        detail: `${quoteWork(content)}完播率 ${formatField('completionRate', completion)}。先收紧前段承诺，再看是不是中段拖了。`,
      });
    } else if (base >= PLAY_FLOOR && avgPlay !== null && avgPlay < AVG_PLAY_FLOOR) {
      items.push({
        priority: 'medium', score: 56, kindLabel: '留存',
        title: `${label} ${workTitle(content)} 平均播放占比偏低`,
        detail: `${quoteWork(content)}平均播放占比 ${formatField('avgPlayShare', avgPlay)}。先看封面进流和前几秒，完播还没采到之前不下中后段结论。`,
      });
    }
    const engagement = engagementTotal([content]);
    if (base >= ENGAGE_PLAY_FLOOR && engagement !== null && engagement / base < ENGAGE_RATE_FLOOR) {
      const likes = metricValue(content, ['likes']);
      const comments = metricValue(content, ['comments']);
      const likeText = likes === null ? '赞未采集到' : `赞 ${formatMetric(likes)}`;
      const commentText = comments === null ? '评论未采集到' : `评论 ${formatMetric(comments)}`;
      items.push({
        priority: 'medium', score: 40, kindLabel: '互动',
        title: `${label} ${workTitle(content)} 互动率偏低`,
        detail: `${quoteWork(content)}互动率 ${formatField('engagementRate', engagement / base)}，${likeText}，${commentText}。看的人没有接话，用一个具体问题做置顶。`,
      });
    }
    const own = aggregateDailyNet([content], keys, { days: null, now });
    if (!own) continue;
    const lastThree = own.nets.slice(-3);
    if (lastThree.length < 3 || lastThree.some(value => value === null || value <= 0)) continue;
    const firstDay = normalizeIsoDate(content.publishedAt) || own.dates[0];
    const lastDay = own.dates[own.dates.length - 1];
    if (!firstDay || addIsoDays(firstDay, LONG_TAIL_DAYS) > lastDay) continue;
    const prior = own.nets.slice(0, -1).filter(value => value !== null);
    const average = prior.length ? prior.reduce((sum, value) => sum + value, 0) / prior.length : 0;
    const latestNet = lastThree[lastThree.length - 1];
    if (average > 0 && latestNet >= average * TAKEOFF_MULTIPLE) continue;
    items.push({
      priority: 'medium', score: 30, kindLabel: '长尾',
      title: `${workTitle(content)}仍在长尾`,
      detail: `${quoteWork(content)}从 ${firstDay} 起已超过 5 天，最近 3 个采集日${unit}仍是正净增，最近一日 ${formatSigned(latestNet)}。可以置顶，或把高互动段落导到短视频。`,
    });
  }
  return items;
}

export function selectRecommendations({ data, projectId = 'all', platformId = null, now = Date.now(), limit = 3 } = {}) {
  const projects = scopedProjects(data, projectId);
  if (projectId && projectId !== 'all' && !projects.length) {
    return { notice: '该项目仍为待接入，没有可判断的日数据。', items: [] };
  }
  let rows = rowsOf(projects);
  if (platformId) rows = rows.filter(row => row.platform?.id === platformId);
  if (platformId && !rows.length) {
    return { notice: '该平台仍为待接入，没有可判断的日数据。', items: [] };
  }
  const multi = new Set(rows.map(row => row.project?.id).filter(Boolean)).size > 1;
  const items = [];
  let anyTrend = false;
  let anyShort = false;
  for (const row of rows) {
    const name = projectId === 'all' && multi && row.project?.title ? `${row.project.title}·${platformLabel(row.platform?.id)}` : platformLabel(row.platform?.id);
    const login = loginItem(row, name);
    if (login) items.push(login);
    const gap = gapItem(row, rows, name);
    if (gap) items.push(gap);
    const streak = consecutiveCollectionDays(row.contents);
    const blocked = row.platform?.login?.state === 'red';
    if (!blocked && row.contents.length && streak >= TREND_MIN_DAYS) {
      anyTrend = true;
      items.push(...trendItems(row, name, now));
    } else if (row.contents.length && streak < TREND_MIN_DAYS) anyShort = true;
  }
  items.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = `${item.kindLabel}|${item.title}|${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ title: item.title, detail: item.detail, priority: item.priority, kindLabel: item.kindLabel });
  }
  const notice = !anyTrend && anyShort
    ? `连续采集未满 ${TREND_MIN_DAYS} 天，今日只提示登录/缺位，不出趋势判断`
    : null;
  return { notice, items: unique.slice(0, Math.max(0, limit)) };
}
