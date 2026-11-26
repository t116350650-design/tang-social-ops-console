import { decryptPwaEnvelope } from './crypto.js';
import { CORE_PLATFORMS, DASH, collectPlatformRows, formatField, formatMetric, latestAsOf, metricDelta, metricTotal, sparkline, summarizeRows } from './format.js';
const $ = selector => document.querySelector(selector);
const state = { data: null, passphrase: null, mode: 'live', project: 'all', expanded: null, remembered: false, demoTimer: null };
const labels = Object.fromEntries(CORE_PLATFORMS);
const METRIC_LABELS={plays:"播放",views:"观看",reads:"阅读",likes:"点赞",comments:"评论",shares:"分享",collects:"收藏",impressions:"曝光",ctr:"点击率",completionRate:"完播率",avgPlayShare:"平均播放比例",retain5s:"5秒留存",recommends:"推荐"};
const STATUS_LABELS={published:"已发布",draft:"草稿",reviewing:"审核中",scheduled:"定时发布",pending:"待发布",deleted:"已删除",private:"仅自己可见"};
const LAMP_LABELS={green:"正常",yellow:"待复核",red:"需登录",neutral:"未检测"};
const PRIORITY_LABELS={high:"高",medium:"中",low:"低",P0:"紧急",P1:"高",P2:"中",P3:"低"};
const trStatus=v=>STATUS_LABELS[v]||safeText(v);
const trLamp=v=>LAMP_LABELS[v]||safeText(v);
const trPriority=v=>PRIORITY_LABELS[v]||safeText(v);

const demoValue = (n, step) => Math.round((n + step * 997) % 85000 + 4000);
function safeText(value) { return value === null || value === undefined || value === '' ? DASH : String(value); }
function setUnlock(message = '') { $('#loading').hidden = true; $('#dashboard').hidden = true; $('#unlock').hidden = false; $('#lock').hidden = true; $('#unlockError').textContent = message; }
async function fetchData(name) { const response = await fetch(`./${name}`, { cache: 'no-store' }); if (!response.ok) throw new Error(`${name} ${response.status}`); return name.endsWith('.json') ? response.json() : JSON.parse(await response.text()); }
async function loadSnapshot(passphrase = state.passphrase) {
  try {
    const envelope = await fetchData('data.enc.json');
    if (passphrase) { state.data = await decryptPwaEnvelope(envelope, passphrase); state.passphrase = passphrase; state.remembered = localStorage.getItem('ops-pwa-passphrase') === passphrase; showDashboard(); return; }
    setUnlock();
  } catch (error) {
    if ((error.name==='OperationError'||error.message?.includes('OperationError'))) { setUnlock('口令错误，未加载数据。'); return; }
    if (error.message?.startsWith('data.enc.json')) {
      const localHost = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
      if (!localHost) { setUnlock('未找到加密快照。公网环境不会自动加载明文数据。'); return; }
      try { state.data = await fetchData('data.json'); state.passphrase = null; showDashboard(); return; }
      catch { setUnlock('未找到数据快照。'); return; }
    }
    setUnlock(error.message === '不支持的信封' ? '不支持的信封格式。' : '数据解密失败，未渲染任何数据。');
  }
}
function showDashboard() { $('#unlock').hidden = true; $('#loading').hidden = true; $('#dashboard').hidden = false; $('#lock').hidden = false; $('#asof').textContent = `最近采集 ${latestAsOf(state.data)}`; render(); }
function projectsForView() { return (state.data?.projects ?? []).filter(project => state.project === 'all' || project.id === state.project || project.title === state.project); }
function rowsForView() { return collectPlatformRows({ projects: projectsForView() }); }
function renderProjects() {
  const aliases = {'shangye-chenfu-lu':'商业沉浮录','x-personal-t116350650':'X 个人号 @t116350650','huangjing-content':'黄精内容号'};
  const seen = new Set();
  const entries = [['all','全部项目']];
  for (const project of state.data?.projects ?? []) {
    seen.add(project.id);
    entries.push([project.id, aliases[project.id] || project.title || project.id]);
  }
  for (const [id, title] of Object.entries(aliases)) if (!seen.has(id)) entries.push([id, title]);
  $('#projects').innerHTML = entries.map(([id,title]) => `<button data-project="${id}" class="${state.project===id?'selected':''}">${title}</button>`).join('');
  $('#projects').querySelectorAll('button').forEach(button => button.onclick=()=>{state.project=button.dataset.project;state.expanded=null;render();});
}
function projectMatrix() {
  const projects = state.data?.projects ?? [];
  const known = new Set(projects.map(project=>project.id));
  const cards = projects.map(project=>{
    const rows=collectPlatformRows({projects:[project]}), summary=summarizeRows(rows);
    return `<article class="project-card"><div class="status">${project.status==='running'?'已接入':'待接入'}</div><h3>${safeText(project.title)}</h3><div class="number">${formatMetric(summary.plays)}</div><div class="muted">播放 / 观看 · 较昨日 ${formatMetric(summary.playsDelta)}</div><div class="delta">阅读 ${formatMetric(summary.reads)} · 较昨日 ${formatMetric(summary.readsDelta)}</div></article>`;
  }).join('');
  const pending = [['x-personal-t116350650','X 个人号 @t116350650'],['huangjing-content','黄精内容号']].filter(([id])=>!known.has(id)).map(([,title])=>`<article class="project-card"><div class="status pending">待接入</div><h3>${title}</h3><div class="number">—</div><div class="muted">播放 / 观看 · 较昨日 —</div><div class="delta">阅读 — · 较昨日 —</div></article>`).join('');
  $('#projectCards').innerHTML=(cards+pending)||'<div class="empty">暂无项目数据</div>';
}
function valuesFor(row) {
  const plays=metricTotal(row.contents,['plays','views']), reads=metricTotal(row.contents,['reads']);
  const pd=metricDelta(row.contents,['plays','views']), rd=metricDelta(row.contents,['reads']);
  const demo=state.mode==='demo';
  return {plays:demo?demoValue(row.platform.id.length*31,Date.now()>>12):plays,reads:demo?demoValue(row.platform.id.length*17,Date.now()>>13):reads,pd:demo?Math.round(Math.sin(Date.now()/400+row.platform.id.length)*250):pd,rd:demo?Math.round(Math.cos(Date.now()/500+row.platform.id.length)*90):rd};
}
function deltaHtml(value) { return `<span class="delta ${value>0?'up':value<0?'down':''}">较昨日 ${formatMetric(value)}</span>`; }
function contentFields(content) {
  const metrics=content.metrics??{};
  const known=['plays','views','reads','likes','comments','shares','collects','impressions','ctr','completionRate','avgPlayShare','retain5s','recommends'];
  return known.filter(key=>Object.hasOwn(metrics,key)).map(key=>`<div><dt>${METRIC_LABELS[key]||key}</dt><dd>${formatField(key,metrics[key])}</dd></div>`).join('');
}
function renderDetails(row) {
  const platform=row.platform;
  const details=row.contents.map(content=>`<article class="detail"><div class="detail-head"><strong>${safeText(content.title)}</strong><span class="muted status-badge">${trStatus(content.status)}</span></div><dl>${contentFields(content)}</dl><div class="delta">较昨日 ${formatMetric(metricDelta([content],['plays','views','reads']))}</div>${content.url?`<a href="${content.url}" target="_blank" rel="noopener noreferrer">打开作品 ↗</a>`:''}</article>`).join('');
  const diagnostic=(state.data?.diagnostics??[]).filter(item=>item.platform===platform.id||row.contents.some(content=>content.id===item.contentId)).map(item=>`${safeText(item.ruleId)}：${safeText(item.detail)}`).join(' · ')||'暂无本平台诊断';
  return `<div class="detail-list">${details||'<div class="empty">暂无作品明细</div>'}<div class="health-note">本平台诊断：${diagnostic}</div></div>`;
}
function renderMarket() {
  const rows=rowsForView();
  $('#scope').textContent=state.project==='all'?'已接入实盘范围':'当前项目';
  const cards=CORE_PLATFORMS.map(([id,label])=>{
    const matches=rows.filter(row=>row.platform.id===id), contents=matches.flatMap(row=>row.contents), source=matches[0]?.platform;
    const aggregate={platform:{id,login:source?.login},contents}; const values=valuesFor(aggregate);
    const history=contents.flatMap(content=>content.daily_snapshots??[]);
    const points=sparkline(history,['plays','views','reads']); const lamp=source?.login?.state??'neutral';
    const expanded=state.expanded===id;
    return `<article class="quote" data-platform="${id}"><div class="quote-head"><h3>${label}</h3><span class="lamp ${['green','yellow','red'].includes(lamp)?lamp:''}" title="登录态 ${trLamp(lamp)}"></span></div><div class="health-note">${matches.length?`登录状态：${trLamp(lamp)}`:'待接入 / 无快照'}</div><div class="metrics"><div><div class="metric-label">播放 / 观看</div><div class="number">${formatMetric(values.plays)}</div>${deltaHtml(values.pd)}</div><div><div class="metric-label">阅读</div><div class="number">${formatMetric(values.reads)}</div>${deltaHtml(values.rd)}</div></div>${points?`<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${points}"/></svg>`:'<div class="empty">7日趋势 —</div>'}${expanded?renderDetails({platform:{id,login:source?.login},contents}):''}</article>`;
  }).join('');
  $('#platformGrid').innerHTML=cards;
  $('#platformGrid').querySelectorAll('[data-platform]').forEach(card=>card.onclick=event=>{if(event.target.closest('a'))return;const id=card.dataset.platform;state.expanded=state.expanded===id?null:id;renderMarket();});
  const other=rows.filter(row=>['xiaohongshu','x'].includes(row.platform.id));
  $('#otherPlatforms').textContent=other.length?other.map(row=>`${row.platform.id==='x'?'X':'小红书'}：${trLamp(row.platform.login?.state)} · ${safeText(row.platform.login?.asOf)}`).join('　/　'):'小红书 / X：待接入';
}
function renderRecommendations() {
  const items=state.data?.recommendations??[];
  $('#recommendations').innerHTML=items.length?items.map((item,index)=>`<article class="strategy-card"><div class="priority">优先级 ${index+1} · ${trPriority(item.priority)}</div><h3>${safeText(item.title)}</h3><p>${safeText(item.detail)}</p><small>依据规则：${Array.isArray(item.ruleIds)?item.ruleIds.join('、'):safeText(item.ruleIds)}</small></article>`).join(''):'<div class="empty">暂无策略建议</div>';
}
function render() { renderProjects();$('#matrix').hidden=state.project!=='all';if(state.project==='all')projectMatrix();renderMarket();renderRecommendations();$('#demoBanner').hidden=state.mode!=='demo'; }
$('#unlockForm').addEventListener('submit',async event=>{event.preventDefault();const passphrase=$('#passphrase').value;$('#unlockError').textContent='';try{const envelope=await fetchData('data.enc.json');state.data=await decryptPwaEnvelope(envelope,passphrase);state.passphrase=passphrase;state.remembered=Boolean($('#remember').checked);if(state.remembered)localStorage.setItem('ops-pwa-passphrase',passphrase);else localStorage.removeItem('ops-pwa-passphrase');showDashboard();}catch(error){$('#unlockError').textContent=(error.name==='OperationError'||error.message?.includes('OperationError'))?'口令错误，未加载数据。':'解密失败，未加载数据。';}});
function setDemo(on) {
  state.mode = on ? 'demo' : 'live';
  $('#demoMode').classList.toggle('selected', on);
  $('#liveMode').classList.toggle('selected', !on);
  if (state.demoTimer) { clearInterval(state.demoTimer); state.demoTimer = null; }
  if (on) state.demoTimer = setInterval(() => { if (state.mode === 'demo' && state.data) renderMarket(); }, 1600);
  render();
}
$('#liveMode').onclick=()=>setDemo(false);
$('#demoMode').onclick=()=>setDemo(true);

$('#refresh').onclick=()=>loadSnapshot(state.passphrase);
$('#lock').onclick=()=>{state.data=null;state.passphrase=null;state.remembered=false;localStorage.removeItem('ops-pwa-passphrase');setUnlock();};
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
const saved=localStorage.getItem('ops-pwa-passphrase');loadSnapshot(saved||null);
