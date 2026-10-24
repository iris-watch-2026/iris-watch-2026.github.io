import {STATES,LIMITS,defaults,collectPosts,promoteInbox,removeInbox,setInboxSelected,setSelected,startSession,markChecked,undoChecked,updatePerson,deletePerson,removePost,upsertGenre,deleteGenre,counts,searchUrl,decodeBackup,encodeBackup,reorderPeople} from './core.mjs';
import {createStore} from './storage.mjs';
import {patrolState,sortCandidates,shortGenres} from './candidate-ui.mjs';
import {setupReorder} from './reorder-ui.mjs';
import {PILOT_HANDLES,readFeed,applyFeedResults,recordFeedAttempt,dueHandles,feedState,RSS_REQUEST_SPACING_MS} from './rss.mjs';
import {setupAnalytics,analyticsFor,primeCandidates,refreshMetrics,snapshotAnalytics,validateAnalyticsSnapshot,applyAnalyticsSnapshot} from './analytics.mjs';
import {encodeCombinedBackup,decodeCombinedBackup,COMBINED_MAX_BYTES} from './combined-backup.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const on=(id,type,fn)=>$(id).addEventListener(type,e=>{try{Promise.resolve(fn(e)).catch(error=>notice(error.message||'処理できませんでした。',true));}catch(error){notice(error.message||'処理できませんでした。',true);}});
const btn=(text,fn,cls='secondary')=>{const b=el('button',text,cls);b.type='button';b.addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>notice(e.message,true)));return b;};
const link=(url,text,cls='')=>{const a=el('a',text,cls);a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';a.addEventListener('click',()=>{const row=a.closest('[data-person-id]');snapshotView(row?.dataset.personId);if(row){ui.lastOpened[activePage]=row.dataset.personId;persistUi();updateReturnButton();}});return a;};
const label=(text,input)=>{const n=el('label',text);n.append(input);return n;};
const check=(text,checked,fn)=>{const n=el('label','','pick'),c=el('input');c.type='checkbox';c.checked=checked;c.addEventListener('change',()=>Promise.resolve(fn(c.checked)).catch(e=>{c.checked=!c.checked;notice(e.message,true);}));n.append(c,document.createTextNode(text));return n;};
let data=null,revision=-1,store,pendingRestore=null,restoreToken=0,queue=Promise.resolve(),installPrompt=null,scanPending=false,scanDone=0,scanTotal=0,lastFeedRequestAt=0;
const handleDrafts=new Map();
const personDrafts=new Map(),UI_KEY='xpatrol-v051-rss-test:view:'+location.pathname,PAGES=['inbox','people','genres','patrol','backup'];
let ui={page:'people',genre:'',status:'',freshness:'',sort:'priority',expanded:[],patrolExpanded:[],filters:false,help:false,positions:{},lastOpened:{}},activePage='people',uiReady=false,renderingPeople=false;
let userViewIntent=0,candidateControlsIntent=0;
let savedUi='';try{savedUi=sessionStorage.getItem(UI_KEY)||'';}catch{}if(!savedUi)try{savedUi=localStorage.getItem(UI_KEY)||'';}catch{}
try{const saved=JSON.parse(savedUi||'null');if(saved&&typeof saved==='object'){for(const key of ['genre','status','freshness','sort'])if(typeof saved[key]==='string')ui[key]=saved[key];if(PAGES.includes(saved.page))ui.page=saved.page;for(const key of ['filters','help'])if(typeof saved[key]==='boolean')ui[key]=saved[key];for(const key of ['expanded','patrolExpanded'])if(Array.isArray(saved[key]))ui[key]=saved[key].filter(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id)).slice(0,5000);for(const name of PAGES){const p=saved.positions?.[name];if(p&&Number.isFinite(p.y)&&p.y>=0)ui.positions[name]={y:p.y,id:typeof p.id==='string'?p.id:'',offset:Number.isFinite(p.offset)?p.offset:0};if(typeof saved.lastOpened?.[name]==='string')ui.lastOpened[name]=saved.lastOpened[name];}}}catch{}
if(!['priority','oldest','newest','manual'].includes(ui.sort))ui.sort='priority';
const expandedPeople=new Set(ui.expanded),expandedPatrol=new Set(ui.patrolExpanded),restoreTimers=new Set();let restoreSequence=0,programmaticUntil=0,scrollSaveTimer;
const reorder=setupReorder({root:$('personList'),onCommit:async(originalIds,orderedIds,sourceId)=>{const position=capturePosition(sourceId),intent=userViewIntent,controlsIntent=candidateControlsIntent,pageId=activePage;cancelPositionRestore();await save(d=>reorderPeople(d,originalIds,orderedIds));if(controlsIntent===candidateControlsIntent){$('sortPeople').value='manual';ui.sort='manual';persistUi();}const preserveSource=pageId===activePage&&intent===userViewIntent&&document.visibilityState!=='hidden';renderPeople(preserveSource?position:undefined);$('reorderStatus').textContent='並び順を保存しました。';return preserveSource;},onDragChange:active=>{if(active)cancelPositionRestore();},onError:error=>{renderPeople();notice(error.message||'並び順を保存できませんでした。',true);return false;}});
try{history.scrollRestoration='manual';}catch{}
function persistUi(){ui.page=activePage;ui.expanded=[...expandedPeople];ui.patrolExpanded=[...expandedPatrol];const value=JSON.stringify(ui);try{sessionStorage.setItem(UI_KEY,value);}catch{}try{localStorage.setItem(UI_KEY,value);}catch{}}
function rowFor(id,pageId=activePage){return [...($(pageId)?.querySelectorAll('[data-person-id]')||[])].find(row=>row.dataset.personId===id);}
function capturePosition(preferredId){const section=$(activePage),top=Math.max(0,document.querySelector('.tabs').getBoundingClientRect().bottom)+4,rows=[...(section?.querySelectorAll('[data-person-id]')||[])];const row=(preferredId&&rowFor(preferredId))||rows.find(n=>{const r=n.getBoundingClientRect();return r.bottom>top&&r.top<innerHeight;});return {y:scrollY,id:row?.dataset.personId||'',offset:row?row.getBoundingClientRect().top:0};}
function snapshotView(preferredId){if(!uiReady)return;ui.positions[activePage]=capturePosition(preferredId);persistUi();}
function cancelPositionRestore(){restoreSequence++;for(const timer of restoreTimers)clearTimeout(timer);restoreTimers.clear();}
function restorePosition(position){if(!position||!uiReady)return;cancelPositionRestore();const sequence=restoreSequence,pageId=activePage;
  for(const delay of [0,100,350]){const timer=setTimeout(()=>{restoreTimers.delete(timer);if(sequence!==restoreSequence||pageId!==activePage||document.visibilityState==='hidden')return;const row=position.id&&rowFor(position.id,pageId),target=row?scrollY+row.getBoundingClientRect().top-position.offset:position.y;programmaticUntil=performance.now()+100;window.scrollTo({top:Math.max(0,target),behavior:'instant'});},delay);restoreTimers.add(timer);}}
function updateReturnButton(){const button=$('returnToPerson');button.hidden=!ui.lastOpened.people;}
for(const type of ['wheel','touchstart','pointerdown'])window.addEventListener(type,event=>{if(event.isTrusted)userViewIntent++;cancelPositionRestore();},{passive:true,capture:true});
window.addEventListener('keydown',e=>{if(e.isTrusted)userViewIntent++;if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key))cancelPositionRestore();},{capture:true});
window.addEventListener('scroll',()=>{if(performance.now()>programmaticUntil)cancelPositionRestore();clearTimeout(scrollSaveTimer);scrollSaveTimer=setTimeout(()=>snapshotView(),120);},{passive:true});
window.addEventListener('pagehide',()=>{clearTimeout(scrollSaveTimer);cancelPositionRestore();snapshotView();});
let channel;try{channel=new BroadcastChannel('xp051rss-changed');channel.onmessage=()=>refresh();}catch{}
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('is-error',error);$('notice').hidden=false;}
function page(id,{initial=false}={}){if(!PAGES.includes(id))return;reorder.cancel();if(!initial&&id===activePage)return;if(!initial)snapshotView();cancelPositionRestore();activePage=id;document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==id);document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});ui.page=id;persistUi();if(uiReady)restorePosition(ui.positions[id]||{y:0,id:'',offset:0});}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>page(b.dataset.page)));
function save(fn,message=''){
  let newlyRegistered=false;
  const work=queue.catch(()=>{}).then(async()=>{
    if(!store||!data)throw new Error('保存データを読み込めません。保存・設定を確認してください。');
    try{const before=new Set(data.people.map(person=>person.handle)),r=await store.update(fn);data=r.data;revision=r.revision;newlyRegistered=data.people.some(person=>!before.has(person.handle));render();channel?.postMessage('changed');$('storageStatus').textContent='この端末に保存済み';if(message)notice(message);return r.result;}
    catch(e){$('storageStatus').textContent='保存できませんでした。入力を残しています。';throw e;}
  });queue=work;void work.then(()=>{if(newlyRegistered)void maybeAutoSync();}).catch(()=>{});return work;
}
async function refresh(position,intent){if(!store||document.visibilityState==='hidden')return false;try{await queue.catch(()=>{});const r=await store.load();const target=position&&intent?.sequence===restoreSequence&&intent.page===activePage&&document.visibilityState!=='hidden'?position:undefined;if(r.revision!==revision){data=r.data;revision=r.revision;render(target);}else if(target)restorePosition(target);return true;}catch(e){notice('保存領域の再読込に失敗しました：'+e.message,true);return false;}}
function addMissingPilotPeople(current){for(const handle of PILOT_HANDLES)if(!current.people.some(person=>person.handle===handle))current.people.push({id:crypto.randomUUID(),handle,genres:[],note:'',status:STATES[0],selected:true,checked:'',checkedAt:'',posts:[]});return current;}
function updateRefreshButton(){const button=$('refreshPeople');button.disabled=!store||!data?.people.length||scanPending;button.setAttribute('aria-busy',String(scanPending));button.textContent=scanPending?'↻ 確認中':'↻ 今すぐ確認';button.setAttribute('aria-label','登録した候補のRSSを今すぐ確認');}
function updateScanStatus(){if(!data)return;const node=$('candidateRefreshStatus'),newCount=data.people.filter(person=>feedState(data,person.handle).newPost).length;node.textContent=(newCount?'New '+newCount:'新着 −')+(scanPending?' · ↻ '+scanDone+'/'+scanTotal:'');node.setAttribute('aria-label',(newCount?`RSSで新しい本人投稿を確認した候補 ${newCount}人`:'RSSで確認できた新着はありません。取得失敗は未判定です。')+(scanPending?`。RSS照合中 ${scanDone}/${scanTotal}人`:''));node.title='登録候補の無料RSS';}
async function scanFeeds({force=false}={}){
  if(scanPending||!store||!data||document.visibilityState==='hidden')return false;
  scanPending=true;scanDone=0;scanTotal=dueHandles(data,Date.now(),force).length;updateRefreshButton();updateScanStatus();
  const attempted=new Set();let succeeded=0,failed=0,limited=false;
  try{
    while(document.visibilityState!=='hidden'&&navigator.onLine){
      await queue.catch(()=>{});
      const handles=dueHandles(data,Date.now(),force).filter(handle=>!attempted.has(handle));
      if(!handles.length)break;
      scanTotal=Math.max(scanTotal,scanDone+handles.length);
      const handle=handles[0],delay=RSS_REQUEST_SPACING_MS-(Date.now()-lastFeedRequestAt);
      if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
      if(document.visibilityState==='hidden')break;
      attempted.add(handle);lastFeedRequestAt=Date.now();
      let latestId='',error=null;
      try{latestId=await readFeed(handle);}catch(e){error=e;}
      const at=new Date().toISOString();
      const next=await store.update(current=>{recordFeedAttempt(current,handle,at);if(latestId)applyFeedResults(current,[{handle,latestId}],at);return current;});
      data=next.data;revision=next.revision;scanDone++;
      if(latestId)succeeded++;else failed++;
      if(scanDone%5===0||feedState(data,handle).newPost){const position=uiReady&&activePage==='people'?capturePosition():undefined;render(position);}
      updateScanStatus();channel?.postMessage('changed');
      if(error?.status===429){limited=true;break;}
    }
    if(limited)notice('RSSが混み合っています。残りは次回開いたときに確認します。',true);
    else if(force&&failed)notice(`RSS ${succeeded}/${scanDone} · −あり`,true);
    else if(force)notice(`RSS ${succeeded}/${scanDone}`);
    return true;
  }catch(error){notice('RSSの確認を続けられませんでした：'+(error.message||'再試行してください。'),true);return false;}
  finally{if(data){const position=uiReady&&activePage==='people'?capturePosition():undefined;render(position);}scanPending=false;scanDone=0;scanTotal=0;updateRefreshButton();updateScanStatus();}
}
function maybeAutoSync(){if(document.visibilityState==='hidden'||!navigator.onLine||!store||!data||scanPending||!dueHandles(data).length)return;void scanFeeds();}
function resume(){if(!uiReady||document.visibilityState==='hidden')return;const position=ui.positions[activePage]&&{...ui.positions[activePage]};restorePosition(position);void refresh(position,{sequence:restoreSequence,page:activePage}).then(maybeAutoSync);}
window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resume();else{clearTimeout(scrollSaveTimer);cancelPositionRestore();snapshotView();}});
window.addEventListener('online',maybeAutoSync);
function options(id,all=false,unclassified=false){const s=$(id),old=s.value;s.replaceChildren();if(all)s.add(new Option('すべて',''));if(unclassified)s.add(new Option('未分類','__none'));for(const g of data.genres)s.add(new Option(g.name,g.id));if([...s.options].some(o=>o.value===old))s.value=old;}
function genreNames(ids){return ids.map(id=>data.genres.find(g=>g.id===id)?.name).filter(Boolean).join('・')||'未分類';}
function time(at){return at?new Date(at).toLocaleString('ja-JP'):'日時不明';}
function results(rows){const root=$('pasteResults');root.replaceChildren();if(!rows)return;const list=el('ul','','result-list');rows.forEach(r=>list.append(el('li',(r.raw||r.url||r.id||r.handle||'')+'：'+(r.action||r.error||(r.valid?'処理済み':'登録不可')),r.valid===false?'result-invalid':'')));root.append(list);}
function pickedInbox(){return data.inbox.filter(x=>x.selected).map(x=>x.id);}
function visiblePeople(){const gid=$('filterGenre').value,status=$('filterStatus').value,freshness=$('patrolFreshness').value;return sortCandidates(data.people.filter(p=>(!gid||(gid==='__none'?!p.genres.length:p.genres.includes(gid)))&&(!status||p.status===status)&&(!freshness||(freshness==='new'?feedState(data,p.handle).newPost:patrolState(p).key===freshness))),$('sortPeople').value);}
function displayState(person){const rss=feedState(data,person.handle),checked=patrolState(person).checked;return rss.newPost?{label:'●',spoken:'RSSで新しい本人投稿を確認',css:'is-new'}:checked?{label:'✔',spoken:'人間確認済み',css:'is-checked'}:{label:'−',spoken:'新着未判定または確認記録なし',css:'is-unchecked'};}
function confirmationButtons(person){const confirmButton=btn('✔ 確認',()=>save(d=>markChecked(d,person.id),'✔ 確認済み'),'confirm-action');confirmButton.dataset.action='confirm';confirmButton.setAttribute('aria-label','@'+person.handle+'を人間確認済みにする');confirmButton.title='Xの投稿を人間が確認したことを記録';const undoButton=btn('↶',()=>save(d=>undoChecked(d,person.id),'確認を取り消しました'),'secondary undo-action');undoButton.dataset.action='undo-confirm';undoButton.setAttribute('aria-label','@'+person.handle+'の確認記録を取り消す');undoButton.title='確認を取り消す';undoButton.disabled=!patrolState(person).checked;return [confirmButton,undoButton];}
function renderInbox(){
  const root=$('inboxList');root.querySelectorAll('input[id^="handle-"]').forEach(input=>handleDrafts.set(input.id.slice(7),input.value));root.replaceChildren();$('inboxCount').textContent=data.inbox.length+'件';
  $('promote').disabled=!pickedInbox().length||!data.genres.length;$('deleteInbox').disabled=!pickedInbox().length;
  if(!data.inbox.length){root.append(el('p','まだリンクはありません。Xから共有するか、上の「リンクを貼り付けて収集する」を開いて追加してください。','empty'));return;}
  for(const p of [...data.inbox].reverse()){
    const item=el('article','','item');item.append(check(p.handle?'@'+p.handle:'投稿者名を確認してください',p.selected,value=>save(d=>setInboxSelected(d,[p.id],value))));
    item.append(link(p.url,'投稿 '+p.id+' ↗','url-text'),el('p',time(p.addedAt)+' · '+(p.source==='share'?'共有から':'手動取込'),'muted'));
    if(!p.handle){const input=el('input');input.type='text';input.maxLength=15;input.placeholder='example_user（@なし）';input.id='handle-'+p.id;input.value=handleDrafts.get(p.id)||'';input.autocapitalize='off';input.spellcheck=false;item.append(label('Xで投稿を確認し、投稿者のユーザー名を入力',input));}
    root.append(item);
  }
}
function renderPeople(positionOverride){
  reorder.cancel();
  const position=positionOverride||(uiReady&&activePage==='people'?capturePosition():null),root=$('personList'),focused=root.contains(document.activeElement)?document.activeElement:null;
  const focusId=focused?.closest('[data-person-id]')?.dataset.personId,focusName=focused?.getAttribute('aria-label'),selection=focused?.tagName==='TEXTAREA'?[focused.selectionStart,focused.selectionEnd]:null;
  renderingPeople=true;root.replaceChildren();const people=visiblePeople();$('peopleCount').textContent=people.length+' / '+data.people.length+'人';
  updateScanStatus();
  if(!people.length)root.append(el('p',data.people.length?'条件に合う候補がいません。絞り込みを変更してください。':'候補がありません。旧サイトから移行する場合は旧サイトで候補JSONを保存し、ここの「保存」画面から読み込んでください。新規利用なら収集BOXから登録してください。','empty'));
  for(const [numberIndex,p] of people.entries()){
    const item=el('article','','item person-item');item.dataset.personId=p.id;item.id='candidate-'+p.id;
    const accordion=el('details','','person-accordion');accordion.open=expandedPeople.has(p.id);
    const summary=el('summary','','person-summary'),state=displayState(p),names=p.genres.map(id=>data.genres.find(g=>g.id===id)?.name).filter(Boolean);
    const genre=el('span',shortGenres(names),'candidate-genre');genre.title=genreNames(p.genres);
    const chip=el('span',state.label,'patrol-chip '+state.css);chip.setAttribute('aria-hidden','true');chip.title=state.spoken;const arrow=el('span','⌄','accordion-arrow');arrow.setAttribute('aria-hidden','true');summary.setAttribute('aria-label','@'+p.handle+'、'+genreNames(p.genres)+'、'+state.spoken+'、詳細');summary.append(el('span',String(numberIndex+1).padStart(2,'0'),'card-index'),el('strong','@'+p.handle,'candidate-handle'),genre,chip,arrow);accordion.append(summary);
    accordion.addEventListener('toggle',()=>{if(renderingPeople||!accordion.isConnected)return;if(accordion.open)expandedPeople.add(p.id);else expandedPeople.delete(p.id);snapshotView();});
    const body=el('div','','person-body'),top=el('div','','row confirmation-tools');top.append(link('https://x.com/'+p.handle,'X ↗','person-link'),...confirmationButtons(p));top.firstElementChild.setAttribute('aria-label','@'+p.handle+'のXプロフィールを開く');
    const status=el('select');for(const s of STATES)status.add(new Option(s,s));status.value=p.status;status.setAttribute('aria-label','@'+p.handle+'の状態');status.addEventListener('change',()=>save(d=>{const current=d.people.find(x=>x.id===p.id);if(!current)throw new Error('候補がありません。');current.status=status.value;return d;},'状態を保存しました。').catch(e=>{status.value=p.status;notice(e.message,true);}));
    body.append(top,el('p',p.checkedAt?'確認 '+time(p.checkedAt):p.checked?'確認 '+p.checked:'確認記録なし','checked-time'),label('交流状態',status),check('巡回する',p.selected,v=>save(d=>setSelected(d,[p.id],v))),el('p','ジャンル：'+genreNames(p.genres),'muted'));
    body.append(el('h3','投稿リンク '+p.posts.length+'件','candidate-subheading'));
    for(const post of p.posts){const row=el('div','','row post-row');row.append(link(post.url,'投稿 '+post.id+' ↗','url-text'),btn('リンク削除',async()=>{if(confirm('この投稿リンクを削除しますか？'))await save(d=>removePost(d,p.id,post.id),'リンクを削除しました。');},'danger'));body.append(row);}
    if(!p.posts.length)body.append(el('p','登録投稿リンクはありません。','muted'));
    body.append(el('h3','メモ・ジャンルを編集','candidate-subheading'));const draft=personDrafts.get(p.id),note=el('textarea');note.rows=2;note.maxLength=160;note.value=draft?.note??p.note;note.setAttribute('aria-label','@'+p.handle+'のメモ');const picks=el('div','','genre-picks'),boxes=[];
    const rememberDraft=()=>personDrafts.set(p.id,{note:note.value,genres:boxes.filter(b=>b.checked).map(b=>b.value)});
    note.addEventListener('input',rememberDraft);body.append(label('メモ',note));
    for(const g of data.genres){const box=el('input');box.type='checkbox';box.value=g.id;box.checked=(draft?.genres??p.genres).includes(g.id);box.addEventListener('change',rememberDraft);boxes.push(box);picks.append(label(g.name,box));}
    body.append(picks,btn('編集内容を保存',async()=>{await save(d=>updatePerson(d,p.id,{note:note.value,genres:boxes.filter(b=>b.checked).map(b=>b.value)}),'候補を保存しました。');personDrafts.delete(p.id);renderPeople();}));
    const row=el('div','','row candidate-actions');row.append(btn('候補を削除',async()=>{if(confirm('@'+p.handle+' と投稿リンクを削除しますか？確認履歴は残ります。')){await save(d=>deletePerson(d,p.id),'候補を削除しました。');personDrafts.delete(p.id);expandedPeople.delete(p.id);persistUi();}},'danger'));body.append(row);const analytics=analyticsFor(p);body.prepend(analytics.detail);accordion.append(body);const handle=el('button','≡','reorder-handle');handle.type='button';handle.dataset.action='reorder';handle.setAttribute('aria-label','@'+p.handle+'を並べ替え');handle.setAttribute('aria-describedby','reorderInstructions');handle.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');handle.title='ドラッグで並べ替え';item.append(handle,accordion,analytics.controls);
    item.addEventListener('click',e=>{if(e.target.closest('button,a,summary,input,select,label,textarea,[contenteditable]'))return;accordion.open=!accordion.open;});
    root.append(item);
  }
  renderingPeople=false;updateReturnButton();if(focusId&&focusName){const input=[...(rowFor(focusId,'people')?.querySelectorAll('[aria-label]')||[])].find(n=>n.getAttribute('aria-label')===focusName);if(input){input.focus({preventScroll:true});if(selection)input.setSelectionRange(...selection);}}
  if(position&&activePage==='people')restorePosition(position);
}
function editGenre(g){$('genreId').value=g.id;$('gname').value=g.name;$('gtarget').value=g.target;$('gwords').value=g.words.join(', ');$('genreFormTitle').textContent='ジャンル編集';page('genres');$('gname').focus();}
function resetGenre(){$('genreForm').reset();$('genreId').value='';$('genreFormTitle').textContent='ジャンル追加';}
function renderGenres(){const root=$('genreList');root.replaceChildren();for(const g of counts(data)){const item=el('article','','item'),top=el('div','','item-head');top.append(el('strong',g.name),el('span',g.count+'人 / 目標 '+g.target+'人','count-pill'));const progress=el('progress','','progress');progress.max=g.target;progress.value=Math.min(g.count,g.target);progress.setAttribute('aria-label',g.name+'の目標達成');const row=el('div','','row');row.append(btn('編集',()=>editGenre(g)),btn('削除',async()=>{if(confirm(g.name+'を削除しますか？候補・投稿リンクは残ります。'))await save(d=>deleteGenre(d,g.id),'ジャンルを削除しました。');},'danger'));for(const word of g.words)row.append(link(searchUrl(word),word+' ↗'));item.append(top,progress,row);root.append(item);}if(!data.genres.length)root.append(el('p','ジャンルを追加すると、収集BOXから候補に登録できます。','empty'));}
function renderPatrol(){
  $('session').textContent=data.session?data.session.period+'の巡回':'朝・夜を選択';$('session').title=data.session?time(data.session.startedAt):'';const root=$('patrolList');root.replaceChildren();const people=data.people.filter(p=>p.selected);if(!people.length)root.append(el('p','候補の詳細から「巡回する」を選択','empty'));
  for(const p of people){const item=el('article','','item person-item patrol-item'),accordion=el('details','','person-accordion'),summary=el('summary','','person-summary'),state=displayState(p),names=p.genres.map(id=>data.genres.find(g=>g.id===id)?.name).filter(Boolean);item.dataset.personId=p.id;accordion.open=expandedPatrol.has(p.id);const genre=el('span',shortGenres(names),'candidate-genre');genre.title=genreNames(p.genres);const chip=el('span',state.label,'patrol-chip '+state.css);chip.setAttribute('aria-hidden','true');const arrow=el('span','⌄','accordion-arrow');arrow.setAttribute('aria-hidden','true');summary.setAttribute('aria-label','@'+p.handle+'、'+genreNames(p.genres)+'、'+state.spoken+'、詳細');summary.append(el('strong','@'+p.handle,'candidate-handle'),genre,chip,arrow);const body=el('div','','person-body'),actions=el('div','','row confirmation-tools'),profile=link('https://x.com/'+p.handle,'X ↗','person-link');profile.setAttribute('aria-label','@'+p.handle+'のXプロフィールを開く');actions.append(profile,...confirmationButtons(p));body.append(actions,el('p',p.checkedAt?'確認 '+time(p.checkedAt):p.checked?'確認 '+p.checked:'確認記録なし','checked-time'));if(p.posts.length)body.append(link(p.posts.at(-1).url,'投稿 ↗','person-link'));accordion.append(summary,body);accordion.addEventListener('toggle',()=>{if(!accordion.isConnected)return;if(accordion.open)expandedPatrol.add(p.id);else expandedPatrol.delete(p.id);snapshotView();});item.append(accordion);root.append(item);}
  $('historyCount').textContent='全'+data.history.length+'件（最新200件を表示・全件はバックアップへ）';$('historyList').replaceChildren(...[...data.history].reverse().slice(0,200).map(h=>el('div','@'+h.handle+' · '+(h.at?time(h.at):h.legacyText||'日時不明')+' · '+h.period,'history-row')));
}
function render(positionOverride){if(data?.people)primeCandidates(data.people);const position=positionOverride||(uiReady?capturePosition():null);document.querySelectorAll('[data-write]').forEach(b=>b.disabled=!data);updateRefreshButton();if(!data)return;const stats=$('stats');stats.replaceChildren();for(const [title,n] of [['収集BOX',data.inbox.length],['交流候補',data.people.length],['巡回対象',data.people.filter(p=>p.selected).length]]){const s=el('div','','stat');s.append(el('strong',String(n)),el('span',title));stats.append(s);}options('promoteGenre');options('filterGenre',true,true);renderInbox();renderPeople(position);renderGenres();renderPatrol();if(position)restorePosition(position);}
on('collectForm','submit',async e=>{e.preventDefault();const text=$('postUrls').value;const r=await save(d=>collectPosts(d,text,{source:'manual'}),'収集結果を確認してください。');results(r.results);const invalid=(r.results||[]).filter(x=>x.valid===false);if($('postUrls').value===text)$('postUrls').value=invalid.map(x=>x.raw).filter(Boolean).join('\n');});
on('selectInbox','click',()=>save(d=>setInboxSelected(d,d.inbox.map(x=>x.id),true)));on('clearInbox','click',()=>save(d=>setInboxSelected(d,d.inbox.map(x=>x.id),false)));
on('promote','click',async()=>{const ids=pickedInbox(),overrides={};for(const id of ids){const input=$('handle-'+id);if(input)overrides[id]=input.value.trim().replace(/^@/,'');}const gid=$('promoteGenre').value;const r=await save(d=>promoteInbox(d,ids,gid,overrides),'候補への登録結果を確認してください。');results(r.results);});
on('deleteInbox','click',async()=>{const ids=pickedInbox();if(ids.length&&confirm(ids.length+'件を収集BOXから削除しますか？'))await save(d=>removeInbox(d,ids),'収集BOXから削除しました。');});
function readCandidateControls(){ui.genre=$('filterGenre').value;ui.status=$('filterStatus').value;ui.freshness=$('patrolFreshness').value;ui.sort=$('sortPeople').value;persistUi();}
function activateUi(initialPage=ui.page){if(uiReady||!data)return;for(const [id,value] of [['filterGenre',ui.genre],['filterStatus',ui.status],['patrolFreshness',ui.freshness],['sortPeople',ui.sort]]){if([...$(id).options].some(option=>option.value===value))$(id).value=value;}$('candidateFilters').open=ui.filters;$('candidateHelp').open=ui.help;page(initialPage,{initial:true});uiReady=true;readCandidateControls();renderPeople();restorePosition(ui.positions[activePage]);}
for(const [id,key] of [['candidateFilters','filters'],['candidateHelp','help']])on(id,'toggle',()=>{if(!uiReady)return;ui[key]=$(id).open;snapshotView();});
for(const id of ['filterGenre','filterStatus','patrolFreshness','sortPeople'])on(id,'change',()=>{candidateControlsIntent++;userViewIntent++;readCandidateControls();renderPeople();snapshotView();});
$('filterStatus').add(new Option('すべて',''));for(const s of STATES)$('filterStatus').add(new Option(s,s));
on('refreshPeople','click',()=>scanFeeds({force:true}));
let sortPick=null,pickMode=false;on('sortModeToggle','click',()=>{pickMode=!pickMode;sortPick=null;reorder.setSelectionMode(pickMode);$('sortModeToggle').textContent=pickMode?'✓ 完了':'⇅ 並べ替え';$('sortModeToggle').setAttribute('aria-pressed',String(pickMode));$('reorderStatus').textContent=pickMode?'移動元 → 移動先をタップ':'並べ替え終了';});$('personList').addEventListener('click',e=>{if(!pickMode)return;const row=e.target.closest('[data-person-id]');if(!row)return;e.preventDefault();e.stopImmediatePropagation();const id=row.dataset.personId;if(!sortPick){sortPick=id;row.classList.add('is-picked');return;}if(sortPick===id){sortPick=null;row.classList.remove('is-picked');return;}const before=[...$('personList').children].filter(n=>n.dataset.personId).map(n=>n.dataset.personId);const after=before.filter(x=>x!==sortPick);after.splice(after.indexOf(id),0,sortPick);const source=sortPick;sortPick=null;void reorder.commitOrder(before,after,source);},true);
on('addPilotPeople','click',()=>save(addMissingPilotPeople,'試験対象を登録しました。'));
for(const [id,open] of [['expandPeople',true],['collapsePeople',false]])on(id,'click',()=>{const position=capturePosition();if(open)for(const p of visiblePeople())expandedPeople.add(p.id);else expandedPeople.clear();persistUi();renderPeople(position);});
on('returnToPerson','click',()=>{const id=ui.lastOpened.people,row=rowFor(id,'people');if(!row){notice('前に開いた候補は現在の絞り込みに含まれていません。条件を変更してください。');return;}const top=document.querySelector('.tabs').getBoundingClientRect().bottom+8;restorePosition({id,y:scrollY,offset:top});row.querySelector('summary').focus({preventScroll:true});});
on('selectPeople','click',()=>{const ids=visiblePeople().map(x=>x.id);return save(d=>setSelected(d,ids,true));});on('clearPeople','click',()=>{const ids=visiblePeople().map(x=>x.id);return save(d=>setSelected(d,ids,false));});
on('genreForm','submit',async e=>{e.preventDefault();const input={id:$('genreId').value,name:$('gname').value,target:Number($('gtarget').value),words:$('gwords').value};await save(d=>upsertGenre(d,input),'ジャンルを保存しました。');resetGenre();});on('cancelGenre','click',resetGenre);
on('morning','click',()=>save(d=>startSession(d,'朝'),'朝の巡回を開始しました。'));on('night','click',()=>save(d=>startSession(d,'夜'),'夜の巡回を開始しました。'));
function download(value,name){const u=URL.createObjectURL(new Blob([value],{type:'application/json;charset=utf-8'})),a=el('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}
on('export','click',async()=>{await queue.catch(()=>{});const r=await store.load();data=r.data;revision=r.revision;render();download(encodeBackup(data),'SNSWatchBox_Candidates_Backup.json');});

/* One-file moving kit; independent old-style backup buttons remain supported. */
let pendingAllRestore=null,allRestoreToken=0,allRestoreBusy=false;
function resetAllRestore(){
 allRestoreToken++;pendingAllRestore=null;
 $('restoreAllPreview').hidden=true;$('importAll').value='';
}
on('exportAll','click',async()=>{
 if(!store||!data)throw Error('候補データを読み込めません。');
 await queue.catch(()=>{});
 const r=await store.load();data=r.data;revision=r.revision;
 primeCandidates(data.people);
 const source=encodeBackup(data);
 const analytics=snapshotAnalytics();
 const text=encodeCombinedBackup(source,analytics);
 download(text,'SNSWatchBox_ALL_'+new Date().toISOString().slice(0,10)+'.json');
 $('restoreAllStatus').textContent='1ファイルを保存しました。候補 '+data.people.length+'人、♡分析 '+analytics.records.length+'件。端末のダウンロード一覧を確認してください。';
});
on('importAllButton','click',()=>{$('importAll').click()});
on('cancelRestoreAll','click',()=>{resetAllRestore();$('restoreAllStatus').textContent='まとめて復元をキャンセルしました。';});
on('importAll','change',async e=>{
 const token=++allRestoreToken;pendingAllRestore=null;$('restoreAllPreview').hidden=true;
 const file=e.target.files?.[0];if(!file)return;
 if(file.size>COMBINED_MAX_BYTES)throw Error('ファイルは20MB以内にしてください。');
 const text=await file.text();
 const restored=decodeCombinedBackup(text,decodeBackup,validateAnalyticsSnapshot);
 if(token!==allRestoreToken)return;
 pendingAllRestore=restored;
 $('restoreAllSummary').textContent='候補 '+restored.candidates.people.length+'人 / ♡分析 '+restored.analytics.records.length+'件 / BOX '+restored.candidates.inbox.length+'件 / 巡回履歴 '+restored.candidates.history.length+'件';
 $('restoreAllPreview').hidden=false;
 $('restoreAllStatus').textContent='両方の記録を検証しました。「この内容で復元」を押すまで現在のデータは変更しません。';
});
on('confirmRestoreAll','click',async()=>{
 if(!pendingAllRestore||allRestoreBusy)return;
 const staged=pendingAllRestore,token=allRestoreToken;
 allRestoreBusy=true;$('confirmRestoreAll').disabled=true;
 try{
  await queue.catch(()=>{});
  if(token!==allRestoreToken)return;
  if(!store||!data)throw Error('端末内の保存領域が使えません。');
  // Apply the small localStorage snapshot first; if IndexedDB fails, restore it.
  const oldAnalytics=snapshotAnalytics();
  applyAnalyticsSnapshot(staged.analytics);
  let saved;
  try{saved=await store.replace(staged.candidates)}
  catch(error){
   try{applyAnalyticsSnapshot(oldAnalytics)}
   catch(rollbackError){throw Error('復元に失敗し、♡記録を元へ戻すこともできませんでした。旧サイトとバックアップを残し、手動復旧してください。:'+rollbackError.message)}
   throw error;
  }
  data=saved.data;revision=saved.revision;handleDrafts.clear();personDrafts.clear();
  render();$('recovery').hidden=true;$('storageStatus').textContent='この端末に保存済み';
  channel?.postMessage('changed');resetAllRestore();
  $('restoreAllStatus').textContent='復元完了。候補 '+data.people.length+'人、♡分析 '+staged.analytics.records.length+'件。旧サイトと照合してください。';
  notice('1ファイルからまとめて復元しました。旧サイトは照合が済むまで残してください。');
 }finally{allRestoreBusy=false;$('confirmRestoreAll').disabled=false;}
});

function cancelRestore(){restoreToken++;pendingRestore=null;$('restorePreview').hidden=true;$('import').value='';}
on('cancelRestore','click',cancelRestore);on('import','change',async e=>{const token=++restoreToken;pendingRestore=null;$('restorePreview').hidden=true;const f=e.target.files[0];if(!f)return;if(f.size>LIMITS.bytes)throw new Error('JSONは10MB以内にしてください。');const clean=decodeBackup(await f.text());if(token!==restoreToken)return;pendingRestore=clean;$('restoreSummary').textContent='ジャンル '+clean.genres.length+'個 / 候補 '+clean.people.length+'人 / 収集BOX '+clean.inbox.length+'件 / 履歴 '+clean.history.length+'件';$('restorePreview').hidden=false;});
on('confirmRestore','click',async()=>{const target=pendingRestore,token=restoreToken;if(!target)return;await queue.catch(()=>{});if(token!==restoreToken)return;const r=await store.replace(target);data=r.data;revision=r.revision;handleDrafts.clear();personDrafts.clear();render();$('recovery').hidden=true;$('storageStatus').textContent='この端末に保存済み';activateUi('backup');cancelRestore();channel?.postMessage('changed');notice('バックアップをRSS試験領域へ復元しました。');maybeAutoSync();});
on('exportRaw','click',async()=>download(JSON.stringify(await store.raw(),null,2),'SNSWatchPWA051RSSRecovery.json'));on('newData','click',async()=>{if(!confirm('RSS試験の保存領域を初期化しますか？必要なら先にJSONを保存してください。旧版の保存領域は残ります。'))return;await queue.catch(()=>{});const r=await store.replace(defaults());data=r.data;revision=r.revision;handleDrafts.clear();personDrafts.clear();$('recovery').hidden=true;$('storageStatus').textContent='この端末に保存済み';render();activateUi('backup');channel?.postMessage('changed');notice('新しいRSS試験データを保存しました。');});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});on('install','click',async()=>{if(!installPrompt)return;await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('install').hidden=true;});on('persistent','click',async()=>{const granted=await navigator.storage?.persist?.();notice(granted?'この端末での保存保護が許可されました。バックアップも保存してください。':'保存保護は許可されませんでした。定期的にバックアップしてください。');});
async function setupPwa(){
  if(!('serviceWorker'in navigator)){$('pwaStatus').textContent='このブラウザではオフライン機能を利用できません。';return;}
  try{
    const reg=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    const status=()=>{$('pwaStatus').textContent=reg.waiting&&reg.active?'更新があります。SNS WATCH BOXの画面をすべて閉じ、開き直してください。':reg.active?.state==='activated'?'オフライン起動の準備済み。Android実機の共有・復帰動作は未検証です。':'オフライン起動を準備しています。';};
    const watch=worker=>{if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='redundant')$('pwaStatus').textContent='オフライン準備に失敗しました。オンラインで開き直してください。';else status();});};
    watch(reg.installing);reg.addEventListener('updatefound',()=>{watch(reg.installing);status();});navigator.serviceWorker.addEventListener('controllerchange',status);status();
  }catch(e){$('pwaStatus').textContent='オフライン準備に失敗しました。オンラインで再度開いてください。';}
}
const shareParams=new URL(location.href).searchParams,shared={title:shareParams.get('title')||'',text:shareParams.get('text')||'',url:shareParams.get('url')||''};const hasShare=['title','text','url'].some(k=>shareParams.has(k));
if(hasShare){history.replaceState(null,'',location.pathname);$('postUrls').value=[shared.title,shared.text,shared.url].filter(Boolean).join('\n');$('manualImport').open=true;}
render();
try{let legacyStorage;try{legacyStorage=localStorage;}catch{}store=createStore({indexedDB:globalThis.indexedDB,localStorage:legacyStorage});const loaded=await store.load();data=loaded.data;revision=loaded.revision;$('storageStatus').textContent='RSS試験領域・この端末に保存済み';render();if(['v051-ui-idb','v051-ui-local','v02','v03','v04','v05-idb','v05-local'].includes(loaded.source))notice('旧版のデータを独立したRSS試験領域へコピーしました。元の保存領域は残ります。');}
catch(e){data=null;render();$('storageStatus').textContent='保存領域を読み込み・保存できませんでした。';$('recovery').hidden=false;notice(e.message,true);if(!hasShare)page('backup');}
activateUi(hasShare?'inbox':ui.page);
if(hasShare&&data){try{const r=await save(d=>collectPosts(d,shared,{source:'share'}),'共有を受信しました。収集結果を確認してください。');results(r.results);if(!(r.results||[]).some(x=>x.valid===false)){$('postUrls').value='';$('manualImport').open=false;}}catch(e){notice('共有を保存できませんでした。手動取込欄の内容を確認して再送してください：'+e.message,true);}}
setupAnalytics();
setupPwa();
maybeAutoSync();
setInterval(maybeAutoSync,30*60*1000);
