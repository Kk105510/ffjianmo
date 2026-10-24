/* FF14 物价查询 · 静态网站 */
(() => {
  'use strict';
  const API = 'https://universalis.app/api/v2';
  const XIV_CN = 'https://xivapi-v2.xivcdn.com';
  const CAFE = 'https://cafemaker.wakingsands.com';
  const CENTERS = ['陆行鸟', '莫古力', '猫小胖', '豆豆柴'];
  const COLORS = {'陆行鸟':'#3aaceb','莫古力':'#f37799','猫小胖':'#68ce86','豆豆柴':'#e9b84b'};
  const QUICK_ITEMS = [];
  const el = id => document.getElementById(id);
  const fmt = n => Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
  const fixed = (n,d=2) => Number.isFinite(n) ? n.toFixed(d) : '—';
  const concise = n => Number(n.toFixed(2)).toLocaleString('zh-CN',{maximumFractionDigits:2});
  const compact = n => !Number.isFinite(n) ? '—' : n >= 1e8 ? `${concise(n / 1e8)}亿` : n >= 1e4 ? `${concise(n / 1e4)}万` : fmt(n);
  const safe = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numeric = v => {const n=Number(v);return Number.isFinite(n)?n:null};
  const validId = v => Number.isSafeInteger(Number(v)) && Number(v)>0 && Number(v)<10000000;
  const qs = new URLSearchParams(location.search);
  const local = (key, fallback) => {try {return JSON.parse(localStorage.getItem('eoradar_'+key)) ?? fallback;} catch{return fallback;}};
  const save = (key,value) => {try {localStorage.setItem('eoradar_'+key,JSON.stringify(value));}catch{}};
  const state = {
    item:null, dc: CENTERS.includes(qs.get('dc')) ? qs.get('dc') : 'all',
    quality:['all','nq','hq'].includes(qs.get('quality'))?qs.get('quality'):'all',
    hideOutliers:true,worldMap:new Map(),dcWorlds:new Map(),rawMarkets:[],rawSales:[],rows:[],daily:[],
    marketLoaded:false,historyLoaded:false,marketError:'',historyError:'',loadToken:0,searchToken:0,searchTimer:null,
    favourites:local('fav',[]),recent:local('recent',[]),favNames:local('favNames',{}),showAllFavourites:false,chartDates:[],metaReady:false
  };
  let toastTimer;
  let activeAbort = null;
  function toast(s){const x=el('toast');x.textContent=s;x.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>x.classList.remove('show'),2800)}
  function notice(msg){const x=el('notice');x.textContent=msg;x.classList.toggle('hidden',!msg)}
  function updateUrl(){const u=new URL(location.href);if(state.item)u.searchParams.set('item',state.item.id);else u.searchParams.delete('item');u.searchParams.set('dc',state.dc);u.searchParams.set('quality',state.quality);try{history.replaceState(null,'',u)}catch(e){console.warn('当前预览器不允许更新地址栏，忽略此限制',e)}}
  function percentile(sorted,p){if(!sorted.length)return null;const pos=(sorted.length-1)*p;const low=Math.floor(pos),high=Math.ceil(pos);return sorted[low]+(sorted[high]-sorted[low])*(pos-low)}
  function dateKey(ms){const d=new Date(ms);const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const ob={};parts.forEach(p=>ob[p.type]=p.value);return `${ob.year}-${ob.month}-${ob.day}`;}
  function relative(t){if(!t||!Number.isFinite(t))return '暂无时间';const diff=Math.max(0,Date.now()-t);if(diff<60000)return '刚刚';if(diff<3600000)return `${Math.floor(diff/60000)}分钟前`;if(diff<86400000)return `${Math.floor(diff/3600000)}小时前`;return `${Math.floor(diff/86400000)}天前`}
  function toMs(n){const v=numeric(n);if(v==null||v<=0)return null;return v<1e11?v*1000:v}
  function matchQuality(row){return state.quality==='all'||Boolean(row?.hq)===(state.quality==='hq')}
  async function fetchJSON(url,{timeout=16000,signal}={}){
    const ctrl=new AbortController();let timer;const relay=()=>ctrl.abort();if(signal){if(signal.aborted)ctrl.abort();else signal.addEventListener('abort',relay,{once:true})}
    try {timer=setTimeout(()=>ctrl.abort(),timeout);const r=await fetch(url,{signal:ctrl.signal,headers:{'Accept':'application/json'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.json();}
    finally {clearTimeout(timer);if(signal)signal.removeEventListener('abort',relay)}
  }
  async function loadMetadata(){
    try {
      const [dcList,worldList]=await Promise.all([fetchJSON(`${API}/data-centers`),fetchJSON(`${API}/worlds`)]);
      if(!Array.isArray(dcList)||!Array.isArray(worldList))return;
      const named=new Map(worldList.map(w=>[Number(w.id),w.name]));
      for(const dc of dcList){if(dc.region!=='中国')continue;state.dcWorlds.set(dc.name,dc.worlds.map(Number));for(const w of dc.worlds)state.worldMap.set(Number(w),{name:named.get(Number(w))||`#${w}`,dc:dc.name})}
      state.metaReady=true;
    }catch(e){console.warn('区服列表加载失败，将尝试直接从挂单记录读取服务器信息',e)}
  }
  function nameOfWorld(worldID,marketRow){const n=state.worldMap.get(Number(worldID))?.name||marketRow?.worldName;return n || `#${worldID}`}
  function marketUrl(dc,id){return `${API}/${encodeURIComponent(dc)}/${id}?entries=0`}
  function historyUrl(dc,id){return `${API}/history/${encodeURIComponent(dc)}/${id}?entriesToReturn=3000&entriesWithin=2592000`}
  function centerList(){return state.dc==='all'?CENTERS:[state.dc]}
  function setLoading(){state.rawMarkets=[];state.rawSales=[];state.marketLoaded=false;state.historyLoaded=false;state.rows=[];state.daily=[];state.marketError='';state.historyError='';
    ['stat-min','stat-median','stat-sales','stat-count'].forEach(id=>el(id).textContent='…');el('stat-min-server').textContent='数据加载中';el('stat-quartiles').textContent='计算中';el('stat-sales-note').textContent='读取成交记录中';el('stat-count-note').textContent='当前记录的挂单条数';el('stat-coverage').textContent='—';el('item-updated').textContent='正在更新…';el('listing-summary').textContent='—';el('export-button').disabled=true;el('server-rows').innerHTML='<div class="empty-state"><span class="loading-spinner"></span> 正在获取跨服市场数据…</div>';el('chart').innerHTML='<div class="empty-state"><span class="loading-spinner"></span> 正在读取 30 天成交历史…</div>';notice('');}
  async function loadPrices(){
    if(!state.item)return;
    const id=state.item.id;const token=++state.loadToken;
    activeAbort?.abort();activeAbort=new AbortController();const signal=activeAbort.signal;
    setLoading();
    const centers=centerList();
    const markets=Promise.allSettled(centers.map(dc=>fetchJSON(marketUrl(dc,id),{signal,timeout:11500}).then(data=>({dc,data}))));
    const histories=markets.then(()=>Promise.allSettled(centers.map(dc=>fetchJSON(historyUrl(dc,id),{signal,timeout:13000}).then(data=>({dc,data})))));
    markets.then(results=>{
      if(token!==state.loadToken)return;
      state.rawMarkets=results.filter(x=>x.status==='fulfilled' && Array.isArray(x.value?.data?.listings)).map(x=>x.value);
      state.marketLoaded=true;state.marketError=state.rawMarkets.length<centers.length?'部分或全部大区挂单接口失败':'';
      if(state.rawMarkets.length && state.marketError)notice('部分大区的挂单读取失败，当前结果只包含成功返回的数据。点击刷新可以重试。');
      if(!state.rawMarkets.length){const extra=location.protocol==='file:'?'此打开方式可能限制数据请求，请通过浏览器访问 HTTPS 网站。':'请检查网络是否能访问 Universalis。';el('server-rows').innerHTML='<div class="empty-state">行情获取失败或请求超时。请尝试「刷新」，也可切换大区。<br>'+extra+'</div>';notice('市场数据读取失败，页面不会伪造价格。'+extra)}
      renderMarket();
    });
    histories.then(results=>{
      if(token!==state.loadToken)return;
      state.rawSales=results.filter(x=>x.status==='fulfilled' && Array.isArray(x.value?.data?.entries)).map(x=>x.value);
      state.historyLoaded=true;state.historyError=state.rawSales.length<centers.length?'部分或全部成交历史暂不可用':'';
      renderHistory();renderMarket();
    });
  }
  function allListings(){const list=[];for(const {dc,data} of state.rawMarkets){for(const raw of data?.listings||[]){if(!matchQuality(raw))continue;const price=numeric(raw.pricePerUnit);const w=Number(raw.worldID || data.worldID);if(price==null||price<=0||!w)continue;list.push({...raw,pricePerUnit:price,worldID:w,dc,quantity:Number(raw.quantity)||1});}}return list}
  function salesEntries(){const list=[];for(const {dc,data} of state.rawSales){for(const raw of data?.entries||[]){if(!matchQuality(raw))continue;const p=numeric(raw.pricePerUnit),q=numeric(raw.quantity),t=toMs(raw.timestamp),w=Number(raw.worldID || data.worldID);if(p==null||p<=0||q==null||q<=0||!t)continue;list.push({...raw,pricePerUnit:p,quantity:q,time:t,worldID:w,dc})}}return list}
  function groupRows(){
    const groups=new Map();const current=allListings();
    for(const {dc,data} of state.rawMarkets){let ids=state.dcWorlds.get(dc)||[];if(!ids.length)ids=[...new Set((data?.listings||[]).map(r=>Number(r.worldID)).filter(Boolean))];for(const id of ids){const key=`${dc}-${id}`;groups.set(key,{dc,id,name:nameOfWorld(id),prices:[],count:0,qty:0,min:null,upload:toMs(data.worldUploadTimes?.[id])||(ids.length===1?toMs(data.lastUploadTime):null),median:null,p25:null,p75:null,daily:null,trend:null});}}
    for(const r of current){const key=`${r.dc}-${r.worldID}`;if(!groups.has(key))groups.set(key,{dc:r.dc,id:r.worldID,name:nameOfWorld(r.worldID,r),prices:[],count:0,qty:0,upload:null,daily:null,trend:null});const g=groups.get(key);g.prices.push(r.pricePerUnit);g.count++;g.qty+=r.quantity;g.min=g.min==null?r.pricePerUnit:Math.min(g.min,r.pricePerUnit)}
    const history=state.historyLoaded?salesEntries():[];const now=Date.now();
    const historyGroups=new Map();for(const sale of history){const key=`${sale.dc}-${sale.worldID}`;if(!historyGroups.has(key))historyGroups.set(key,[]);if(sale.time>=now-30*86400000)historyGroups.get(key).push(sale)}
    for(const g of groups.values()){
      g.prices.sort((a,b)=>a-b);g.p25=percentile(g.prices,.25);g.median=percentile(g.prices,.5);g.p75=percentile(g.prices,.75);
      if(state.historyLoaded&&state.rawSales.some(row=>row.dc===g.dc)){const h=historyGroups.get(`${g.dc}-${g.id}`)||[];const total=h.reduce((sum,x)=>sum+x.quantity,0);g.daily=total/30;
        const last7=h.filter(x=>x.time>=now-7*86400000).reduce((s,x)=>s+x.quantity,0);const prev7=h.filter(x=>x.time<now-7*86400000&&x.time>=now-14*86400000).reduce((s,x)=>s+x.quantity,0);
        g.trend=prev7>=3?(last7>prev7*1.15?'up':last7<prev7*.85?'down':null):null;
      }
    }
    return [...groups.values()].sort((a,b)=>(a.min??Infinity)-(b.min??Infinity)||a.dc.localeCompare(b.dc,'zh-CN')||a.name.localeCompare(b.name,'zh-CN'));
  }
  function renderMarket(){
    if(!state.marketLoaded)return;
    const current=allListings();const prices=current.map(x=>x.pricePerUnit).sort((a,b)=>a-b);const rows=groupRows();state.rows=rows;
    const best=rows.find(x=>x.min!=null);el('stat-min').textContent=best?fmt(best.min):'—';el('stat-min-server').textContent=best?`${best.dc} / ${best.name}`:'暂无挂单';
    el('stat-median').textContent=prices.length?`${compact(percentile(prices,.25))} ～ ${compact(percentile(prices,.75))}`:'—';el('stat-quartiles').textContent=prices.length?`中位价 ${fmt(percentile(prices,.5))} 金币`:'暂无挂单价格';
    el('stat-count').textContent=fmt(current.length);el('stat-count-note').textContent=`共 ${fmt(current.reduce((s,r)=>s+r.quantity,0))} 件库存`;
    el('stat-coverage').textContent=`${rows.filter(x=>x.count>0).length}/${rows.length} 服`;
    const times=rows.filter(x=>x.count>0).map(x=>x.upload).filter(Boolean);const last=times.length?Math.max(...times):null;
    el('item-updated').textContent=last?`最近上传：${relative(last)}`:'暂无可验证的更新时间';
    el('listing-summary').textContent=`${rows.filter(x=>x.count>0).length} 个服有挂单 · ${fmt(current.length)} 条挂单`;
    if(!state.rawMarkets.length){el('stat-count').textContent='—';el('stat-count-note').textContent='市场源未响应';el('stat-coverage').textContent='—';el('stat-sales').textContent=state.historyLoaded&&state.rawSales.length?el('stat-sales').textContent:'—';return;}
    if(!rows.length){el('server-rows').innerHTML='<div class="empty-state">该范围暂无服务器数据</div>';return}
    const all=prices;const maxMarket=all.length?(state.hideOutliers?Math.max(percentile(all,.92),percentile(all,.5)*1.5):all[all.length-1]):1;
    const minMarket=all.length?all[0]:0;const range=Math.max(1,maxMarket-minMarket);
    const toX=(n)=>Math.max(0,Math.min(100,((n-minMarket)/range)*100));
    el('scale-label').textContent=all.length?`${compact(minMarket)} – ${compact(maxMarket)}`:'';
    el('server-rows').innerHTML=rows.map(g=>{
      const color=COLORS[g.dc]||'#888888';const has=g.count>0;const dcLabel=state.dc==='all'?`<small>${safe(g.dc)}</small>`:'';
      const low=has?toX(g.min):0, hi=has?toX(g.p75):0,median=has?toX(g.median):0;
      const plot=has?`<div class="range-track" style="left:${low}%;width:${Math.max(1,hi-low)}%;--dc-color:${color};--track:${color}40" title="${safe(g.name)}：最低 ${fmt(g.min)} 金币，常见价区间上限 ${fmt(g.p75)} 金币"></div><div class="range-lower" style="left:${low}%;width:${Math.max(.6,median-low)}%;--dc-color:${color}"></div><div class="median-tick" style="left:${median}%" title="中位价 ${fmt(g.median)} 金币"></div>`:'<span class="no-data">暂无挂单</span>';
      const miniLabel=`<small class="mobile-server-meta">${fmt(g.count)} 条挂单 · ${g.upload?relative(g.upload):'时间未知'}</small>`;
      const trend=g.trend?` <span class="trend-arrow ${g.trend}">${g.trend==='up'?'↑':'↓'}</span>`:'';
      const stale=g.upload&&Date.now()-g.upload>48*3600000?' · 较旧':'';
      return `<div class="server-row"><div class="server-name" style="--dc-color:${color}"><i></i><span>${safe(g.name)}</span>${dcLabel}${miniLabel}</div><div class="number-cell min-cell" data-label="最低价">${has?fmt(g.min):'—'}</div><div class="number-cell median-cell" data-label="中位价">${has?fmt(g.median):'—'}</div><div class="range-cell">${has?`${fmt(g.p25)}～${fmt(g.p75)}`:'—'}</div><div class="plot-cell">${plot}</div><div class="number-cell volume-cell" data-label="挂单数">${fmt(g.count)}</div><div class="daily-cell" data-label="日均成交">${state.historyLoaded?(g.daily==null?'—':`${fixed(g.daily)}${trend}`):'读取中'}</div><div class="time-cell" data-label="更新时间" title="${g.upload?new Date(g.upload).toLocaleString('zh-CN'):'未知'}">${g.upload?relative(g.upload)+stale:'未知'}</div></div>`
    }).join('');
    if(state.historyLoaded && state.rawSales.length){const allSales=salesEntries().filter(x=>x.time>=Date.now()-30*86400000);const units=allSales.reduce((n,x)=>n+x.quantity,0);el('stat-sales').textContent=fixed(units/30);el('stat-sales-note').textContent=`记录到 ${fmt(units)} 件 / 30 天${state.historyError?' · 部分数据缺失':''}`}
    else{el('stat-sales').textContent=state.historyLoaded?'—':'…';el('stat-sales-note').textContent=state.historyLoaded?'成交数据源暂不可用':'读取成交记录中'}
  }
  function last30Days(){const today=dateKey(Date.now());const start=new Date(`${today}T12:00:00+08:00`).getTime();const dates=[];for(let i=29;i>=0;i--)dates.push(dateKey(start-i*86400000));return dates}
  function renderHistory(){
    if(!state.historyLoaded)return;
    if(!state.rawSales.length){el('chart').innerHTML='<div class="empty-state">成交记录暂时无法读取，请稍后刷新；不会以零销量冒充真实数据。</div>';el('history-summary').textContent='成交历史接口暂不可用。';el('export-button').disabled=true;return;}
    const dates=last30Days(),keys=new Set(dates);const daily=new Map(dates.map(date=>[date,{date,quantity:0,total:0,min:null,max:null,count:0}]));
    for(const x of salesEntries()){
      const key=dateKey(x.time);if(!keys.has(key))continue;const d=daily.get(key);d.quantity+=x.quantity;d.total+=x.pricePerUnit*x.quantity;d.min=d.min==null?x.pricePerUnit:Math.min(d.min,x.pricePerUnit);d.max=d.max==null?x.pricePerUnit:Math.max(d.max,x.pricePerUnit);d.count++;
    }
    state.daily=dates.map(d=>({...daily.get(d),avg:daily.get(d).quantity?daily.get(d).total/daily.get(d).quantity:null}));
    const total=state.daily.reduce((n,x)=>n+x.quantity,0);const days=state.daily.filter(x=>x.count>0).length;
    el('history-summary').textContent=`${days} 天有上传记录 · 合计 ${fmt(total)} 件；数据可能不完整，不能代表实际总交易量。${state.historyError?'（部分大区查询失败）':''}`;
    el('export-button').disabled=!state.daily.some(x=>x.count);
    drawChart();
  }
  const svgNode=(tag,attrs={},inner='')=>`<${tag} ${Object.entries(attrs).map(([k,v])=>`${k}="${safe(v)}"`).join(' ')}>${inner}</${tag}>`;
  function drawChart(){
    if(!state.historyLoaded)return;const data=state.daily;if(!data.length)return;
    const holder=el('chart');const w=Math.max(300,holder.clientWidth||780),mobile=w<650,h=mobile?146:174,margin={left:mobile?42:56,right:mobile?10:29,top:11,bottom:25};
    const plotW=w-margin.left-margin.right,plotH=h-margin.top-margin.bottom;const nonempty=data.filter(x=>x.avg!=null);
    if(!nonempty.length){holder.innerHTML='<div class="empty-state">近 30 天没有可用的成交记录。尝试选择「全部品质」或更大的查询范围。</div>';return}
    const allLow=Math.min(...nonempty.map(x=>x.min)),allHigh=Math.max(...nonempty.map(x=>x.max));
    const min=Math.max(0,allLow-(allHigh-allLow)*.12),max=allHigh+(allHigh-allLow||allHigh*.08||1)*.12;
    const ymax=Math.max(1,...data.map(x=>x.quantity));const px=i=>margin.left+(i/(data.length-1))*plotW,py=n=>margin.top+(1-(n-min)/Math.max(1,max-min))*plotH;
    const bars=data.map((d,i)=>{const bw=Math.max(3,(plotW/30)*.61);return `<rect class="volume-bar" x="${px(i)-bw/2}" y="${margin.top+plotH-(d.quantity/ymax)*plotH*.72}" width="${bw}" height="${Math.max(0.1,(d.quantity/ymax)*plotH*.72)}" rx="1.5"/>`}).join('');
    const lows=nonempty.map(x=>({i:data.indexOf(x),y:py(x.min)})),highs=nonempty.map(x=>({i:data.indexOf(x),y:py(x.max)}));
    const rangePoly=highs.map(p=>`${px(p.i)},${p.y}`).concat(lows.slice().reverse().map(p=>`${px(p.i)},${p.y}`)).join(' ');
    const line=nonempty.map((x,j)=>`${j?'L':'M'} ${px(data.indexOf(x))} ${py(x.avg)}`).join(' ');
    const grid=Array.from({length:5},(_,i)=>{const price=min+(max-min)*(4-i)/4,y=margin.top+(plotH*i/4);return `<line class="gridline" x1="${margin.left}" x2="${w-margin.right}" y1="${y}" y2="${y}"/><text class="price-axis-label" x="${margin.left-9}" y="${y+4}" text-anchor="end">${safe(compact(price))}</text>`}).join('');
    const xi=mobile?[0,7,14,21,29]:[0,5,10,15,20,25,29];const xlabels=xi.map(i=>`<text x="${px(i)}" y="${h-9}" text-anchor="middle">${data[i].date.slice(5).replace('-','/')}</text>`).join('');
    const ticks=nonempty.map(x=>`<circle class="price-dot" cx="${px(data.indexOf(x))}" cy="${py(x.avg)}" r="2.8"/>`).join('');
    const priceDots=mobile?'':ticks;
    holder.innerHTML=`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="过去30天成交均价与每日成交件数走势图">${grid}${bars}<polygon class="range-band" points="${rangePoly}"/><path class="price-line" d="${line}"/>${priceDots}${xlabels}<line id="chart-cursor" class="hover-line" x1="0" x2="0" y1="${margin.top}" y2="${margin.top+plotH}" style="display:none"/></svg>`;
    const svg=holder.querySelector('svg');const tooltip=el('chart-tooltip');
    function show(ev){const box=svg.getBoundingClientRect();const x=(ev.clientX-box.left)*w/Math.max(box.width,1);const i=Math.max(0,Math.min(29,Math.round((x-margin.left)/plotW*29)));const d=data[i];
      const cursor=el('chart-cursor');cursor.style.display='';cursor.setAttribute('x1',px(i));cursor.setAttribute('x2',px(i));
      tooltip.innerHTML=`<strong>${safe(d.date)}</strong>${d.count?`均价 ${fmt(d.avg)} 金币/件<br>价格范围 ${fmt(d.min)} ～ ${fmt(d.max)} 金币<br>成交 ${fmt(d.quantity)} 件`:'暂无已上传成交'}`;
      tooltip.classList.remove('hidden');const half=tooltip.offsetWidth/2;tooltip.style.left=`${Math.max(half+5,Math.min(holder.clientWidth-half-5,ev.clientX-holder.getBoundingClientRect().left))}px`;
      tooltip.style.top=`${Math.max(2,ev.clientY-holder.getBoundingClientRect().top-tooltip.offsetHeight-13)}px`;tooltip.style.transform='translateX(-50%)';
    }
    svg.addEventListener('pointermove',show);svg.addEventListener('click',show);
    svg.addEventListener('pointerleave',()=>{tooltip.classList.add('hidden');el('chart-cursor').style.display='none'});
  }
  // 中文物品搜索同时尝试两套物品 API，并提供公开物品名称映射作备用。
  // 独立静态部署无需自有后端；外部服务不可用时会明确报告失败。
  let mappingPromise=null;
  async function queryMapping(q){
    if(!mappingPromise){
      const source='https://raw.githubusercontent.com/dz-knight/ff14-/main/data/item_mapping.min.json';
      mappingPromise=fetchJSON(source,{timeout:12000}).then(x=>{
        const entries=x.Entries||x.entries||[];
        if(!Array.isArray(entries)||!entries.length)throw Error('备用映射格式异常');
        return entries;
      }).catch(e=>{mappingPromise=null;throw e});
    }
    const entries=await mappingPromise;const k=q.toLocaleLowerCase();const rows=[];
    for(const r of entries){const name=String(r.ZhName||r.zhName||'');const en=String(r.EnName||r.enName||'');const id=Number(r.ItemId||r.itemId);
      if(validId(id)&&(name.toLocaleLowerCase().includes(k)||en.toLocaleLowerCase().includes(k)))rows.push({id,name:name||en,icon:r.IconPath||r.iconPath||''});
      if(rows.length>=45)break;
    }
    return rows.sort((x,y)=>Number(y.name===q)-Number(x.name===q));
  }
  async function queryItems(keyword){
    const q=keyword.trim().slice(0,85);if(!q)return[];
    if(validId(q))return [{id:Number(q),name:`物品 #${q}`}];
    const searchQuery=`Name~"${q.replace(/["\\]/g,'').trim()}"`;
    const params=new URLSearchParams({sheets:'Item',query:searchQuery,language:'chs',fields:'Name,Icon',limit:'40'});
    const p=new URLSearchParams({indexes:'Item',string:q,language:'chs',limit:'40',columns:'ID,Name,Icon'});
    const sources=[
      fetchJSON(`${XIV_CN}/api/search?${params}`,{timeout:8500}).then(data=>{
        if(!Array.isArray(data.results))throw Error('中文物品搜索数据格式异常');
        return data.results.map(r=>({id:Number(r.row_id),name:typeof r.fields?.Name==='string'?r.fields.Name:r.fields?.Name?.value||'',icon:iconFromFields(r.fields)})).filter(r=>validId(r.id)&&r.name);
      }),
      fetchJSON(`${CAFE}/search?${p}`,{timeout:8500}).then(data=>{
        if(!Array.isArray(data.Results))throw Error('备用物品搜索数据格式异常');
        return data.Results.map(r=>({id:Number(r.ID),name:r.Name,icon:r.Icon})).filter(r=>validId(r.id)&&r.name);
      }),
      queryMapping(q)
    ];
    // 返回第一批非空结果，而不是被其中一个坏接口拖死。
    const results=await Promise.any(sources.map(x=>x.then(rows=>{
      if(!rows.length)throw Error('未命中');return rows;
    })));
    return [...new Map(results.map(x=>[x.id,x])).values()].sort((a,b)=>Number(b.name===q)-Number(a.name===q));
  }
  function iconFromFields(fields){let icon=fields?.Icon;if(typeof icon==='string')return icon;if(typeof icon?.path==='string')return icon.path;if(typeof icon?.value==='string')return icon.value;return ''}
  function iconURL(path){const v=String(path||'');if(/^https:\/\//.test(v))return v;if(/^\/?ui\/icon\//.test(v))return `${XIV_CN}/api/asset?path=${encodeURIComponent(v.replace(/^\//,''))}`;if(/^\/i\/\d+\/\d+/.test(v))return XIV_CN+v;if(/^\/api\//.test(v))return XIV_CN+v;return ''}
  function searchStatus(msg){el('search-status').textContent=msg||'';}
  function renderSuggestions(rows,query){const box=el('search-results');box._results=[];
    if(!rows.length){box.innerHTML='<div class="suggestion-message">没找到对应物品。可改用完整名称，或输入物品数字 ID。</div>';box.classList.remove('hidden');return}
    box._results=rows.slice(0,18);
    box.innerHTML=box._results.map((r,i)=>`<button class="suggestion" data-index="${i}" role="option"><span class="suggestion-icon">${iconURL(r.icon)?`<img src="${safe(iconURL(r.icon))}" alt="" loading="lazy">`:'✧'}</span><span class="suggestion-body"><strong>${safe(r.name)}</strong><small>点击查看市场行情</small></span><span class="suggestion-id">#${r.id}</span></button>`).join('');box.classList.remove('hidden');el('search-input').setAttribute('aria-expanded','true');
  }
  function hideSuggestions(){el('search-results').classList.add('hidden');el('search-input').setAttribute('aria-expanded','false')}
  function showSearchError(){const box=el('search-results');box._results=[];box.innerHTML='<div class="suggestion-message">物品搜索暂时不可用，可尝试输入物品 ID，或稍后重试。</div>';box.classList.remove('hidden');searchStatus('搜索失败：外部物品资料接口未响应。')}
  async function inputSearch(){const q=el('search-input').value.trim();const token=++state.searchToken;
    el('search-results')._results=[];searchStatus('');if(!q){hideSuggestions();return}if(q.length<2&&!validId(q)){hideSuggestions();return}
    el('search-results').innerHTML='<div class="suggestion-message"><span class="loading-spinner"></span> 正在查找物品…</div>';el('search-results').classList.remove('hidden');
    try{const list=await queryItems(q);if(token!==state.searchToken||el('search-input').value.trim()!==q)return;renderSuggestions(list,q);searchStatus(list.length?`找到 ${list.length} 个候选物品，请从下拉结果选择。`:'没有找到匹配的物品。')}
    catch(e){if(token!==state.searchToken)return;showSearchError()}
  }
  async function performSearch(){const q=el('search-input').value.trim();if(!q){searchStatus('请先输入物品名称或 ID');el('search-input').focus();return}
    if(validId(q)){selectItem({id:Number(q),name:`物品 #${q}`});return}
    const btn=el('search-button');btn.disabled=true;btn.textContent='正在搜索…';searchStatus('正在查找「'+q+'」…');
    try{
      let results=el('search-results')._results||[];
      if(!results.some(x=>x.name===q)){results=await queryItems(q)}
      if(el('search-input').value.trim()!==q)return;
      if(!results.length){renderSuggestions([],q);searchStatus('没找到，请尝试更完整的名称或物品 ID。');return}
      const exact=results.filter(x=>x.name===q);if(exact.length===1){selectItem(exact[0]);return}
      if(results.length===1){selectItem(results[0]);return}
      renderSuggestions(results,q);searchStatus(`找到 ${results.length} 个候选物品，请从下拉结果中点击选择。`);
    }catch(e){showSearchError()}
    finally{btn.disabled=false;btn.textContent='查询价格'}
  }
  const RECENT_LIMIT = 7;
  const FAVOURITES_VISIBLE = 8;
  function rememberFavouriteName(item){
    if(!item || !validId(item.id) || !item.name || item.name.startsWith('物品 #'))return;
    if(!state.favourites.includes(Number(item.id)))return;
    state.favNames[item.id] = item.name;
    save('favNames',state.favNames);
  }
  function addRecent(item){
    const k=state.recent.filter(r=>Number(r.id)!==Number(item.id));
    state.recent=[{id:item.id,name:item.name},...k].slice(0,RECENT_LIMIT);
    save('recent',state.recent);
    rememberFavouriteName(item);
    renderRecent();
  }
  function renderRecent(){
    // 最近查询与收藏是两份独立的本地记录，清理一份不会影响另一份。
    const recent=Array.isArray(state.recent)?state.recent.slice(0,RECENT_LIMIT):[];
    const favouriteIds=Array.isArray(state.favourites)?[...new Set(state.favourites.map(Number).filter(validId))]:[];
    const favouriteLabels=favouriteIds.map(id=>{
      const current=state.item?.id===id && !state.item?.name.startsWith('物品 #')?state.item.name:null;
      const recentName=recent.find(r=>Number(r.id)===id && !String(r.name).startsWith('物品 #'))?.name;
      return {id,name:current||state.favNames?.[id]||recentName||`物品 #${id}`};
    });
    // 迁移旧版收藏时，优先保留原历史记录里的中文名称。
    let updated=false;
    for(const fav of favouriteLabels){if(!String(fav.name).startsWith('物品 #') && state.favNames[fav.id]!==fav.name){state.favNames[fav.id]=fav.name;updated=true}}
    if(updated)save('favNames',state.favNames);
    const chip=r=>`<button type="button" class="chip" data-id="${r.id}" data-name="${safe(r.name)}">${safe(r.name)}</button>`;
    el('recent-chips').innerHTML=recent.length?recent.map(chip).join(''):'<span class="recent-placeholder">暂无查询记录</span>';
    el('clear-recent-button').hidden=recent.length===0;el('recent-line').hidden=recent.length===0;
    el('favorites-line').hidden=favouriteLabels.length===0;
    el('favorite-chips').innerHTML=(state.showAllFavourites?favouriteLabels:favouriteLabels.slice(0,FAVOURITES_VISIBLE)).map(chip).join('');
    const more=el('more-favorites-button');
    more.hidden=favouriteLabels.length<=FAVOURITES_VISIBLE;
    if(!more.hidden)more.textContent=state.showAllFavourites?'收起收藏':`展开其余 ${favouriteLabels.length-FAVOURITES_VISIBLE} 项`;
  }
  function selectItem(item){if(!validId(item.id))return;clearTimeout(state.searchTimer);state.searchToken++;const same=state.item?.id===Number(item.id);state.item={...item,id:Number(item.id)};el('market-dashboard').classList.remove('hidden');el('welcome-state').classList.add('hidden');el('fav-button').disabled=false;el('refresh-button').disabled=false;hideSuggestions();searchStatus('');el('search-input').value=item.name.startsWith('物品 #')?'':item.name;updateHeader();addRecent(item);updateFav();updateUrl();if(!same||!state.marketLoaded)loadPrices();else renderAll();loadItemDetails(item.id)}
  function updateHeader(){el('item-id-label').textContent=`#${state.item.id}`;el('item-name').textContent=state.item.name;el('item-description').textContent='正在获取物品描述…';el('item-icon').innerHTML='<span>✧</span>';}
  async function loadItemDetails(id){const expected=id;let data=null;try{const p=new URLSearchParams({language:'chs',fields:'Name,Description,Icon,CanBeHq,IsUntradable'});const r=await fetchJSON(`${XIV_CN}/api/sheet/Item/${id}?${p}`,{timeout:11000});data={name:r.fields?.Name,description:r.fields?.Description,icon:iconFromFields(r.fields)};}
    catch(e){try{const r=await fetchJSON(`${CAFE}/item/${id}?language=chs`,{timeout:8000});data={name:r.Name,description:r.Description,icon:r.Icon}}catch{}}
    if(state.item.id!==expected)return;
    const name=typeof data?.name==='string'?data.name: data?.name?.value;
    if(name&&String(name).trim()){state.item.name=String(name).trim();el('item-name').textContent=state.item.name;if(!el('search-input').value||el('search-input').value===`物品 #${id}`)el('search-input').value=state.item.name;}
    const desc=typeof data?.description==='string'?data.description:data?.description?.value;
    el('item-description').textContent=desc?String(desc).replace(/<[^>]*>/g,'').slice(0,120):'市场板数据来源：Universalis · 价格以游戏内为准';
    const image=iconURL(data?.icon || state.item.icon);if(image)el('item-icon').innerHTML=`<img src="${safe(image)}" alt="物品图标" onerror="this.parentNode.textContent='✧'">`;
    // 查询详情回填中文名称时同步更新历史和收藏标签。
    const last=state.recent.find(r=>Number(r.id)===expected);
    if(last && last.name!==state.item.name){last.name=state.item.name;save('recent',state.recent)}
    rememberFavouriteName(state.item);
    updateFav();
  }
  function updateFav(){const favourite=state.favourites.includes(state.item.id);el('fav-icon').textContent=favourite?'★':'☆';el('fav-label').textContent=favourite?'已收藏':'收藏';el('fav-button').setAttribute('aria-pressed',String(favourite));el('fav-button').setAttribute('aria-label',favourite?'取消收藏当前物品':'收藏当前物品');renderRecent()}
  function renderAll(){renderMarket();renderHistory()}
  function changeQuality(q){state.quality=q;document.querySelectorAll('[data-quality]').forEach(b=>{const active=b.dataset.quality===q;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});updateUrl();if(state.item)renderAll()}
  function exportCSV(){if(!state.daily.length)return;const rows=[['日期','成交件数(已上传)','均价(金币/件)','最低价(金币/件)','最高价(金币/件)','成交记录数'],...state.daily.map(x=>[x.date,x.quantity,x.avg??'',x.min??'',x.max??'',x.count])];const csv='\ufeff'+rows.map(r=>r.join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`FF14_成交记录_${state.item.id}_${state.dc==='all'?'全区':state.dc}_${state.quality}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
  function init(){
    el('theme-button').addEventListener('click',()=>{const on=document.documentElement.classList.toggle('dark');save('dark',on);el('theme-button').textContent=on?'☀':'☾'});
    el('script-warning')?.remove();
    document.documentElement.classList.toggle('dark',local('dark',false));el('theme-button').textContent=document.documentElement.classList.contains('dark')?'☀':'☾';
    el('scope-select').value=state.dc;el('outlier-switch').checked=state.hideOutliers;
    document.querySelectorAll('[data-quality]').forEach(b=>{b.classList.toggle('active',b.dataset.quality===state.quality);b.setAttribute('aria-pressed',String(b.dataset.quality===state.quality))});
    el('search-input').addEventListener('input',()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(inputSearch,350)});
    el('search-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();performSearch()}else if(e.key==='Escape')hideSuggestions()});
    el('search-button').addEventListener('click',performSearch);
    el('search-results').addEventListener('click',e=>{const b=e.target.closest('.suggestion');if(b){const item=el('search-results')._results?.[Number(b.dataset.index)];if(item)selectItem(item)}});
    document.addEventListener('click',e=>{if(!el('search-wrap').contains(e.target))hideSuggestions()});
    for(const group of ['recent-chips','favorite-chips']){
      el(group).addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)selectItem({id:Number(b.dataset.id),name:b.dataset.name})});
    }
    el('clear-recent-button').addEventListener('click',()=>{
      state.recent=[];
      save('recent',[]);
      renderRecent();
      toast('查询历史已清空，收藏未改变');
    });
    el('more-favorites-button').addEventListener('click',()=>{state.showAllFavourites=!state.showAllFavourites;renderRecent()});
    el('scope-select').addEventListener('change',e=>{state.dc=e.target.value;save('dc',state.dc);updateUrl();if(state.item)loadPrices()});
    document.querySelectorAll('[data-quality]').forEach(b=>b.addEventListener('click',()=>changeQuality(b.dataset.quality)));
    el('outlier-switch').addEventListener('change',e=>{state.hideOutliers=e.target.checked;renderMarket()});
    el('refresh-button').addEventListener('click',()=>{if(!state.item)return;toast('正在重新读取行情');loadPrices()});
    el('fav-button').addEventListener('click',()=>{if(!state.item)return;const n=state.item.id;state.favourites=state.favourites.includes(n)?state.favourites.filter(x=>x!==n):[n,...state.favourites];save('fav',state.favourites);rememberFavouriteName(state.item);updateFav();toast(state.favourites.includes(n)?'已加入收藏':'已移出收藏')});
    el('share-button').addEventListener('click',async()=>{const url=location.href;try{await navigator.clipboard.writeText(url);toast('查询链接已复制')}catch{const t=document.createElement('textarea');t.value=url;document.body.append(t);t.select();try{document.execCommand('copy');toast('查询链接已复制')}catch{toast('复制失败，请从地址栏复制链接')}t.remove()}});
    el('export-button').addEventListener('click',exportCSV);
    let lastW=0;if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{const w=el('chart').clientWidth;if(Math.abs(w-lastW)>8){lastW=w;drawChart()}}).observe(el('chart'));
    renderRecent();const item=qs.get('item');
    if(validId(item))selectItem({id:Number(item),name:`物品 #${item}`});
    loadMetadata().then(()=>{if(state.marketLoaded)renderMarket()});
  }
  function safeInit(){
    try { init(); }
    catch(error){
      console.error('网站启动异常:',error);
      const warn=el('script-warning');
      if(warn){warn.style.display='block';warn.textContent='页面加载失败，请刷新网页后重试。';}
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',safeInit);else safeInit();
})();
