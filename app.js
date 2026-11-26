import { decryptPwaEnvelope } from './crypto.js';
import {
  CORE_PLATFORMS, DASH, aggregateDailySeries, buildOpsHash, collectPlatformRows,
  countHealthyPlatforms, countPublished, engagementTotal, formatDateTime, formatField,
  formatMetric, formatSigned, latestAsOf, metricDelta, metricTotal, metricWindowChange,
  parseOpsRoute, platformFollowers, ratioPercent, recommendationsForPlatform,
  sortContentsBy, sparklineFromSeries, sparklinePaths, summarizeRows,
} from './format.js';

const $ = selector => document.querySelector(selector);
const state = {
  data: null,
  passphrase: null,
  project: 'all',
  view: 'overview',
  platform: null,
  trendDays: 7,
  workSort: 'plays',
  remembered: false,
  enteredFromOverview: false,
};
const PROJECT_ALIASES = {
  'shangye-chenfu-lu': '商业沉浮录',
  'x-personal-t116350650': 'X 个人号 @t116350650',
  'huangjing-content': '黄精内容号',
};
const PENDING_PROJECTS = [
  ['x-personal-t116350650', 'X 个人号 @t116350650'],
  ['huangjing-content', '黄精内容号'],
];
const STATUS_LABELS = {
  published: '已发布', public: '已发布', draft: '草稿', reviewing: '审核中',
  scheduled: '定时发布', pending: '待发布', deleted: '已删除', private: '仅自己可见',
  published_in_review: '审核中已发布', private_draft_ready: '草稿已备好',
  filled_awaiting_click: '待点击发布', blocked: '被拦截', not_submitted: '未投稿',
  not_scheduled: '未排期', takedown: '已下架', unknown: '未知',
};
const LAMP_LABELS = { green: '正常', yellow: '待复核', red: '需登录', neutral: '未检测' };
const PRIORITY_LABELS = { high: '高', medium: '中', low: '低', P0: '紧急', P1: '高', P2: '中', P3: '低' };
const WORK_KPIS = [
  { id: 'plays', keys: ['plays', 'views'], label: '播放' },
  { id: 'delta', delta: ['plays', 'views'], label: '较昨日' },
  { id: 'reads', keys: ['reads'], label: '阅读' },
  { id: 'likes', keys: ['likes'], label: '点赞' },
  { id: 'comments', keys: ['comments'], label: '评论' },
  { id: 'shares', keys: ['shares'], label: '分享' },
  { id: 'collects', keys: ['collects'], label: '收藏' },
  { id: 'completionRate', keys: ['completionRate'], label: '完播率', ratio: true },
  { id: 'ctr', keys: ['ctr'], label: '点击率', ratio: true },
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function safeText(value) {
  return value === null || value === undefined || value === '' ? DASH : String(value);
}
function trStatus(value) { return STATUS_LABELS[value] || safeText(value); }
function trLamp(value) { return LAMP_LABELS[value] || safeText(value); }
function trPriority(value) { return PRIORITY_LABELS[value] || safeText(value); }
function lampClass(value) { return ['green', 'yellow', 'red'].includes(value) ? value : ''; }
function badgeHtml(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return `<span class="badge flat">${DASH}</span>`;
  const n = Number(value);
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  return `<span class="badge ${cls}">${formatSigned(n)}</span>`;
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

function projectsForView() {
  return (state.data?.projects ?? []).filter(project => state.project === 'all' || project.id === state.project || project.title === state.project);
}
function rowsForView() { return collectPlatformRows({ projects: projectsForView() }); }
function rowsForPlatform(platformId) {
  return rowsForView().filter(row => row.platform.id === platformId);
}

function renderProjects() {
  const seen = new Set();
  const entries = [['all', '全部项目']];
  for (const project of state.data?.projects ?? []) {
    seen.add(project.id);
    entries.push([project.id, PROJECT_ALIASES[project.id] || project.title || project.id]);
  }
  for (const [id, title] of PENDING_PROJECTS) if (!seen.has(id)) entries.push([id, title]);
  $('#projects').innerHTML = entries.map(([id, title]) => `<button type="button" data-project="${escapeHtml(id)}" class="${state.project === id ? 'selected' : ''}">${escapeHtml(title)}</button>`).join('');
  $('#projects').querySelectorAll('button').forEach(button => {
    button.onclick = () => navigate({ view: 'overview', project: button.dataset.project });
  });
}

function renderHero() {
  const rows = rowsForView();
  const summary = summarizeRows(rows);
  const published = countPublished(rows.flatMap(row => row.contents));
  const healthy = countHealthyPlatforms(rows);
  const totalPlatforms = new Set(rows.map(row => row.platform?.id).filter(Boolean)).size;
  const items = [
    ['总播放 / 观看', formatMetric(summary.plays), ''],
    ['较昨日净增', formatSigned(summary.playsDelta), badgeHtml(summary.playsDelta)],
    ['总阅读', formatMetric(summary.reads), badgeHtml(summary.readsDelta)],
    ['已上线作品', formatMetric(published), ''],
    ['健康平台', totalPlatforms ? `${healthy} / ${totalPlatforms}` : DASH, ''],
  ];
  $('#hero').innerHTML = items.map(([lab, num, extra]) => `<article class="hero-card"><div class="lab">${lab}</div><div class="num">${num}</div>${extra}</article>`).join('');
}

function projectMatrix() {
  const projects = state.data?.projects ?? [];
  const known = new Set(projects.map(project => project.id));
  const featured = projects.map(project => {
    const rows = collectPlatformRows({ projects: [project] });
    const summary = summarizeRows(rows);
    const published = countPublished(rows.flatMap(row => row.contents));
    const connected = project.status === 'running' || rows.some(row => (row.contents ?? []).length);
    return `<article class="featured" data-project="${escapeHtml(project.id)}" role="button" tabindex="0">
      <div class="status">${connected ? '已接入' : '待接入'}</div>
      <h3>${escapeHtml(PROJECT_ALIASES[project.id] || project.title || project.id)}</h3>
      <div class="num">${formatMetric(summary.plays)}</div>
      <div class="meta">
        <span>较昨日 ${badgeHtml(summary.playsDelta)}</span>
        <span>阅读 ${formatMetric(summary.reads)}</span>
        <span>已上线 ${formatMetric(published)}</span>
      </div>
    </article>`;
  }).join('');
  const pending = PENDING_PROJECTS.filter(([id]) => !known.has(id)).map(([, title]) =>
    `<div class="pending-chip"><span class="dot"></span><b>${escapeHtml(title)}</b><span>待接入</span></div>`
  ).join('');
  $('#projectCards').innerHTML = (featured || pending)
    ? `${featured || ''}${pending ? `<div class="pending-row">${pending}</div>` : ''}`
    : '<div class="empty">暂无项目数据</div>';
  $('#projectCards').querySelectorAll('[data-project]').forEach(card => {
    const open = () => navigate({ view: 'overview', project: card.dataset.project });
    card.onclick = open;
    card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
  });
}

function sparkSvg(id, history, { wide = false, days = 7 } = {}) {
  const series = wide ? null : sparklinePaths(history, ['plays', 'views', 'reads']);
  const paths = wide ? sparklineFromSeries(history, { width: 100, height: 40, pad: 3 }) : series;
  if (!paths) return `<div class="${wide ? 'trend-empty' : 'spark-empty'}">${wide ? `近${days}日有效趋势点不足，暂不绘制` : '7日趋势 —'}</div>`;
  const gid = `sparkFill-${id}`;
  const height = wide ? 40 : 30;
  return `<svg class="${wide ? 'trend-svg' : 'spark'}" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#35d49a" stop-opacity="0.38"/><stop offset="100%" stop-color="#35d49a" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${paths.area}" fill="url(#${gid})"></polygon>
    <polyline points="${paths.line}" fill="none" stroke="#35d49a" stroke-width="${wide ? 1.4 : 1.7}" stroke-linejoin="round" stroke-linecap="round"></polyline>
  </svg>`;
}

function platformStatus(matches) {
  const source = matches[0]?.platform;
  const lamp = source?.login?.state ?? 'neutral';
  if (!matches.length) return { lamp: 'neutral', text: '待接入', connected: false };
  if (lamp === 'red') return { lamp, text: '需登录', connected: true };
  if (lamp === 'yellow') return { lamp, text: '待补采', connected: true };
  if (lamp === 'green') return { lamp, text: '已接入', connected: true };
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
    const plays = metricTotal(contents, ['plays', 'views']);
    const engagement = engagementTotal(contents);
    const playsDelta = metricWindowChange(contents, ['plays', 'views'], 7);
    const followers = platformFollowers(source);
    const followerDelta = metricWindowChange(contents, ['followersGained'], 7);
    const history = contents.flatMap(content => content.daily_snapshots ?? []);
    const status = platformStatus(matches);
    return `<article class="quote" data-platform="${id}" role="button" tabindex="0">
      <div class="quote-head">
        <h3>${label}</h3>
        <div class="quote-status"><span class="lamp ${lampClass(status.lamp)}"></span><span class="capsule ${lampClass(status.lamp)}">${status.text}</span></div>
      </div>
      <div class="quote-metrics">
        <div><div class="metric-label">粉丝</div><div class="num">${formatMetric(followers)}</div>${badgeHtml(followerDelta)}</div>
        <div><div class="metric-label">播放 / 互动</div><div class="num">${formatMetric(plays)}</div><span class="metric-label">互动 ${formatMetric(engagement)} · 近7日 ${formatSigned(playsDelta)}</span></div>
      </div>
      ${sparkSvg(id, history)}
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

function renderRecommendations() {
  const items = state.data?.recommendations ?? [];
  $('#recommendations').innerHTML = items.length ? items.map(actionHtml).join('') : '<div class="empty">暂无策略建议</div>';
}

function actionHtml(item) {
  const priority = trPriority(item.priority);
  const cls = String(item.priority || priority).toLowerCase();
  const rules = Array.isArray(item.ruleIds) ? item.ruleIds.join(' · ') : (item.ruleIds || '');
  return `<article class="action">
    <span class="rail ${escapeHtml(cls)}"></span>
    <div>
      <h3>${escapeHtml(safeText(item.title))}</h3>
      <p>${escapeHtml(safeText(item.detail))}</p>
      ${rules ? `<small class="rule">${escapeHtml(rules)}</small>` : ''}
    </div>
  </article>`;
}

function renderWorkKpis(content) {
  const cells = [];
  for (const item of WORK_KPIS) {
    const value = item.delta ? metricDelta([content], item.delta) : metricTotal([content], item.keys);
    const display = item.delta ? formatSigned(value) : formatField(item.keys?.[0] || item.id, value);
    const bar = item.ratio ? ratioPercent(value) : null;
    cells.push(`<div class="kpi-cell"><div class="kpi-num">${display}</div><div class="kpi-lab">${item.label}</div>${bar === null ? '' : `<div class="bar"><i style="width:${bar.toFixed(1)}%"></i></div>`}</div>`);
  }
  return `<div class="kpi-grid">${cells.join('')}</div>`;
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

  const plays = metricTotal(contents, ['plays', 'views']);
  const reads = metricTotal(contents, ['reads']);
  const playChange = metricWindowChange(contents, ['plays', 'views'], 7);
  const readChange = metricWindowChange(contents, ['reads'], 7);
  const engagement = engagementTotal(contents);
  const followers = platformFollowers(source);
  const followerDelta = metricWindowChange(contents, ['followersGained'], 7);
  const published = countPublished(contents);
  const primaryLabel = id === 'wechat_mp' ? '累计阅读' : '累计播放';
  const primaryValue = id === 'wechat_mp' ? reads : plays;
  const primaryDelta = id === 'wechat_mp' ? readChange : playChange;
  const hero = [
    ['粉丝数', formatMetric(followers), badgeHtml(followerDelta)],
    [primaryLabel, formatMetric(primaryValue), `<span class="metric-label">近7日 ${formatSigned(primaryDelta)}</span>${badgeHtml(primaryDelta)}`],
    ['点赞 / 互动', formatMetric(engagement), ''],
    ['作品数', formatMetric(published || contents.length ? (published || contents.length) : null), ''],
  ];
  // Wait: "作品数" should not convert missing to 0, but contents.length is a real count (can be 0 if platform connected with empty list).
  // If platform has no snapshot/not connected, works should be —. If connected with 0 contents, 0 is honest.
  // published || contents.length would show 0 as 0 when empty array on connected platform - OK.
  // If not connected, matches.length is 0, contents=[], published=0, contents.length=0 → formatMetric(null) if we pass null when !matches.length
  const workCount = matches.length ? (published || contents.length) : null;
  hero[3] = ['作品数', formatMetric(workCount), ''];
  $('#platformHero').innerHTML = hero.map(([lab, num, extra]) => `<article class="hero-card"><div class="lab">${lab}</div><div class="num">${num}</div>${extra}</article>`).join('');

  $('#trendRange').innerHTML = [7, 30].map(days =>
    `<button type="button" data-days="${days}" class="${state.trendDays === days ? 'selected' : ''}">近${days}日</button>`
  ).join('');
  $('#trendRange').querySelectorAll('button').forEach(button => {
    button.onclick = () => { state.trendDays = Number(button.dataset.days); renderPlatformView(); };
  });
  const series = aggregateDailySeries(contents, id === 'wechat_mp' ? ['reads', 'plays', 'views'] : ['plays', 'views', 'reads'], state.trendDays);
  $('#platformTrend').innerHTML = sparkSvg(`trend-${id}-${state.trendDays}`, series, { wide: true, days: state.trendDays });

  const sorts = [['plays', '播放量'], ['engagement', '互动'], ['published', '发布时间']];
  $('#workSort').innerHTML = sorts.map(([mode, title]) =>
    `<button type="button" data-sort="${mode}" class="${state.workSort === mode ? 'selected' : ''}">${title}</button>`
  ).join('');
  $('#workSort').querySelectorAll('button').forEach(button => {
    button.onclick = () => { state.workSort = button.dataset.sort; renderPlatformView(); };
  });
  const works = sortContentsBy(contents, state.workSort);
  $('#workList').innerHTML = works.length ? works.map(content => {
    const url = content.url ? escapeHtml(content.url) : '';
    return `<article class="work">
      <div class="work-head">
        <h3>${escapeHtml(safeText(content.title))}</h3>
        <div class="work-actions">
          <span class="work-time">${formatDateTime(content.publishedAt || content.sourceAsOf)}</span>
          <span class="capsule">${escapeHtml(trStatus(content.status))}</span>
          ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">打开原片 ↗</a>` : ''}
        </div>
      </div>
      ${renderWorkKpis(content)}
    </article>`;
  }).join('') : '<div class="empty">暂无作品明细</div>';

  const recs = recommendationsForPlatform(state.data, id, state.project);
  $('#platformStrategy').hidden = recs.length === 0;
  $('#platformRecommendations').innerHTML = recs.map(actionHtml).join('');
}

function render() {
  const onPlatform = state.view === 'platform' && state.platform;
  $('#overview').hidden = Boolean(onPlatform);
  $('#platformView').hidden = !onPlatform;
  $('#topbarHome').hidden = Boolean(onPlatform);
  $('#topbarPlatform').hidden = !onPlatform;
  if (onPlatform) {
    renderPlatformView();
    return;
  }
  $('#asof').textContent = `最近采集 ${latestAsOf(state.data)}`;
  renderProjects();
  renderHero();
  $('#matrix').hidden = state.project !== 'all';
  if (state.project === 'all') projectMatrix();
  renderMarket();
  renderRecommendations();
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
