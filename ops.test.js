import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildTrend, cardTrend, collectionFreshness, consecutiveCollectionDays, contentDailyTable,
  contentEngagementRate, countHealthyPlatforms, countPublished, dayNet, metricTotal, normalizeIsoDate,
  presentWorkFields, projectHasCollectedData, yesterdayChange, collectPlatformRows,
} from './format.js';
import { selectRecommendations, TREND_MIN_DAYS } from './strategy.js';

const NOW = Date.parse('2026-11-28T04:00:00Z');

function days(list) {
  return list.map(item => ({ date: item.date, metrics: item.metrics ?? {}, deltas: item.deltas ?? {} }));
}
function content(partial) {
  return { title: partial.title ?? '作品', status: 'published', metrics: partial.metrics ?? {}, daily_snapshots: days(partial.days ?? []), publishedAt: partial.publishedAt ?? null, url: partial.url };
}
function dataOf(platforms, project = { id: 'shangye-chenfu-lu', title: '商业沉浮录', status: 'running' }) {
  return { generatedAt: '2026-11-27T18:00:00+08:00', projects: [{ ...project, accounts: [{ platforms }] }] };
}
function platform(id, contents, login = { state: 'green', asOf: '2026-11-27T21:00:00+08:00' }) {
  return { id, login, contents };
}

test('上海时区：UTC 下午算第二天，纯日期不挪一天', () => {
  assert.equal(normalizeIsoDate('2026-11-27T16:30:00Z'), '2026-11-28');
  assert.equal(normalizeIsoDate('2026-11-27T15:00:00Z'), '2026-11-27');
  assert.equal(normalizeIsoDate('2026-11-27'), '2026-11-27');
  assert.equal(normalizeIsoDate('2026-11-27 21:41'), '2026-11-27');
});

test('快照日期早于今天就停更，今天采过则不告警', () => {
  const rows = [{ platform: { sourceAsOf: '2026-11-27T15:00:00Z' }, contents: [] }];
  assert.deepEqual(collectionFreshness(rows, { now: NOW }), { stale: true, latest: '2026-11-27', today: '2026-11-28' });
  const fresh = [{ platform: { sourceAsOf: '2026-11-27T16:30:00Z' }, contents: [] }];
  assert.equal(collectionFreshness(fresh, { now: NOW }).stale, false);
  assert.equal(collectionFreshness([], { now: NOW }).stale, false);
});

test('没有昨日快照时不拿更早的差额顶上', () => {
  const contents = [content({ days: [{ date: '2026-11-25', metrics: { plays: 10 }, deltas: { plays: 10 } }] })];
  const change = yesterdayChange(contents, ['plays'], NOW);
  assert.equal(change.status, 'missing');
  assert.equal(change.date, '2026-11-27');
  assert.equal(change.value, null);
});

test('昨日快照优先用净增，没有净增就用读数相减', () => {
  const withDelta = [content({ days: [
    { date: '2026-11-26', metrics: { plays: 100 } },
    { date: '2026-11-27', metrics: { plays: 140 }, deltas: { plays: 40 } },
  ] })];
  assert.equal(yesterdayChange(withDelta, ['plays'], NOW).value, 40);
  const diffOnly = [content({ days: [
    { date: '2026-11-26', metrics: { plays: 100 } },
    { date: '2026-11-27', metrics: { plays: 130 } },
  ] })];
  assert.equal(dayNet(diffOnly, ['plays'], '2026-11-27'), 30);
});

test('连续日只算到最近一段，中间断开就重新数', () => {
  const contents = [content({ days: [{ date: '2026-11-25' }, { date: '2026-11-27' }] })];
  assert.equal(consecutiveCollectionDays(contents), 1);
  const streak = [content({ days: [{ date: '2026-11-25' }, { date: '2026-11-26' }, { date: '2026-11-27' }] })];
  assert.equal(consecutiveCollectionDays(streak), 3);
});

test('没有昨日快照不画走势；有昨日且至少两天才有线', () => {
  const keys = ['plays'];
  const old = [content({ days: [{ date: '2026-11-25', metrics: { plays: 1 }, deltas: { plays: 1 } }, { date: '2026-11-26', metrics: { plays: 2 }, deltas: { plays: 1 } }] })];
  assert.equal(cardTrend(old, keys, NOW).status, 'missing');
  const live = [content({ days: [{ date: '2026-11-26', metrics: { plays: 2 }, deltas: { plays: 1 } }, { date: '2026-11-27', metrics: { plays: 5 }, deltas: { plays: 3 } }] })];
  const trend = cardTrend(live, keys, NOW);
  assert.equal(trend.status, 'ok');
  assert.equal(trend.start, '2026-11-26');
  assert.equal(trend.end, '2026-11-27');
  assert.ok(trend.paths?.line);
  const one = [content({ days: [{ date: '2026-11-27', metrics: { plays: 5 }, deltas: { plays: 5 } }] })];
  assert.equal(cardTrend(one, keys, NOW).paths, null);
});

test('趋势默认按日给净增，7 日只是窗口', () => {
  const contents = [content({ days: [
    { date: '2026-11-20', metrics: { plays: 10 }, deltas: { plays: 10 } },
    { date: '2026-11-27', metrics: { plays: 12 }, deltas: { plays: 2 } },
  ] })];
  const daily = buildTrend(contents, ['plays'], 'daily', NOW);
  assert.deepEqual(daily.dates, ['2026-11-20', '2026-11-27']);
  assert.deepEqual(daily.nets, [10, 2]);
  const week = buildTrend(contents, ['plays'], 7, NOW);
  assert.deepEqual(week.dates, ['2026-11-27']);
  assert.deepEqual(week.nets, [2]);
});

test('作品只留下有数的字段，并补互动率；每日明细不铺空列', () => {
  const item = content({
    metrics: { plays: 200, likes: 2, comments: 0 },
    days: [{ date: '2026-11-27', metrics: { plays: 200, likes: 2 }, deltas: { followersGained: 1 } }],
  });
  const fields = presentWorkFields(item).map(field => field.label);
  assert.ok(fields.includes('播放'));
  assert.ok(fields.includes('互动率'));
  assert.equal(fields.includes('阅读'), false);
  assert.equal(fields.includes('收藏'), false);
  assert.equal(contentEngagementRate(item), 0.01);
  const table = contentDailyTable(item);
  assert.deepEqual(table.columns.map(column => column.label), ['播放', '赞', '净增粉']);
});

test('指标只在日快照里时也能汇总，不把空指标当成 0', () => {
  const item = content({ metrics: {}, days: [{ date: '2026-11-27', metrics: { views: 8 } }] });
  assert.equal(metricTotal([item], ['plays', 'views']), 8);
  assert.equal(metricTotal([content({ metrics: {}, days: [] })], ['plays']), null);
});

test('样本不足只留登录和缺位，不把低点击率伪装成策略', () => {
  const poor = content({
    title: '新发的一条',
    metrics: { plays: 400, impressions: 548, ctr: 0.006, likes: 2, comments: 0 },
    days: [{ date: '2026-11-27', metrics: { plays: 400 }, deltas: { plays: 400 } }],
  });
  const result = selectRecommendations({
    data: dataOf([
      platform('youtube', [poor]),
      platform('douyin', [], { state: 'red', asOf: '2026-11-27T21:41:00+08:00' }),
      platform('bilibili', []),
    ]),
    now: NOW,
    limit: 6,
  });
  assert.equal(result.notice, `连续采集未满 ${TREND_MIN_DAYS} 天，今日只提示登录/缺位，不出趋势判断`);
  assert.equal(result.items.some(item => item.kindLabel === '点击率'), false);
  assert.equal(result.items.some(item => item.kindLabel === '登录'), true);
  assert.equal(result.items.some(item => item.kindLabel === '缺位' && item.title.includes('B站')), true);
  assert.equal(JSON.stringify(result).includes('ruleId'), false);
});

test('日数据够了才按当前快照点名，不照顾写死的那一集', () => {
  const healthy = content({
    title: '第2集 上',
    metrics: { plays: 400, impressions: 500, ctr: 0.08, likes: 40, comments: 6 },
    days: ['2026-11-25', '2026-11-26', '2026-11-27'].map(date => ({ date, metrics: { plays: 400 }, deltas: { plays: 20 } })),
  });
  const weak = content({
    title: '第3集 上',
    metrics: { plays: 80, impressions: 600, ctr: 0.004, likes: 1, comments: 0 },
    days: ['2026-11-25', '2026-11-26', '2026-11-27'].map(date => ({ date, metrics: { plays: 80 }, deltas: { plays: 5 } })),
  });
  const result = selectRecommendations({ data: dataOf([platform('youtube', [healthy, weak])]), now: NOW, limit: 6 });
  const text = JSON.stringify(result);
  assert.equal(result.notice, null);
  assert.equal(text.includes('第3集'), true);
  assert.equal(text.includes('600'), true);
  assert.equal(text.includes('第2集'), false);
  assert.equal(result.items.some(item => item.kindLabel === '点击率'), true);
  assert.equal('ruleId' in result.items[0], false);
});

test('展示太小的点击率不出判断', () => {
  const tiny = content({
    title: '样本很小',
    metrics: { plays: 6, impressions: 4, ctr: 0.25 },
    days: ['2026-11-25', '2026-11-26', '2026-11-27'].map(date => ({ date, metrics: { plays: 6 }, deltas: { plays: 1 } })),
  });
  const result = selectRecommendations({ data: dataOf([platform('youtube', [tiny])]), now: NOW, limit: 6 });
  assert.equal(result.items.some(item => item.kindLabel === '点击率'), false);
});

test('起飞和长尾都用快照里的净增，发布未满 5 天不算长尾', () => {
  const rising = content({
    title: '正在起来的一条',
    publishedAt: '2026-11-25',
    metrics: { plays: 500, likes: 40, comments: 4 },
    days: [
      { date: '2026-11-25', metrics: { plays: 100 }, deltas: { plays: 10 } },
      { date: '2026-11-26', metrics: { plays: 110 }, deltas: { plays: 10 } },
      { date: '2026-11-27', metrics: { plays: 150 }, deltas: { plays: 40 } },
    ],
  });
  const steady = content({
    title: '还在慢慢涨',
    publishedAt: '2026-11-20',
    metrics: { plays: 200, likes: 20, comments: 2 },
    days: [
      { date: '2026-11-25', metrics: { plays: 40 }, deltas: { plays: 4 } },
      { date: '2026-11-26', metrics: { plays: 44 }, deltas: { plays: 4 } },
      { date: '2026-11-27', metrics: { plays: 48 }, deltas: { plays: 4 } },
    ],
  });
  const young = content({
    title: '才发两天',
    publishedAt: '2026-11-26',
    metrics: { plays: 90, likes: 9, comments: 1 },
    days: [
      { date: '2026-11-25', metrics: { plays: 10 }, deltas: { plays: 4 } },
      { date: '2026-11-26', metrics: { plays: 20 }, deltas: { plays: 4 } },
      { date: '2026-11-27', metrics: { plays: 30 }, deltas: { plays: 4 } },
    ],
  });
  const result = selectRecommendations({ data: dataOf([platform('douyin', [rising, steady, young])]), now: NOW, limit: 8 });
  assert.equal(result.items.some(item => item.kindLabel === '起飞'), true);
  assert.equal(result.items.some(item => item.kindLabel === '长尾' && item.detail.includes('2026-11-20')), true);
  assert.equal(result.items.some(item => item.title.includes('才发两天') && item.kindLabel === '长尾'), false);
});

test('总览按项目收，平台页不串到别的平台', () => {
  const clip = content({
    title: '低点击',
    metrics: { plays: 200, impressions: 300, ctr: 0.004, likes: 20, comments: 2 },
    days: ['2026-11-25', '2026-11-26', '2026-11-27'].map(date => ({ date, metrics: { plays: 200 }, deltas: { plays: 8 } })),
  });
  const data = {
    projects: [
      { id: 'shangye-chenfu-lu', title: '商业沉浮录', accounts: [{ platforms: [platform('youtube', [clip])] }] },
      { id: 'other', title: '另一个号', accounts: [{ platforms: [platform('douyin', [clip])] }] },
    ],
  };
  const overview = selectRecommendations({ data, projectId: 'shangye-chenfu-lu', now: NOW, limit: 6 });
  assert.equal(overview.items.every(item => item.title.startsWith('YouTube')), true);
  const page = selectRecommendations({ data, projectId: 'all', platformId: 'douyin', now: NOW, limit: 6 });
  assert.equal(page.items.every(item => item.title.includes('抖音')), true);
  assert.equal(page.items.some(item => item.title.includes('YouTube')), false);
  const pending = selectRecommendations({ data, projectId: 'huangjing-content', now: NOW });
  assert.equal(pending.notice, '该项目仍为待接入，没有可判断的日数据。');
  assert.deepEqual(pending.items, []);
});

test('没有作品也没有粉丝的占位项目不进入总览，也不计入健康平台和已上线', () => {
  const empty = {
    id: 'huangjing-content', title: '黄精内容号', status: 'pending',
    accounts: [{ platforms: [{ id: 'xiaohongshu', login: { state: 'neutral' }, contents: [] }] }],
  };
  const namedOnly = {
    id: 'x-personal-t116350650', title: 'X 个人号 @t116350650', status: 'pending',
    accounts: [{ platforms: [{ id: 'x', contents: [] }] }],
  };
  const live = {
    id: 'shangye-chenfu-lu', title: '商业沉浮录', status: 'running',
    accounts: [{ platforms: [
      { id: 'douyin', login: { state: 'green' }, contents: [{ title: '已上线', status: 'published', metrics: { plays: 12 } }] },
      { id: 'bilibili', login: { state: 'green' }, contents: [] },
    ] }],
  };
  assert.equal(projectHasCollectedData(empty), false);
  assert.equal(projectHasCollectedData(namedOnly), false);
  assert.equal(projectHasCollectedData(live), true);
  const rows = collectPlatformRows({ projects: [empty, namedOnly, live].filter(projectHasCollectedData) });
  assert.equal(countPublished(rows.flatMap(row => row.contents)), 1);
  assert.equal(countHealthyPlatforms(rows), 2);
  assert.equal(new Set(rows.map(row => row.project.id)).has('huangjing-content'), false);
  assert.equal(new Set(rows.map(row => row.project.id)).has('x-personal-t116350650'), false);
});

test('源码不再把未接入项目写进切换和总览', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.equal(app.includes('PENDING_PROJECTS'), false);
  assert.equal(app.includes('X 个人号'), false);
  assert.equal(app.includes('黄精内容号'), false);
});

test('源码不再写死某一集，界面路径不再渲染规则编号', () => {
  const strategy = readFileSync(new URL('./strategy.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const format = readFileSync(new URL('./format.js', import.meta.url), 'utf8');
  for (const source of [strategy, app, format]) {
    assert.equal(source.includes('第2集'), false);
    assert.equal(source.includes('548'), false);
  }
  assert.equal(app.includes('ruleIds'), false);
  assert.equal(app.includes('近7日'), false);
});
