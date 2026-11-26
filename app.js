import { decryptPwaEnvelope } from './crypto.js';
import {
  CORE_PLATFORMS, DASH, collectPlatformRows, countHealthyPlatforms, countPublished,
  formatField, formatMetric, formatSigned, latestAsOf, metricDelta, metricTotal,
  ratioPercent, sortContentsByPlays, sparklinePaths, summarizeRows,
} from './format.js';

const $ = selector => document.querySelector(selector);
const state = { data: null, passphrase: null, project: 'all', expanded: null, remembered: false };
const PROJECT_ALIASES = {
  'shangye-chenfu-lu': '商业沉浮录',
  'x-personal-t116350650': 'X 个人号 @t116350650',
  'huangjing-content': '黄精内容号',
};
const PENDING_PROJECTS = [
  ['x-personal-t116350650', 'X 个人号 @t116350650'],
  ['huangjing-content', '黄精内容号'],
];
const STATUS_LABELS = { published: '已发布', draft: '草稿', reviewing: '审核中', scheduled: '定时发布', pending: '待发布', deleted: '已删除', private: '仅自己可见' };
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
const EXTRA_KPIS = [
  { id: 'impressions', keys: ['impressions'], label: '曝光' },
  { id: 'avgPlayShare', keys: ['avgPlayShare'], label: '平均播放比例', ratio: true },
  { id: 'retain5s', keys: ['retain5s'], label: '5秒留存', ratio: true },
  { id: 'recommends', keys: ['recommends'], label: '推荐' },
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
  $('#asof').textContent = `最近采集 ${latestAsOf(state.data)}`;
  render();
}

function projectsForView() {
  return (state.data?.projects ?? []).filter(project => state.project === 'all' || project.id === state.project || project.title === state.project);
}
function rowsForView() { return collectPlatformRows({ projects: projectsForView() }); }

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
    button.onclick = () => { state.project = button.dataset.project; state.expanded = null; render(); };
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
    const open = () => { state.project = card.dataset.project; state.expanded = null; render(); };
    card.onclick = open;
    card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
  });
}

function renderWorkKpis(content) {
  const cells = [];
  for (const item of WORK_KPIS) {
    const value = item.delta ? metricDelta([content], item.delta) : metricTotal([content], item.keys);
    const display = item.delta ? formatSigned(value) : formatField(item.keys?.[0] || item.id, value);
    const bar = item.ratio ? ratioPercent(value) : null;
    cells.push(`<div class="kpi-cell"><div class="kpi-num">${display}</div><div class="kpi-lab">${item.label}</div>${bar === null ? '' : `<div class="bar"><i style="width:${bar.toFixed(1)}%"></i></div>`}</div>`);
  }
  for (const item of EXTRA_KPIS) {
    const metrics = content.metrics ?? {};
    const key = item.keys.find(candidate => Object.hasOwn(metrics, candidate));
    if (!key) continue;
    const value = metrics[key];
    const bar = item.ratio ? ratioPercent(value) : null;
    cells.push(`<div class="kpi-cell"><div class="kpi-num">${formatField(key, value)}</div><div class="kpi-lab">${item.label}</div>${bar === null ? '' : `<div class="bar"><i style="width:${bar.toFixed(1)}%"></i></div>`}</div>`);
  }
  return `<div class="kpi-grid">${cells.join('')}</div>`;
}

function renderDetails(contents) {
  const works = sortContentsByPlays(contents).map(content => {
    const url = content.url ? escapeHtml(content.url) : '';
    return `<article class="work">
      <div class="work-head">
        <h3>${escapeHtml(safeText(content.title))}</h3>
        <div class="work-actions">
          <span class="capsule">${escapeHtml(trStatus(content.status))}</span>
          ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">打开原片 ↗</a>` : ''}
        </div>
      </div>
      ${renderWorkKpis(content)}
    </article>`;
  }).join('');
  return `<div class="detail-list">${works || '<div class="empty">暂无作品明细</div>'}</div>`;
}

function sparkSvg(id, history) {
  const paths = sparklinePaths(history, ['plays', 'views', 'reads']);
  if (!paths) return '<div class="spark-empty">7日趋势 —</div>';
  const gid = `sparkFill-${id}`;
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#35d49a" stop-opacity="0.38"/><stop offset="100%" stop-color="#35d49a" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${paths.area}" fill="url(#${gid})"></polygon>
    <polyline points="${paths.line}" fill="none" stroke="#35d49a" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"></polyline>
  </svg>`;
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
    const reads = metricTotal(contents, ['reads']);
    const playsDelta = metricDelta(contents, ['plays', 'views']);
    const readsDelta = metricDelta(contents, ['reads']);
    const history = contents.flatMap(content => content.daily_snapshots ?? []);
    const lamp = source?.login?.state ?? 'neutral';
    const tone = lampClass(lamp);
    const expanded = state.expanded === id;
    const count = contents.length;
    const hint = expanded ? `收起 ▴` : `查看 ${count} 条作品 ▾`;
    return `<article class="quote ${expanded ? 'open' : ''}" data-platform="${id}">
      <div class="quote-head">
        <h3>${label}</h3>
        <div class="quote-status"><span class="lamp ${tone}"></span><span class="capsule ${tone}">${matches.length ? trLamp(lamp) : '待接入'}</span></div>
      </div>
      <div class="quote-metrics">
        <div><div class="metric-label">播放 / 观看</div><div class="num">${formatMetric(plays)}</div>${badgeHtml(playsDelta)}</div>
        <div><div class="metric-label">阅读</div><div class="num">${formatMetric(reads)}</div>${badgeHtml(readsDelta)}</div>
      </div>
      ${sparkSvg(id, history)}
      <div class="quote-foot">${hint}</div>
      ${expanded ? renderDetails(contents) : ''}
    </article>`;
  }).join('');
  $('#platformGrid').innerHTML = cards;
  $('#platformGrid').querySelectorAll('[data-platform]').forEach(card => {
    card.onclick = event => {
      if (event.target.closest('a')) return;
      const id = card.dataset.platform;
      state.expanded = state.expanded === id ? null : id;
      renderMarket();
    };
  });
  const other = rows.filter(row => ['xiaohongshu', 'x'].includes(row.platform.id));
  $('#otherPlatforms').textContent = other.length
    ? other.map(row => `${row.platform.id === 'x' ? 'X' : '小红书'}：${trLamp(row.platform.login?.state)} · ${safeText(row.platform.login?.asOf)}`).join('  /  ')
    : '小红书 / X：待接入';
}

function renderRecommendations() {
  const items = state.data?.recommendations ?? [];
  $('#recommendations').innerHTML = items.length
    ? items.map(item => {
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
      }).join('')
    : '<div class="empty">暂无策略建议</div>';
}

function render() {
  renderProjects();
  renderHero();
  $('#matrix').hidden = state.project !== 'all';
  if (state.project === 'all') projectMatrix();
  renderMarket();
  renderRecommendations();
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

$('#refresh').onclick = () => loadSnapshot(state.passphrase);
$('#lock').onclick = () => {
  state.data = null;
  state.passphrase = null;
  state.remembered = false;
  localStorage.removeItem('ops-pwa-passphrase');
  setUnlock();
};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
const saved = localStorage.getItem('ops-pwa-passphrase');
loadSnapshot(saved || null);
