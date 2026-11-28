import { decryptPwaEnvelope } from './crypto.js';
import {
  CORE_PLATFORMS, DASH, buildOpsHash, buildTrend, cardTrend, collectPlatformRows,
  collectionFreshness, contentDailyTable, countHealthyPlatforms, countPublished,
  engagementTotal, formatDateTime, formatField, formatMetric, formatSigned, latestAsOf,
  metricTotal, parseOpsRoute, platformFollowers, portfolioEngagementRate, presentWorkFields, projectHasCollectedData,
  ratioPercent, shortDate, sortContentsBy, summarizeRows, yesterdayChange, yesterdayFollowers,
} from './format.js';
import { selectRecommendations } from './strategy.js';

const $ = selector => document.querySelector(selector);
const state = {
  data: null,
  passphrase: null,
  project: 'all',
  view: 'overview',
  platform: null,
  trendDays: 'daily',
  workSort: 'plays',
  remembered: false,
  enteredFromOverview: false,
};
const PROJECT_ALIASES = {
  'shangye-chenfu-lu': '商业沉浮录',
};
const STATUS_LABELS = {
  published: '已发布', public: '已发布', draft: '草稿', reviewing: '审核中',
  scheduled: '定时发布', pending: '待发布', deleted: '已删除', private: '仅自己可见',
  published_in_review: '审核中已发布', private_draft_ready: '草稿已备好',
  filled_awaiting_click: '待点击发布', blocked: '被拦截', not_submitted: '未投稿',
  not_scheduled: '未排期', takedown: '已下架', unknown: '未知',
};
const LAMP_LABELS = { green: '正常', yellow: '待复核', red: '需登录', neutral: '未检测' };
const seenTicks = new Set();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function safeText(value) {
  return value === null || value === undefined || value === '' ? DASH : String(value);
}
function trStatus(value) { return STATUS_LABELS[value] || safeText(value); }
function trLamp(value) { return LAMP_LABELS[value] || safeText(value); }
function lampClass(value) { return ['green', 'yellow', 'red'].includes(value) ? value : ''; }
function tickClass(key, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
  const token = `${state.view}|${state.project}|${state.platform}|${key}|${value}`;
  if (seenTicks.has(token)) return '';
  seenTicks.add(token);
  return ' tick';
}
function numHtml(key, value, { signed = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return `<div class="num">${DASH}</div>`;
  const tone = signed ? (value > 0 ? ' up' : value < 0 ? ' down' : '') : '';
  return `<div class="num${tone}${tickClass(key, value)}">${signed ? formatSigned(value) : formatMetric(value)}</div>`;
}
function deltaLine(change) {
  if (!change || change.status === 'missing') return '<div class="delta-line missing"><span class="k">较上一日</span><span class="v">昨日未采到</span></div>';
  if (change.value === null || !Number.isFinite(Number(change.value))) return `<div class="delta-line flat"><span class="k">较上一日</span><span class="v">${DASH}</span></div>`;
  const n = Number(change.value);
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  return `<div class="delta-line ${cls}"><span class="k">较上一日</span><span class="v">${formatSigned(n)}</span></div>`;
}
function deltaHero(label, change, key) {
  if (!change || change.status === 'missing') return `<article class="hero-card"><div class="lab">${label}</div><div class="num missing-num">昨日未采到</div></article>`;
  const body = change.value === null ? `<div class="num">${DASH}</div>` : numHtml(key, change.value, { signed: true });
  return `<article class="hero-card"><div class="lab">${label}</div>${body}</article>`;
}
function collectedTitle(content) {
  const title = content?.title == null ? '' : String(content.title).trim();
  return !title || title === DASH || title === '-' ? '未采集到' : title;
}
function collectedTime(value) {
  if (value === null || value === undefined || value === '') return '未采集到';
  const text = formatDateTime(value);
  return text === DASH ? '未采集到' : text;
}
function platformLabel(id) {
  return Object.fromEntries(CORE_PLATFORMS)[id] || id;
}

function currentHash() {
  return location.hash || '#/';
}
function applyRoute(route, { scroll = true } = {}) {
  state.view = route.view === 'platform' && route.platform ? 'platform' : 'overview';
  state.project = route.project || 'all';
  state.platform = state.view === 'platform' ? route.platform : null;
  if (state.data) render();
  if (scroll) window.scrollTo(0, 0);
}
function navigate(route, { replace = false, scroll = true } = {}) {
  const hash = buildOpsHash(route);
  if (currentHash() === hash || (hash === '#/' && (currentHash() === '' || currentHash() === '#'))) {
    applyRoute(parseOpsRoute(hash), { scroll });
    return;
  }
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  applyRoute(parseOpsRoute(hash), { scroll });
}

function setUnlock(message = '') {
  $('#loading').hidden = true;
  $('#dashboard').hidden = true;
  $('#unlock').hidden = false;
  $('#lock').hidden = true;
  $('#unlockError').textContent = message;
}

async function fetchData(name) {
  const response = await fetch(`./${name}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${name} ${response.status}`);
  return name.endsWith('.json') ? response.json() : JSON.parse(await response.text());
}

async function loadSnapshot(passphrase = state.passphrase) {
  try {
    const envelope = await fetchData('data.enc.json');
    if (passphrase) {
      state.data = await decryptPwaEnvelope(envelope, passphrase);
      state.passphrase = passphrase;
      state.remembered = localStorage.getItem('ops-pwa-passphrase') === passphrase;
      showDashboard();
      return;
    }
    setUnlock();
  } catch (error) {
    if (error.name === 'OperationError' || error.message?.includes('OperationError')) {
      setUnlock('口令错误，未加载数据。');
      return;
    }
    if (error.message?.startsWith('data.enc.json')) {
      const localHost = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
      if (!localHost) { setUnlock('未找到加密快照。公网环境不会自动加载明文数据。'); return; }
      try { state.data = await fetchData('data.json'); state.passphrase = null; showDashboard(); return; }
      catch { setUnlock('未找到数据快照。'); return; }
    }
    setUnlock(error.message === '不支持的信封' ? '不支持的信封格式。' : '数据解密失败，未渲染任何数据。');
  }
}

function showDashboard() {
  $('#unlock').hidden = true;
  $('#loading').hidden = true;
  $('#dashboard').hidden = false;
  $('#lock').hidden = false;
  applyRoute(parseOpsRoute(location.hash), { scroll: state.view === 'platform' || Boolean(parseOpsRoute(location.hash).platform) });
}

function liveProjects() {
  return (state.data?.projects ?? []).filter(projectHasCollectedData);
}
function projectMatches(project, id) {
  return project.id === id || project.title === id;
}
function projectsForView() {
  const projects = liveProjects();
  if (state.project === 'all') return projects;
  return projects.filter(project => projectMatches(project, state.project));
}
function rowsForView() { return collectPlatformRows({ projects: projectsForView() }); }
function rowsForPlatform(platformId) {
  return rowsForView().filter(row => row.platform.id === platformId);
}

function renderProjects() {
  const entries = [['all', '全部项目']];
  for (const project of liveProjects()) entries.push([project.id, PROJECT_ALIASES[project.id] || project.title || project.id]);
  $('#projects').innerHTML = entries.map(([id, title]) => `<button type="button" data-project="${escapeHtml(id)}" class="${state.project === id ? 'selected' : ''}">${escapeHtml(title)}</button>`).join('');
  $('#projects').querySelectorAll('button').forEach(button => {
    button.onclick = () => navigate({ view: 'overview', project: button.dataset.project });
  });
}

function renderHero() {
  const rows = rowsForView();
  const contents = rows.flatMap(row => row.contents);
  const summary = summarizeRows(rows);
  const published = countPublished(contents);
  const healthy = countHealthyPlatforms(rows);
  const totalPlatforms = new Set(rows.map(row => row.platform?.id).filter(Boolean)).size;
  const playChange = yesterdayChange(contents, ['plays', 'views']);
  const readChange = yesterdayChange(contents, ['reads']);
  const readDelta = summary.reads === null ? '' : deltaLine(readChange);
  const cards = [
    `<article class="hero-card"><div class="lab">总播放 / 观看</div>${numHtml('hero-plays', summary.plays)}</article>`,
    deltaHero('播放较上一日', playChange, 'hero-play-delta'),
    `<article class="hero-card"><div class="lab">总阅读</div>${numHtml('hero-reads', summary.reads)}${readDelta}</article>`,
    `<article class="hero-card"><div class="lab">已上线作品</div>${numHtml('hero-published', published)}</article>`,
    `<article class="hero-card"><div class="lab">健康平台</div><div class="num${tickClass('hero-healthy', totalPlatforms ? healthy : null)}">${totalPlatforms ? `${healthy} / ${totalPlatforms}` : DASH}</div></article>`,
  ];
  $('#hero').innerHTML = cards.join('');
}

function projectMatrix() {
  const featured = liveProjects().map(project => {
    const rows = collectPlatformRows({ projects: [project] });
    const contents = rows.flatMap(row => row.contents);
    const summary = summarizeRows(rows);
    const published = countPublished(contents);
    const playChange = yesterdayChange(contents, ['plays', 'views']);
    const deltaText = playChange.status === 'missing' ? '昨日未采到' : (playChange.value === null ? DASH : formatSigned(playChange.value));
    return `<article class="featured" data-project="${escapeHtml(project.id)}" role="button" tabindex="0">
      <div class="status">已接入</div>
      <h3>${escapeHtml(PROJECT_ALIASES[project.id] || project.title || project.id)}</h3>
      <div class="num${tickClass(`proj-${project.id}`, summary.plays)}">${formatMetric(summary.plays)}</div>
      <div class="meta">
        <span>较上一日 ${escapeHtml(deltaText)}</span>
        <span>阅读 ${formatMetric(summary.reads)}</span>
        <span>已上线 ${formatMetric(published)}</span>
      </div>
    </article>`;
  }).join('');
  $('#projectCards').innerHTML = featured || '<div class="empty">暂无项目数据</div>';
  $('#projectCards').querySelectorAll('[data-project]').forEach(card => {
    const open = () => navigate({ view: 'overview', project: card.dataset.project });
    card.onclick = open;
    card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
  });
}

function sparkSvg(id, paths, { wide = false, stroke = '#35d49a' } = {}) {
  if (!paths) return '';
  const gid = `sparkFill-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const height = wide ? 40 : 30;
  return `<svg class="${wide ? 'trend-svg' : 'spark'}" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${stroke}" stop-opacity="0.38"/><stop offset="100%" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${paths.area}" fill="url(#${gid})"></polygon>
    <polyline points="${paths.line}" fill="none" stroke="${stroke}" stroke-width="${wide ? 1.4 : 1.7}" stroke-linejoin="round" stroke-linecap="round"></polyline>
  </svg>`;
}
function cardSpark(id, contents, keys) {
  const trend = cardTrend(contents, keys);
  if (!trend || trend.status !== 'ok') return '<div class="spark-empty">昨日未采到</div>';
  const stroke = trend.yesterdayNet < 0 ? '#ff6577' : '#35d49a';
  const start = shortDate(trend.start);
  const end = shortDate(trend.end);
  const range = start && start !== end ? `${start} → ${end}` : (start || end);
  return `${sparkSvg(id, trend.paths, { stroke })}<div class="spark-meta">${range}</div>`;
}

function platformStatus(matches) {
  const source = matches[0]?.platform;
  const lamp = source?.login?.state ?? 'neutral';
  if (!matches.length) return { lamp: 'neutral', text: '待接入', connected: false };
  if (lamp === 'red') return { lamp, text: '需登录', connected: true };
  if (lamp === 'yellow') return { lamp, text: '待补采', connected: true };
  if (lamp === 'green') return { lamp, text: matches.some(row => (row.contents ?? []).length) ? '已接入' : '缺位', connected: true };
  return { lamp, text: matches.some(row => (row.contents ?? []).length) ? '已接入' : '待接入', connected: Boolean(matches.length) };
}

function renderMarket() {
  const rows = rowsForView();
  const aliases = PROJECT_ALIASES[state.project];
  $('#scope').textContent = state.project === 'all' ? '已接入项目范围' : `当前项目：${aliases || state.project}`;
  const cards = CORE_PLATFORMS.map(([id, label]) => {
    const matches = rows.filter(row => row.platform.id === id);
    const contents = matches.flatMap(row => row.contents);
    const source = matches[0]?.platform;
    const primaryKeys = id === 'wechat_mp' ? ['reads'] : ['plays', 'views'];
    const primary = metricTotal(contents, primaryKeys);
    const primaryChange = yesterdayChange(contents, primaryKeys);
    const engagement = engagementTotal(contents);
    const followers = platformFollowers(source);
    const followerChange = yesterdayFollowers(source, contents);
    const status = platformStatus(matches);
    const primaryLabel = id === 'wechat_mp' ? '阅读' : '播放';
    const connected = matches.length > 0;
    const fanDelta = connected ? deltaLine(followerChange) : '';
    const volumeDelta = connected ? deltaLine(primaryChange) : '';
    const spark = connected ? cardSpark(id, contents, primaryKeys) : '<div class="spark-empty"></div>';
    return `<article class="quote" data-platform="${id}" role="button" tabindex="0">
      <div class="quote-head">
        <h3>${label}</h3>
        <div class="quote-status"><span class="lamp ${lampClass(status.lamp)}"></span><span class="capsule ${lampClass(status.lamp)}">${status.text}</span></div>
      </div>
      <div class="quote-metrics">
        <div><div class="metric-label">粉丝</div>${numHtml(`fans-${id}`, followers)}${fanDelta}</div>
        <div><div class="metric-label">${primaryLabel}</div>${numHtml(`vol-${id}`, primary)}${volumeDelta}<div class="metric-label">互动 ${formatMetric(engagement)}</div></div>
      </div>
      ${spark}
      <div class="quote-foot"><span>进入详情</span><span>→</span></div>
    </article>`;
  }).join('');
  $('#platformGrid').innerHTML = cards;
  $('#platformGrid').querySelectorAll('[data-platform]').forEach(card => {
    const open = () => {
      state.enteredFromOverview = true;
      navigate({ view: 'platform', project: state.project, platform: card.dataset.platform });
    };
    card.onclick = open;
    card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
  });
  const other = rows.filter(row => ['xiaohongshu', 'x'].includes(row.platform.id));
  $('#otherPlatforms').textContent = other.length
    ? other.map(row => `${row.platform.id === 'x' ? 'X' : '小红书'}：${trLamp(row.platform.login?.state)} · ${safeText(row.platform.login?.asOf)}`).join('  /  ')
    : '小红书 / X：待接入';
}

function actionHtml(item) {
  const cls = String(item.priority || '').toLowerCase();
  return `<article class="action">
    <span class="rail ${escapeHtml(cls)}"></span>
    <div>
      <h3>${escapeHtml(item.title || '')}</h3>
      <p>${escapeHtml(item.detail || '')}</p>
      ${item.kindLabel ? `<small class="kind">${escapeHtml(item.kindLabel)}</small>` : ''}
    </div>
  </article>`;
}
function showRecommendations(noteId, listId, result) {
  const note = $(noteId);
  note.hidden = !result.notice;
  note.textContent = result.notice || '';
  $(listId).innerHTML = result.items.length
    ? result.items.map(actionHtml).join('')
    : (result.notice ? '' : '<div class="empty">暂无策略建议</div>');
}
function renderRecommendations() {
  showRecommendations('#recommendationNote', '#recommendations', selectRecommendations({
    data: { ...state.data, projects: projectsForView() }, projectId: state.project, limit: 3,
  }));
}

function renderWorkKpis(content) {
  const cells = [];
  const change = yesterdayChange([content], ['plays', 'views', 'reads']);
  if (change.status === 'ok' && change.value !== null) {
    const cls = change.value > 0 ? 'up' : change.value < 0 ? 'down' : '';
    cells.push(`<div class="kpi-cell"><div class="kpi-num ${cls}">${formatSigned(change.value)}</div><div class="kpi-lab">较上一日</div></div>`);
  }
  for (const field of presentWorkFields(content)) {
    const display = field.ratio ? formatField(field.id, field.value) : formatMetric(field.value);
    const bar = field.ratio ? ratioPercent(field.value) : null;
    cells.push(`<div class="kpi-cell"><div class="kpi-num">${display}</div><div class="kpi-lab">${field.label}</div>${bar === null ? '' : `<div class="bar"><i style="width:${bar.toFixed(1)}%"></i></div>`}</div>`);
  }
  return cells.length ? `<div class="kpi-grid">${cells.join('')}</div>` : '<div class="empty">指标未采集到</div>';
}
function renderDaily(content) {
  const table = contentDailyTable(content);
  if (!table) return '';
  const head = `<tr><th>日期</th>${table.columns.map(column => `<th>${column.label}</th>`).join('')}</tr>`;
  const body = table.rows.map(row => {
    const cells = table.columns.map(column => {
      const value = row[column.id];
      if (value === null) return '<td>未采集到</td>';
      if (column.id === 'fans') return `<td>${formatSigned(value)}</td>`;
      return `<td>${column.ratio ? formatField(column.id, value) : formatMetric(value)}</td>`;
    }).join('');
    return `<tr><td>${row.date}</td>${cells}</tr>`;
  }).join('');
  return `<div class="day-block"><div class="day-label">每日明细</div><div class="day-scroll"><table class="day-table"><thead>${head}</thead><tbody>${body}</tbody></table></div></div>`;
}
function renderTrend(contents, platformId) {
  const keys = platformId === 'wechat_mp' ? ['reads', 'plays', 'views'] : ['plays', 'views', 'reads'];
  const trend = buildTrend(contents, keys, state.trendDays);
  if (!trend) {
    $('#platformTrend').innerHTML = `<div class="trend-empty">${state.trendDays === 'daily' ? '还没有按日快照' : '这个区间没有按日快照'}</div>`;
    return;
  }
  const hasNet = trend.nets.some(value => value !== null);
  const lastNet = [...trend.nets].reverse().find(value => value !== null);
  const stroke = lastNet < 0 ? '#ff6577' : '#35d49a';
  const svg = trend.paths
    ? sparkSvg(`trend-${platformId}-${state.trendDays}`, trend.paths, { wide: true, stroke })
    : `<div class="trend-empty">${hasNet ? '只有一个采集日，下面标出当日净增' : '只有一个采集日，当日净增未采集'}</div>`;
  const legend = trend.dates.map((date, index) => {
    const net = trend.nets[index];
    const level = trend.levels[index];
    let text = '未采集到';
    let cls = 'flat';
    if (net !== null) { text = formatSigned(net); cls = net > 0 ? 'up' : net < 0 ? 'down' : 'flat'; }
    else if (level !== null) text = `读数 ${formatMetric(level)}`;
    return `<div><b>${shortDate(date)}</b><span class="${cls}">${text}</span></div>`;
  }).join('');
  const caption = hasNet
    ? `${trend.dates[0]} → ${trend.dates.at(-1)} · 当日净增`
    : `${trend.dates[0]} → ${trend.dates.at(-1)} · 当日净增未采集，折线为累计读数`;
  $('#platformTrend').innerHTML = `${svg}<div class="trend-caption">${caption}</div><div class="trend-legend">${legend}</div>`;
}

function renderPlatformView() {
  const id = state.platform;
  const label = platformLabel(id);
  const matches = rowsForPlatform(id);
  const contents = matches.flatMap(row => row.contents);
  const source = matches[0]?.platform;
  const status = platformStatus(matches);
  const asOf = latestAsOf({ generatedAt: source?.login?.asOf || source?.sourceAsOf, projects: matches.map(row => row.project).length ? [{ accounts: [{ platforms: matches.map(row => row.platform) }] }] : [] });
  $('#platformName').textContent = label;
  const statusEl = $('#platformStatus');
  statusEl.textContent = status.text;
  statusEl.className = `capsule ${lampClass(status.lamp)}`;
  $('#asof').textContent = `最近采集 ${asOf}`;

  $('#platformSwitch').innerHTML = CORE_PLATFORMS.map(([pid, title]) =>
    `<button type="button" data-platform="${pid}" class="${pid === id ? 'selected' : ''}">${title}</button>`
  ).join('');
  $('#platformSwitch').querySelectorAll('button').forEach(button => {
    button.onclick = () => navigate({ view: 'platform', project: state.project, platform: button.dataset.platform }, { replace: true });
  });

  const primaryKeys = id === 'wechat_mp' ? ['reads'] : ['plays', 'views'];
  const primaryValue = metricTotal(contents, primaryKeys);
  const primaryChange = yesterdayChange(contents, primaryKeys);
  const engagement = engagementTotal(contents);
  const rate = portfolioEngagementRate(contents, primaryKeys);
  const followers = platformFollowers(source);
  const followerChange = yesterdayFollowers(source, contents);
  const published = countPublished(contents);
  const workCount = matches.length ? (published || contents.length) : null;
  const primaryLabel = id === 'wechat_mp' ? '累计阅读' : '累计播放';
  const rateLine = rate === null ? '' : `<div class="metric-label">互动率 ${formatField('engagementRate', rate)}</div>`;
  $('#platformHero').innerHTML = [
    `<article class="hero-card"><div class="lab">粉丝数</div>${numHtml(`p-fans-${id}`, followers)}${deltaLine(followerChange)}</article>`,
    `<article class="hero-card"><div class="lab">${primaryLabel}</div>${numHtml(`p-vol-${id}`, primaryValue)}${deltaLine(primaryChange)}</article>`,
    `<article class="hero-card"><div class="lab">互动</div>${numHtml(`p-eng-${id}`, engagement)}${rateLine}</article>`,
    `<article class="hero-card"><div class="lab">作品数</div>${numHtml(`p-works-${id}`, workCount)}</article>`,
  ].join('');

  const ranges = [['daily', '按日'], ['7', '7日'], ['30', '30日']];
  $('#trendRange').innerHTML = ranges.map(([days, title]) =>
    `<button type="button" data-days="${days}" class="${String(state.trendDays) === days ? 'selected' : ''}">${title}</button>`
  ).join('');
  $('#trendRange').querySelectorAll('button').forEach(button => {
    button.onclick = () => {
      state.trendDays = button.dataset.days === 'daily' ? 'daily' : Number(button.dataset.days);
      renderPlatformView();
    };
  });
  renderTrend(contents, id);

  const sorts = [['plays', '播放量'], ['engagement', '互动'], ['published', '发布时间']];
  $('#workSort').innerHTML = sorts.map(([mode, title]) =>
    `<button type="button" data-sort="${mode}" class="${state.workSort === mode ? 'selected' : ''}">${title}</button>`
  ).join('');
  $('#workSort').querySelectorAll('button').forEach(button => {
    button.onclick = () => { state.workSort = button.dataset.sort; renderPlatformView(); };
  });
  const works = sortContentsBy(contents, state.workSort);
  $('#workList').innerHTML = works.length ? works.map(content => {
    const title = collectedTitle(content);
    const publishedAt = collectedTime(content.publishedAt);
    const href = typeof content.url === 'string' && /^https?:\/\//i.test(content.url) ? content.url : '';
    const link = href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">打开原片 ↗</a>`
      : '<span class="missing">链接未采集到</span>';
    const status = content.status ? `<span class="capsule">${escapeHtml(trStatus(content.status))}</span>` : '';
    return `<article class="work">
      <div class="work-head">
        <h3${title === '未采集到' ? ' class="missing"' : ''}>${escapeHtml(title)}</h3>
        <div class="work-actions">
          <span class="work-time${publishedAt === '未采集到' ? ' missing' : ''}">发布 ${escapeHtml(publishedAt)}</span>
          ${status}
          ${link}
        </div>
      </div>
      ${renderWorkKpis(content)}
      ${renderDaily(content)}
    </article>`;
  }).join('') : '<div class="empty">暂无作品明细</div>';

  const advice = selectRecommendations({ data: { ...state.data, projects: projectsForView() }, projectId: state.project, platformId: id, limit: 4 });
  $('#platformStrategy').hidden = !advice.notice && advice.items.length === 0;
  showRecommendations('#platformSample', '#platformRecommendations', advice);
}

function render() {
  if (state.project !== 'all' && !liveProjects().some(project => projectMatches(project, state.project))) {
    navigate({ view: 'overview', project: 'all' }, { replace: true });
    return;
  }
  const onPlatform = state.view === 'platform' && state.platform;
  $('#overview').hidden = Boolean(onPlatform);
  $('#platformView').hidden = !onPlatform;
  $('#topbarHome').hidden = Boolean(onPlatform);
  $('#topbarPlatform').hidden = !onPlatform;
  if (onPlatform) {
    renderPlatformView();
    renderFreshness(rowsForPlatform(state.platform), false);
    return;
  }
  $('#asof').textContent = `最近采集 ${latestAsOf({ ...state.data, projects: projectsForView() })}`;
  renderProjects();
  renderHero();
  $('#matrix').hidden = state.project !== 'all';
  if (state.project === 'all') projectMatrix();
  renderMarket();
  renderRecommendations();
  renderFreshness(rowsForView(), true);
}

function renderFreshness(rows, includeGenerated) {
  const freshness = collectionFreshness(rows, { generatedAt: includeGenerated ? state.data?.generatedAt : null });
  const banner = $('#staleBanner');
  if (!banner) return;
  if (freshness.stale && freshness.latest) {
    banner.hidden = false;
    banner.textContent = `数据停在 ${freshness.latest}，今日采集未完成`;
  } else {
    banner.hidden = true;
    banner.textContent = '';
  }
}

function goOverview() {
  if (state.enteredFromOverview && window.history.length > 1) {
    state.enteredFromOverview = false;
    history.back();
    return;
  }
  navigate({ view: 'overview', project: state.project }, { replace: true });
}

$('#unlockForm').addEventListener('submit', async event => {
  event.preventDefault();
  const passphrase = $('#passphrase').value;
  $('#unlockError').textContent = '';
  try {
    const envelope = await fetchData('data.enc.json');
    state.data = await decryptPwaEnvelope(envelope, passphrase);
    state.passphrase = passphrase;
    state.remembered = Boolean($('#remember').checked);
    if (state.remembered) localStorage.setItem('ops-pwa-passphrase', passphrase);
    else localStorage.removeItem('ops-pwa-passphrase');
    showDashboard();
  } catch (error) {
    $('#unlockError').textContent = (error.name === 'OperationError' || error.message?.includes('OperationError')) ? '口令错误，未加载数据。' : '解密失败，未加载数据。';
  }
});

$('#backOverview').onclick = goOverview;
$('#refresh').onclick = () => loadSnapshot(state.passphrase);
$('#lock').onclick = () => {
  state.data = null;
  state.passphrase = null;
  state.remembered = false;
  localStorage.removeItem('ops-pwa-passphrase');
  setUnlock();
};
window.addEventListener('hashchange', () => applyRoute(parseOpsRoute(location.hash)));
window.addEventListener('popstate', () => applyRoute(parseOpsRoute(location.hash)));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
const saved = localStorage.getItem('ops-pwa-passphrase');
loadSnapshot(saved || null);
