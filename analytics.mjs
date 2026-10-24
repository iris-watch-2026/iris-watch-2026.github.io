// Lightweight analytics layer: independent per-user records, never mutates the existing candidate database.
const KEY='sns-watch-box-v054-analytics';
const PREVIOUS='sns-watch-box-v052-analytics-test';
const utcDay=()=>new Date().toLocaleDateString('sv-SE');
const valid=h=>/^[A-Za-z0-9_]{1,15}$/.test(h);
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'));
const days=(a,b)=>dateOK(a)&&dateOK(b)?Math.max(0,Math.floor((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000)):null;
const byHandle=new Map();
let initialSource='new';
try{
 const existing=JSON.parse(localStorage.getItem(KEY)||'null');
 if(existing?.records&&Array.isArray(existing.records)){for(const x of existing.records){if(valid(x.handle))byHandle.set(x.handle.toLowerCase(),x)}initialSource='v054'}
 else{
  const legacy=JSON.parse(localStorage.getItem('sns-watch-box-v053-analytics')||localStorage.getItem(PREVIOUS)||'null');
  if(Array.isArray(legacy?.records)){for(const x of legacy.records){if(valid(x.handle))byHandle.set(x.handle.toLowerCase(),x)}initialSource='v053';}
  else if(Array.isArray(legacy)){for(const x of legacy){if(valid(x.handle))byHandle.set(x.handle.toLowerCase(),{handle:x.handle,registered:dateOK(x.registered)?x.registered:utcDay(),likes:Math.max(0,Number(x.likes)||0),events:Array.isArray(x.likeEvents)?x.likeEvents:[],followDate:dateOK(x.followDate)?x.followDate:null})}initialSource='v052';}
 }
}catch{}
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify({version:1,records:[...byHandle.values()]}));return true}catch{alert('分析データを保存できません。保存容量を確認してください。');return false}};
const get=(p)=>{const k=p.handle.toLowerCase();let x=byHandle.get(k);if(!x){x={handle:p.handle,registered:utcDay(),likes:0,events:[],followDate:null};byHandle.set(k,x);persist()}return x};
const txt=(v)=>document.createTextNode(String(v));
const btn=(label,title,fn)=>{const b=document.createElement('button');b.type='button';b.className='analytics-btn';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);b.onclick=e=>{e.stopPropagation();fn()};return b};
function refreshMetrics(){
 const all=[...byHandle.values()],followed=all.filter(x=>x.followDate);
 const rate=all.length?Math.round(followed.length/all.length*100):0, spans=followed.map(x=>days(x.registered,x.followDate)).filter(x=>x!==null);
 document.getElementById('analyticsCount').textContent=all.length+'人';
 document.getElementById('analyticsFollow').textContent=followed.length+'人';
 document.getElementById('analyticsRate').textContent=rate+'%';
 document.getElementById('analyticsDays').textContent=spans.length?(spans.reduce((a,b)=>a+b,0)/spans.length).toFixed(1)+'日':'−';
}
function makeControls(person){
 const x=get(person),out=document.createElement('div');out.className='analytics-controls';
 const count=document.createElement('span');count.className='analytics-like';count.textContent='♡'+x.likes;
 const plus=btn('＋♡','手動で押したいいねを1件記録',()=>{x.likes++;x.events.push({at:new Date().toISOString(),delta:1});persist();count.textContent='♡'+x.likes;refreshMetrics()});
 const follow=btn(x.followDate?'✔':'フォロー','相手からフォローされたことを確認',()=>{if(x.followDate){if(!confirm('フォロー確認記録を取り消しますか？'))return;x.followDate=null}else{x.followDate=utcDay()}persist();follow.textContent=x.followDate?'✔':'フォロー';follow.classList.toggle('is-followed',Boolean(x.followDate));refreshMetrics()});
 follow.classList.toggle('is-followed',Boolean(x.followDate));out.append(count,plus,follow);
 return out;
}
function addDetail(person){
 const x=get(person),div=document.createElement('div');div.className='analytics-detail';
 const info=document.createElement('span');info.textContent='登録 '+x.registered+' · '+(x.followDate?'フォロー確認 '+x.followDate+' / '+days(x.registered,x.followDate)+'日':'経過 '+days(x.registered,utcDay())+'日');div.append(info);
 const reset=btn('♡−1','手動いいねの記録を1件取り消す',()=>{if(x.likes<1)return;x.likes--;x.events.push({at:new Date().toISOString(),delta:-1});persist();document.querySelector('[data-person-id="'+CSS.escape(person.id)+'"] .analytics-like').textContent='♡'+x.likes;refreshMetrics()});div.append(reset);
 const date=btn('登録日','登録日を修正',()=>{const answer=prompt('登録日（YYYY-MM-DD）',x.registered);if(answer===null)return;if(!dateOK(answer)||answer>utcDay()){alert('日付を確認してください');return}x.registered=answer;persist();info.textContent='登録 '+x.registered+' · '+(x.followDate?'フォロー確認 '+x.followDate+' / '+days(x.registered,x.followDate)+'日':'経過 '+days(x.registered,utcDay())+'日');refreshMetrics()});div.append(date);
 const exportData=()=>JSON.stringify({format:'sns-watch-analytics-v053',exportedAt:new Date().toISOString(),records:[...byHandle.values()]},null,2);
 return div;
}
function download(){
 const blob=new Blob([JSON.stringify({format:'sns-watch-analytics-v053',exportedAt:new Date().toISOString(),records:[...byHandle.values()]},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='sns-watch-analytics-v053.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importFile(file){
 if(!file||file.size>10000000)throw Error('ファイルを確認してください');
 const json=JSON.parse(await file.text());
 if(json.format!=='sns-watch-analytics-v053'||!Array.isArray(json.records))throw Error('このファイルは分析バックアップではありません');
 if(!confirm('分析記録を上書きします。先に保存済みバックアップを確認してください。続行しますか？'))return;
 byHandle.clear();for(const x of json.records.slice(0,5000))if(valid(x.handle))byHandle.set(x.handle.toLowerCase(),x);
 persist();refreshMetrics();location.reload();
}
export function setupAnalytics(){
 document.getElementById('analyticsExport').onclick=download;
 const input=document.getElementById('analyticsImport'),button=document.getElementById('analyticsImportButton');
 button.onclick=()=>input.click();
 input.onchange=async()=>{try{await importFile(input.files[0])}catch(e){alert(e.message)}finally{input.value=''}};
 refreshMetrics();
}
export function primeCandidates(people){
 let dirty=false;
 for(const p of people||[]){if(!valid(p.handle))continue;const k=p.handle.toLowerCase();if(byHandle.has(k))continue;
 const initialDate=(p.posts?.[0]?.addedAt||p.addedAt||p.createdAt||'').slice(0,10);
 byHandle.set(k,{handle:p.handle,registered:dateOK(initialDate)?initialDate:utcDay(),likes:0,events:[],followDate:null});dirty=true;
 }
 if(dirty)persist();
 refreshMetrics();
}
export function analyticsFor(person){return {controls:makeControls(person),detail:addDetail(person)}}
export {refreshMetrics};
