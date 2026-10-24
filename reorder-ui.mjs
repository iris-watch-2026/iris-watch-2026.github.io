// Candidate grid: long-press card surface for 450ms, then drag to reorder.
// Normal swipes scroll; interactive controls never initiate drag.
export function setupReorder({root,onCommit,onDragChange=()=>{},onError=()=>{}}){
  const HOLD_MS=450, MOVE_CANCEL_PX=10;
  let gesture=null,holdTimer=0,pending=false,suppressUntil=0,mode=false,selectionOnly=false;
  const rows=()=>[...root.children].filter(x=>x.dataset.personId);
  const ids=()=>rows().map(x=>x.dataset.personId);
  const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const blocked=target=>Boolean(target.closest('button,a,input,select,textarea,label,[contenteditable],.person-body'));
  const tile=target=>target.closest('[data-person-id]');
  const clearTimer=()=>{if(holdTimer){clearTimeout(holdTimer);holdTimer=0}};
  const rollback=g=>{if(g?.nodes?.every(n=>n.parentElement===root))root.append(...g.nodes)};
  function end(restore=false){
    clearTimer();
    const g=gesture;gesture=null;
    if(!g)return null;
    if(restore)rollback(g);
    g.row.classList.remove('is-drag-source');
    root.classList.remove('is-reordering');
    document.body.classList.remove('watch-dragging');
    if(g.ghost)g.ghost.remove();
    if(g.started){suppressUntil=performance.now()+1000;onDragChange(false);}
    return g;
  }
  function cancel(){end(true)}
  async function commit(before,after,id){
    if(same(before,after))return;
    pending=true;root.setAttribute('aria-busy','true');
    try{await onCommit(before,after,id)}
    catch(error){onError(error)}
    finally{pending=false;root.removeAttribute('aria-busy')}
  }
  function pointTarget(x,y){
    const other=rows().filter(row=>row!==gesture.row);
    let target=null,best=Infinity;
    for(const row of other){
      const r=row.getBoundingClientRect();
      const dx=Math.max(0,r.left-x,x-r.right);
      const dy=Math.max(0,r.top-y,y-r.bottom);
      const distance=dx*dx+dy*dy;
      if(distance<best){best=distance;target=row;}
    }
    return target;
  }
  function move(x,y){
    if(!gesture?.started)return;
    const g=gesture;
    g.ghost.style.transform='translate3d('+(x-g.startX)+'px,'+(y-g.startY)+'px,0)';
    const target=pointTarget(x,y);
    if(!target||target===g.row)return;
    const targetIndex=ids().indexOf(target.dataset.personId);
    const sourceIndex=ids().indexOf(g.row.dataset.personId);
    if(sourceIndex<targetIndex)root.insertBefore(g.row,target.nextSibling);
    else root.insertBefore(g.row,target);
    if(y<85)window.scrollBy(0,-9);
    else if(y>innerHeight-70)window.scrollBy(0,9);
  }
  function begin(){
    const g=gesture;
    if(!g||g.started||pending)return;
    g.started=true;g.row.classList.add('is-drag-source');root.classList.add('is-reordering');document.body.classList.add('watch-dragging');onDragChange(true);
    const ghost=g.row.cloneNode(true),rect=g.row.getBoundingClientRect();
    ghost.classList.add('reorder-ghost');ghost.setAttribute('aria-hidden','true');ghost.removeAttribute('id');
    ghost.style.cssText='position:fixed;pointer-events:none;z-index:9999;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;opacity:.92;overflow:hidden;transform:translate3d(0,0,0)';
    ghost.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
    g.ghost=ghost;document.body.append(ghost);
    if(navigator.vibrate)try{navigator.vibrate(16)}catch{}
  }
  function beginCandidate(row,x,y,type){
    cancel();
    if(pending||rows().length<2)return;
    gesture={row,startX:x,startY:y,x,y,nodes:[...root.children],originalIds:ids(),started:false,type};
    holdTimer=setTimeout(()=>{holdTimer=0;begin()},HOLD_MS);
  }
  // Touch: no preventDefault before the hold, so ordinary vertical scrolling works.
  root.addEventListener('touchstart',e=>{
    if(mode||selectionOnly||e.touches.length!==1||blocked(e.target))return;
    const row=tile(e.target);if(!row||!root.contains(row))return;
    const t=e.touches[0];beginCandidate(row,t.clientX,t.clientY,'touch');
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    const g=gesture;if(!g||g.type!=='touch')return;
    const t=e.touches[0];
    if(!t){cancel();return}
    if(!g.started){
      if(Math.hypot(t.clientX-g.startX,t.clientY-g.startY)>MOVE_CANCEL_PX)cancel();
      return;
    }
    e.preventDefault();
    move(t.clientX,t.clientY);
  },{passive:false});
  document.addEventListener('touchend',e=>{
    const g=gesture;if(!g||g.type!=='touch')return;
    const t=e.changedTouches[0];
    if(g.started){e.preventDefault();if(t)move(t.clientX,t.clientY)}
    const ordered=ids(),done=end(false);
    if(done?.started)void commit(done.originalIds,ordered,done.row.dataset.personId);
  },{passive:false});
  document.addEventListener('touchcancel',()=>{if(gesture?.type==='touch')cancel()});
  // Mouse/pen: hold to reorder instead of dragging on the first movement.
  root.addEventListener('pointerdown',e=>{
    if(selectionOnly||(e.pointerType==='touch'&&!mode)||e.button!==0||(!mode&&blocked(e.target)))return;
    const row=tile(e.target);if(row&&root.contains(row)){beginCandidate(row,e.clientX,e.clientY,'pointer');if(mode){clearTimer();begin();try{root.setPointerCapture(e.pointerId)}catch{}}}
  });
  document.addEventListener('pointermove',e=>{
    const g=gesture;if(!g||g.type!=='pointer')return;
    if(!g.started&&Math.hypot(e.clientX-g.startX,e.clientY-g.startY)>MOVE_CANCEL_PX){cancel();return}
    if(g.started)move(e.clientX,e.clientY);
  });
  document.addEventListener('pointerup',e=>{
    const g=gesture;if(!g||g.type!=='pointer')return;
    if(g.started)move(e.clientX,e.clientY);
    const ordered=ids(),done=end(false);
    if(done?.started)void commit(done.originalIds,ordered,done.row.dataset.personId);
  });
  root.addEventListener('contextmenu',e=>{if(gesture){e.preventDefault()}});
  root.addEventListener('click',e=>{
    if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation()}
  },true);
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape'){cancel();return}
    const row=tile(e.target);
    if(!row||!root.contains(row)||!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();
    const before=ids(),idx=before.indexOf(row.dataset.personId),next=idx+(e.key==='ArrowUp'?-1:1);
    if(next<0||next>=before.length)return;
    const after=[...before];[after[idx],after[next]]=[after[next],after[idx]];
    void commit(before,after,row.dataset.personId);
  });
  window.addEventListener('pagehide',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')cancel()});
  function setMode(enabled){cancel();mode=Boolean(enabled);root.classList.toggle('reorder-mode',mode);root.setAttribute('aria-label',mode?'並べ替えモードです。カードを指で移動してください。':'候補一覧');return mode;}
  function setSelectionMode(enabled){cancel();selectionOnly=Boolean(enabled);mode=false;root.classList.remove('reorder-mode');root.classList.toggle('pick-reorder-mode',selectionOnly);return selectionOnly;}
  return {cancel,setMode,setSelectionMode,commitOrder:commit,get mode(){return mode},get active(){return Boolean(gesture?.started)}};
}