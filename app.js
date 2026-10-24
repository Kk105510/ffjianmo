'use strict';
(()=>{
const ORIGINAL_API = 'https://xivpf.littlenightmare.top';
const DC=['陆行鸟','莫古力','猫小胖','豆豆柴'];
const RACES=[
 ['人族','人男','人女',['人男','人族男','男中原','男高地','人类男','中原男','高地男','hyur male'],['人女','人族女','中原女','高地女','hyur female']],
 ['精灵族','精男','精女',['精男','精灵男','精灵族男','elezen male'],['精女','精灵女','精灵族女','elezen female']],
 ['拉拉菲尔','肥男','肥女',['肥男','拉拉男','拉拉肥男','拉拉菲尔男','lalafell male'],['肥女','拉拉女','拉拉肥女','拉拉菲尔女','lalafell female']],
 ['猫魅族','猫男','猫女',['猫男','猫魅男','猫魅族男','miqote male','miqo’te male'],['猫女','猫魅女','猫魅族女','miqote female','miqo’te female']],
 ['鲁加族','鲁加男','鲁加女',['鲁加男','鲁男','鲁加族男','roegadyn male'],['鲁加女','鲁女','鲁加族女','roegadyn female']],
 ['敖龙族','龙男','龙女',['龙男','敖龙男','敖龙族男','aura male','au ra male'],['龙女','敖龙女','敖龙族女','aura female','au ra female']],
 ['维埃拉族','兔男','兔女',['兔男','维埃拉男','维埃拉族男','viera male'],['兔女','维埃拉女','维埃拉族女','viera female']],
 ['硌狮族','狮男','狮女',['狮男','硌狮男','硌狮族男','rothgar male','hrothgar male'],['狮女','硌狮女','硌狮族女','rothgar female','hrothgar female']],
];
// Recognize common visually-slash Unicode symbols, not only ASCII '/' or full-width '／'.
// / U+002F, ／ U+FF0F, ⁄ U+2044, ∕ U+2215, ⧸ U+29F8, ╱ U+2571, ⫽ U+2AFD.
// Hyphens, dashes and backslashes are deliberately excluded (e.g. RP shop 17-60).
// Also allow full-width numerals in either part, preserving original text for highlights.
const PRICE_PATTERN=/(^|[^\d０-９])([1-9１-９][\d０-９]{0,5}(?:[.．][\d０-９]+)?)\s*([/／⁄∕⧸╱⫽])\s*([0-9０-９]{1,2})(?![\d０-９])/g;
const asciiDigits = s => String(s).replace(/[０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-65248));
const isAllowedDuration = s => ['10','20','30','40','50','60'].includes(asciiDigits(s));
function* priceMatches(text){
 PRICE_PATTERN.lastIndex=0;
 for (const m of String(text||'').matchAll(PRICE_PATTERN)) if(isAllowedDuration(m[4]))yield m;
}
const el=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=s=>String(s??'').toLowerCase().replace(/[\s\u3000]/g,'');
const $={race:'',dc:'',duration:'',sort:'recent',keyword:'',items:[],hasData:false,partial:false,progress:'',fetchedAt:null,loading:false,page:1,abort:null,error:'',activeReq:0,api:read('pf-api-base',ORIGINAL_API)};
const PAGE_SIZE=30;
function read(key,def){try{return localStorage.getItem(key)||def}catch{return def}}
function store(key,value){try{localStorage.setItem(key,value)}catch{}}
function humanLeft(s){if(!Number.isFinite(s)||s<=0)return '未提供';const m=Math.floor(s/60);return m>=60?`${Math.floor(m/60)}小时${m%60?m%60+'分':''}`:m+'分钟';}
function niceTime(v){const d=new Date(v);if(!Number.isFinite(d.getTime()))return '未知';return d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function buildRaces(){const node=el('raceGrid');node.innerHTML=RACES.map((r)=>[1,2].map((i)=>`<button type="button" class="race-chip" data-race="${esc(r[i])}" aria-pressed="false"><span>${esc(r[i])}</span></button>`).join('')).join(''); node.addEventListener('click',e=>{const b=e.target.closest('[data-race]');if(!b)return;$.race=$.race===b.dataset.race?'':b.dataset.race;$.page=1;renderRaces();render();});renderRaces();}
function renderRaces(){document.querySelectorAll('[data-race]').forEach(x=>{const selected=x.dataset.race===$.race;x.classList.toggle('is-selected',selected);x.setAttribute('aria-pressed',selected?'true':'false')});}
function aliasesForRace(race){const r=RACES.find(r=>r[1]===race||r[2]===race);return r?(race===r[1]?r[3]:r[4]):[]}
// Expand shared-gender shorthand such as 猫兔人男 → 猫男 / 兔男 / 人男.
// Explicit groups like 猫男兔女 are matched separately; do not infer gender where none is written.
const RACE_CHAR={人:'人',精:'精',肥:'肥',猫:'猫',鲁:'鲁加',龙:'龙',兔:'兔',狮:'狮'};
function modelHits(s){
 const n=normalize(s);const found=new Set();
 for(const race of RACES){
  for(let i=1;i<=2;i++){
   if(race[i===1?3:4].some(alias=>n.includes(normalize(alias))))found.add(race[i]);
  }
 }
 // Exact abbreviated combined lists, including punctuation between race characters.
 // Only expand when >=2 race tokens share an explicit trailing gender marker.
 const sep='[\\/／、,，+＋&和或\\s]*';
 const combo=new RegExp(`((?:[人精肥猫鲁龙兔狮]${sep}){2,8})(男女|男|女)(?![A-Za-z])`,'g');
 for(const m of n.matchAll(combo)){
  const chars=[...m[1]].filter(c=>RACE_CHAR[c]);
  if(chars.length<2)continue;
  const genders=m[2]==='男女'?['男','女']:[m[2]];
  for(const ch of chars)for(const sex of genders)found.add(RACE_CHAR[ch]+sex);
 }
 return found;
}
function raceKeyword(text){
 const q=normalize(text);
 if(!q)return '';
 for(const r of RACES)for(let i=1;i<=2;i++){
  if([r[i],...r[i===1?3:4]].some(alias=>normalize(alias)===q))return r[i];
 }
 return '';
}
function priceOf(s){
 const m=priceMatches(s).next().value;
 return m?{price:asciiDigits(m[2]),duration:asciiDigits(m[4]),raw:m[0].slice(m[1].length)}:null;
}
function markedText(s){
 const text=String(s||'');let result='',last=0;
 for(const m of priceMatches(text)){
  const start=m.index+m[1].length, end=m.index+m[0].length;
  result+=esc(text.slice(last,start));
  result+=`<mark class="price-inline">${esc(text.slice(start,end))}</mark>`;
  last=end;
 }
 return result+esc(text.slice(last));
}
function mapListing(row){if(!row||typeof row!=='object'||row.id==null)return null;const dc=String(row.datacenter||'').replace('陸行鳥','陆行鸟').replace('貓小胖','猫小胖');if(!DC.includes(dc))return null;const desc=String(row.description||'').slice(0,2500);return {id:String(row.id),dc,world:String(row.created_world||row.world||''),name:String(row.name||'匿名'),desc,category:String(row.category||''),updated:String(row.updated_at||''),left:Number(row.time_left)||0,slots:Number(row.slots_available)||0};}
function flattenGroups(obj){if(!obj||typeof obj!=='object')throw Error('接口数据格式不正确');const list=Array.isArray(obj.data)?obj.data:obj.listings;if(!Array.isArray(list))throw Error('接口没有返回招募列表');const pg=obj.pagination;if(!pg||!Number.isInteger(Number(pg.total_pages)))throw Error('分页数据格式不正确');return {list,total:Math.min(80,Math.max(0,Number(pg.total_pages)))};}
function mergeRows(rows){const map=new Map();for(const x of rows){const d=mapListing(x);if(!d)continue;const old=map.get(d.id);if(!old||String(d.updated)>String(old.updated))map.set(d.id,d);}return [...map.values()];}
function getFiltered(){const kw=normalize($.keyword),kwRace=raceKeyword(kw);const ds=$.duration;const arr=$.items.filter(row=>{
 const str=row.desc;const n=normalize(str);const parsed=priceOf(str);
 if($.dc&&row.dc!==$.dc)return false;
 if($.race&&!modelHits(str).has($.race))return false;
 if(kw&&(kwRace?!modelHits(row.desc).has(kwRace):!normalize(row.desc+' '+row.name+' '+row.world).includes(kw)))return false;
 if(!parsed)return false;
 if(ds&&(!parsed||parsed.duration!==ds))return false;
 return true;
 });
 arr.sort((a,b)=>$.sort==='time'?b.left-a.left:$.sort==='dc'?DC.indexOf(a.dc)-DC.indexOf(b.dc):String(b.updated).localeCompare(String(a.updated)));
 return arr;}
function render(){
 const items=getFiltered();el('resultCount').textContent=$.hasData?String(items.length):'—';el('resultHint').textContent=$.hasData?`已读取 ${$.items.length} 条国服招募 · ${$.partial?'仅部分页面，结果可能不完整':'筛选完成'}`:'等待数据源返回';el('updated').textContent=$.fetchedAt?`读取于 ${niceTime($.fetchedAt)}`:'—';
 const notice=el('notice');notice.hidden=!($.loading||$.error||$.partial);
 if($.loading)notice.textContent=$.progress||'正在获取招募…';else if($.error)notice.textContent=$.error;else if($.partial)notice.textContent='部分招募页请求失败或超过读取上限，当前展示的是已成功获取的部分记录。';
 el('sourceState').textContent=$.loading?'正在更新':$.error?'连接异常':$.hasData?($.partial?'部分数据':'已连接'):'尚未连接';
 el('refreshBtn').disabled=$.loading;
 const list=el('list');const pager=el('pager');if(!$.hasData){list.innerHTML=`<div class="empty-state"><h3>${$.error?'暂时无法读取招募':'正在等待招募数据'}</h3><p>${$.error?'检查数据源状态，或在设置中填入可用的自建代理地址。':'开始加载后，你可以选择人男、猫男等建模，并根据招募原文筛选。'}</p></div>`;pager.hidden=true;return;}
 if(!items.length){list.innerHTML=`<div class="empty-state"><h3>没有符合条件的招募</h3><p>仅显示带 /10～/60 的招募（不包含 17-60 一类写法）；可以切换大区、建模或关键词重试。第三方数据可能存在延迟。</p></div>`;pager.hidden=true;return;}
 const totalPages=Math.max(1,Math.ceil(items.length/PAGE_SIZE));$.page=Math.max(1,Math.min($.page,totalPages));const visible=items.slice(($.page-1)*PAGE_SIZE,$.page*PAGE_SIZE);
 list.innerHTML=visible.map(x=>{
  const age=x.updated?niceTime(x.updated):'未知时间';
  const displayText=x.desc.length>500?x.desc.slice(0,500)+'…':x.desc;
  return `<article class="listing"><div class="dcbox"><span class="dcbar" data-dc="${esc(x.dc)}"></span><div><div class="dcname">${esc(x.dc)}</div><div class="world">${esc(x.world||'服务器未知')}</div></div></div><div class="listcontent"><div class="posttext">${markedText(displayText)}</div><div class="postmeta"><span>更新 ${esc(age)}</span><span>剩余 ${esc(humanLeft(x.left))}</span></div></div><div class="postauthor" title="${esc(x.name)}">${esc(x.name)}</div><button type="button" class="copyBtn" data-copy="${esc(x.id)}">复制内容</button></article>`;
 }).join('');
 pager.hidden=items.length<=PAGE_SIZE;el('pageInfo').textContent=`${$.page} / ${totalPages}`;el('prevBtn').disabled=$.page===1;el('nextBtn').disabled=$.page===totalPages;
}
const timeoutFetch=async(url, signal, ms=18000)=>{const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort('timeout'),ms);const stop=()=>ctrl.abort('cancelled');signal?.addEventListener('abort',stop,{once:true});try{const r=await fetch(url,{signal:ctrl.signal,headers:{Accept:'application/json'}});if(!r.ok)throw Error(`接口状态 ${r.status}`);return await r.json()}finally{clearTimeout(timer);signal?.removeEventListener('abort',stop)}};
function sourceUrl(page){const url=new URL($.api.replace(/\/$/,'')+'/api/listings');url.searchParams.set('page',page);url.searchParams.set('per_page','100');return url.toString()}
async function update(){if($.abort)$.abort.abort();const req=++$.activeReq;$.abort=new AbortController();const signal=$.abort.signal;$.loading=true;$.error='';$.progress='正在连接招募数据源…';render();
 let combined=[],hasFailure=false;try{
  const first=flattenGroups(await timeoutFetch(sourceUrl(1),signal));combined.push(...first.list);let maxPages=first.total;
  if(maxPages>=80)hasFailure=true;
  let nextPage=2,done=1;const total=Math.max(1,maxPages);$.progress=`正在读取招募 · ${done}/${total} 页`;render();
  const workers=Array.from({length:Math.min(4,Math.max(0,maxPages-1))},async()=>{
   while(nextPage<=maxPages&&!signal.aborted){const p=nextPage++;try{const page=flattenGroups(await timeoutFetch(sourceUrl(p),signal));combined.push(...page.list)}catch(err){if(signal.aborted)throw err;hasFailure=true}done++;if(req!==$.activeReq)return;$.progress=`正在读取招募 · ${done}/${total} 页`;if(done===total||done%3===0)render();}
  });await Promise.all(workers);
  if(req!==$.activeReq)return;
  $.items=mergeRows(combined);$.hasData=true;$.partial=hasFailure;$.fetchedAt=Date.now();$.page=1;
 }catch(err){if(req!==$.activeReq||signal.aborted)return;$.error=`招募接口无法访问：${err?.message||'连接失败'}。可能是网络、接口维护或浏览器跨域限制。请勿将其视为“没有招募”。`;
 }finally{if(req===$.activeReq){$.loading=false;$.progress='';render()}}
}
function bind(){
 const bindings=[['searchInput','keyword'],['dcSelect','dc'],['durationSelect','duration'],['sortSelect','sort']];for(const [id,key] of bindings){el(id).addEventListener(id==='searchInput'?'input':'change',e=>{$[key]=e.target.value;$.page=1;render()})}
 el('refreshBtn').addEventListener('click',update);
 el('raceClear').addEventListener('click',()=>{$.race='';renderRaces();$.page=1;render()});el('resetBtn').addEventListener('click',()=>{$.race='';$.dc='';$.duration='';$.sort='recent';$.keyword='';$.page=1;el('searchInput').value='';el('dcSelect').value='';el('durationSelect').value='';el('sortSelect').value='recent';renderRaces();render()});
 el('prevBtn').addEventListener('click',()=>{$.page--;render()});el('nextBtn').addEventListener('click',()=>{$.page++;render()});
 el('list').addEventListener('click',async e=>{const id=e.target.closest('[data-copy]')?.dataset.copy;const item=$.items.find(x=>x.id===id);if(!item)return;const str=`${item.desc}\n${item.name}@${item.world||item.dc}`;try{await navigator.clipboard.writeText(str);const b=e.target.closest('[data-copy]');const old=b.textContent;b.textContent='已复制';setTimeout(()=>b.textContent=old,1200)}catch{window.prompt('复制招募内容',str)}});
 el('themeBtn').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';store('pf-theme',dark?'light':'dark')});
 el('settingsBtn').addEventListener('click',()=>{el('apiBaseInput').value=$.api;el('settingsDialog').showModal()});el('restoreApiBtn').addEventListener('click',()=>{el('apiBaseInput').value=ORIGINAL_API});
 el('settingsDialog').addEventListener('close',()=>{if(el('settingsDialog').returnValue==='save'){const raw=el('apiBaseInput').value.trim().replace(/\/$/,'');try{const u=new URL(raw);if(u.protocol!=='https:')throw Error();$.api=u.origin+u.pathname.replace(/\/$/,'');store('pf-api-base',$.api);update()}catch{window.alert('请填写有效的 HTTPS 接口地址。')}}});
}
function init(){const startup=el('startup');if(startup)startup.remove();document.documentElement.dataset.theme=read('pf-theme','light')==='dark'?'dark':'light';buildRaces();bind();render();update()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
