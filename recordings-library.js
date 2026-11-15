'use strict';
const libraryState={revision:0,pendingDelete:null,editing:null,previewId:null,previewURL:null,previewGeneration:0,busy:new Set(),channel:null,feedbackTimer:null};
const LIBRARY_ICONS={play:'<path d="m9 5 11 7-11 7z"/>',rename:'<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',remove:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'};
function libraryButton(label,icon,className='') {
  const b=document.createElement('button');b.type='button';b.className=className;
  if(icon)b.insertAdjacentHTML('beforeend','<svg viewBox="0 0 24 24" aria-hidden="true">'+LIBRARY_ICONS[icon]+'</svg>');
  const text=document.createElement('span');text.textContent=label;b.append(text);return b;
}
function recordingTitle(meta) {return meta.title||(/^Our-Wedding-/i.test(meta.filename||'')?'Wedding call':(meta.filename||'Wedding recording').replace(/\.(mp4|webm)$/i,'').replace(/-seekable$/i,'').replace(/[_-]+/g,' '));}
function recordingSize(bytes) {return !bytes?'0 B':bytes>=1073741824?(bytes/1073741824).toFixed(1)+' GB':bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';}
function recentRecording(meta) {return meta.state==='recording'&&Date.now()-(meta.lastActiveAt||meta.startedAt||0)<35000;}
function protectedRecording(meta) {return meta.id===weddingRecording?.meta.id||recordingPreparing||!!recordingTimelineJob||libraryState.busy.has(meta.id)||recentRecording(meta);}
function libraryFeedback(text,error=false) {clearTimeout(libraryState.feedbackTimer);$('library-feedback').textContent=text;$('library-feedback').classList.toggle('error',error);if(text&&!error)libraryState.feedbackTimer=setTimeout(()=>{$('library-feedback').textContent='';},5000);}
async function libraryMeta(id) {const saved=(await RecordingArchive.sessions()).find(m=>m.id===id),memory=recordingMemory.get(id);return memory?.tail?.length?{...saved,...memory.meta}:saved;}
async function holdRecordingLease(session) {
  if(!navigator.locks?.request)return;
  await new Promise((ready,reject)=>{
    session.libraryLeasePromise=navigator.locks.request('wedding-memory:'+session.meta.id,{ifAvailable:true},lock=>{
      if(!lock){reject(new Error('This recording is already in use.'));return;}
      return new Promise(release=>{session.releaseLibraryLease=release;ready();});
    }).catch(()=>ready());
  });
}
async function withRecordingLock(id,task) {
  if(!navigator.locks?.request)return task();
  return navigator.locks.request('wedding-memory:'+id,{ifAvailable:true},lock=>{if(!lock)throw new Error('This recording is in use in another tab. Try again when saving has finished.');return task();});
}
function broadcastRecordingChange(id) {libraryState.channel?.postMessage({id});}
async function deleteRecordingArchive(meta) {
  const db=await RecordingArchive.open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['sessions','chunks'],'readwrite'),sessions=tx.objectStore('sessions'),chunks=tx.objectStore('chunks');let problem;
    const request=sessions.get(meta.id);request.onsuccess=()=>{try{
      const current=request.result||meta;
      if(recentRecording(current)){problem=new Error('This recording is still active. Wait until saving finishes.');tx.abort();return;}
      for(const key of new Set([meta.id,current.timelineKey,meta.timelineKey].filter(Boolean))){const r=chunks.index('session').openCursor(IDBKeyRange.only(key));r.onsuccess=()=>{const cursor=r.result;if(cursor){cursor.delete();cursor.continue();}};}
      sessions.delete(meta.id);
    }catch(error){problem=error;tx.abort();}};
    tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(problem||tx.error||new Error('Could not remove this recording.'));
  });
}
function closeRecordingPreview() {
  ++libraryState.previewGeneration;const video=$('recording-preview-video');video.pause();video.removeAttribute('src');video.load();
  if(libraryState.previewURL)URL.revokeObjectURL(libraryState.previewURL);libraryState.previewURL=null;libraryState.previewId=null;$('recording-player').hidden=true;
}
async function previewRecording(id,knownMeta) {
  const meta=knownMeta||await libraryMeta(id);if(!meta||meta.id===weddingRecording?.meta.id)return;
  if(!$('recordings-dialog').open)showRecordingLibrary();libraryFeedback('');closeRecordingPreview();const generation=libraryState.previewGeneration;libraryState.previewId=id;
  try{
    const {blob}=await recordingBlob(id);if(generation!==libraryState.previewGeneration||libraryState.previewId!==id)return;
    libraryState.previewURL=URL.createObjectURL(blob);$('recording-preview-title').textContent=recordingTitle(meta);$('recording-player').hidden=false;
    const video=$('recording-preview-video');video.src=libraryState.previewURL;video.muted=active;$('preview-muted-note').hidden=!active;
    $('recording-player').scrollIntoView({block:'nearest',behavior:'instant'});video.focus();void video.play().catch(error=>{if(generation===libraryState.previewGeneration&&error.name==='NotAllowedError')libraryFeedback('Tap Play in the preview to start.');});
  }catch(error){closeRecordingPreview();libraryFeedback(error.message,true);}
}
function closeRecordingEditor() {libraryState.editing=null;$('recording-editor').hidden=true;}
function closeDeleteConfirmation() {libraryState.pendingDelete=null;$('recording-delete-confirm').hidden=true;}
async function editRecordingName(id,knownMeta) {
  const meta=knownMeta||await libraryMeta(id);if(!meta||protectedRecording(meta)){libraryFeedback('Wait until this recording is saved.',true);return;}
  if(!$('recordings-dialog').open)showRecordingLibrary();libraryFeedback('');closeDeleteConfirmation();libraryState.editing=id;$('recording-name').value=recordingTitle(meta);$('recording-editor').hidden=false;
  $('recording-editor').scrollIntoView({block:'nearest',behavior:'instant'});$('recording-name').focus();$('recording-name').select();
}
async function renameSavedRecording(id,title) {
  title=String(title).trim().slice(0,80);if(!title)throw new Error('Enter a name for this recording.');
  const meta=await libraryMeta(id);if(!meta)throw new Error('This recording has already been removed.');if(protectedRecording(meta))throw new Error('Wait until this recording is saved.');
  libraryState.busy.add(id);
  try{await withRecordingLock(id,async()=>{
    const latest=await libraryMeta(id);if(!latest)throw new Error('This recording has already been removed.');if(recentRecording(latest))throw new Error('This recording is still active.');
    let stem=title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').replace(/[.\s]+$/g,'').trim()||'Wedding recording';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem))stem='Wedding '+stem;
    const next={...latest,title,filename:stem+(latest.mime?.includes('mp4')?'.mp4':'.webm')};await RecordingArchive.putSession(next);
    const memory=recordingMemory.get(id);if(memory)memory.meta=next;
    if(libraryState.previewId===id)$('recording-preview-title').textContent=title;broadcastRecordingChange(id);
  });}finally{libraryState.busy.delete(id);syncLibraryControls();}
  closeRecordingEditor();libraryFeedback('Recording renamed.');await refreshRecordingLibrary();$('recording-search').focus();
}
async function requestRecordingDeletion(id,knownMeta) {
  const meta=knownMeta||await libraryMeta(id);if(!meta)return;if(protectedRecording(meta)){libraryFeedback('Wait until this recording is saved.',true);return;}
  if(!$('recordings-dialog').open)showRecordingLibrary();libraryFeedback('');closeRecordingEditor();libraryState.pendingDelete=id;
  $('delete-recording-title').textContent='Delete “'+recordingTitle(meta)+'”?';$('recording-delete-confirm').hidden=false;$('recording-delete-confirm').scrollIntoView({block:'nearest',behavior:'instant'});$('cancel-recording-delete').focus();
}
async function deleteSavedRecording(id) {
  const meta=await libraryMeta(id);if(!meta)return;if(protectedRecording(meta))throw new Error('Wait until this recording is saved.');libraryState.busy.add(id);
  try{await withRecordingLock(id,()=>deleteRecordingArchive(meta));
    recordingMemory.delete(id);if(libraryState.previewId===id)closeRecordingPreview();if(libraryState.editing===id)closeRecordingEditor();closeDeleteConfirmation();broadcastRecordingChange(id);
    libraryFeedback('Recording deleted from this browser.');await refreshRecordingLibrary();$('recording-search').focus();
  }finally{libraryState.busy.delete(id);syncLibraryControls();}
}
function syncLibraryControls() {
  for(const b of document.querySelectorAll('.recording-rename,.recording-delete'))b.disabled=b.dataset.recordingId===weddingRecording?.meta.id||recordingPreparing||!!recordingTimelineJob||libraryState.busy.has(b.dataset.recordingId)||b.dataset.recent==='true';
}
async function renderRecordingLibrary() {
  const revision=++libraryState.revision;let saved=[];try{saved=await RecordingArchive.sessions();}catch{}
  if(revision!==libraryState.revision)return;
  const all=new Map(saved.map(m=>[m.id,m]));for(const [id,entry] of recordingMemory)all.set(id,entry.meta);
  const rows=[...all.values()].filter(m=>m.bytes>0||m.state==='interrupted'||m.id===weddingRecording?.meta.id).sort((a,b)=>b.startedAt-a.startedAt);
  const query=$('recording-search').value.trim().toLocaleLowerCase(),filtered=rows.filter(m=>[recordingTitle(m),m.filename,new Date(m.startedAt).toLocaleString(),m.mime].join(' ').toLocaleLowerCase().includes(query));
  $('recordings-section').hidden=!rows.length;$('recording-summary').textContent=rows.length?rows.length+' recording'+(rows.length===1?'':'s')+' · '+recordingSize(rows.reduce((n,m)=>n+(m.bytes||0),0)):'Your wedding memories, in one place.';
  for(const target of [$('recordings-list'),$('recordings-modal-list')]){
    target.replaceChildren();const shown=target.id==='recordings-modal-list'?filtered:rows.slice(0,3);
    for(const meta of shown){
      const inProgress=meta.id===weddingRecording?.meta.id&&!weddingRecording.finalizedData,inUse=inProgress||recentRecording(meta),incomplete=meta.state!=='complete',fileOnly=meta.backupIncomplete&&meta.savedToFile&&!recordingMemory.get(meta.id)?.tail.length;
      const card=document.createElement('article');card.className='recording-row';card.dataset.recordingId=meta.id;
      const head=document.createElement('div');head.className='recording-card-head';const title=document.createElement('strong');title.textContent=recordingTitle(meta);
      const badge=document.createElement('span');badge.className='recording-badge';badge.textContent=inProgress?(weddingRecording.stopping?'Saving':'Recording'):inUse?'In use':incomplete?'Interrupted':meta.timelineState==='ready'?'Ready':'Timeline needed';head.append(title,badge);
      const info=document.createElement('p');info.className='recording-meta';info.textContent=(meta.mime?.includes('mp4')?'MP4':'WebM')+' · '+recordingDuration(meta.durationMs||0)+' · '+(meta.bytes?recordingSize(meta.bytes):'No footage');
      const date=document.createElement('p');date.className='recording-date';date.textContent=new Date(meta.startedAt).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
      if(meta.savedToFile)date.textContent+=' · '+(meta.fileTimelineReady===false&&meta.timelineState==='ready'?'Browser copy':'File + browser');card.append(head,info,date);
      if(meta.note){const note=document.createElement('details');note.className='recording-note';const summary=document.createElement('summary');summary.textContent='Save details';const text=document.createElement('p');text.textContent=meta.note;note.append(summary,text);card.append(note);}
      const actions=document.createElement('div');actions.className='recording-actions';
      const download=libraryButton(inProgress?'Saving…':fileOnly?'Use saved file':incomplete?'Recover':'Download','download','recording-download');download.disabled=!meta.bytes||inProgress||fileOnly;
      download.addEventListener('click',()=>{download.disabled=true;void downloadRecording(meta.id).finally(()=>{download.disabled=!meta.bytes||inProgress||fileOnly;});});
      const play=libraryButton('Preview','play','recording-play');play.disabled=!meta.bytes||inProgress||fileOnly;play.addEventListener('click',()=>{void previewRecording(meta.id,meta);});
      const rename=libraryButton('Rename','rename','recording-rename icon-action'),remove=libraryButton('Delete','remove','recording-delete icon-action');
      for(const [b,label] of [[rename,'Rename'],[remove,'Delete']]){b.title=label;b.setAttribute('aria-label',label+' '+recordingTitle(meta));b.dataset.recordingId=meta.id;b.dataset.recent=String(recentRecording(meta));b.disabled=protectedRecording(meta);}
      rename.addEventListener('click',()=>{void editRecordingName(meta.id,meta);});remove.addEventListener('click',()=>{void requestRecordingDeletion(meta.id,meta);});actions.append(download,play,rename,remove);card.append(actions);
      if(meta.timelineState!=='ready'&&!inProgress&&meta.bytes&&!fileOnly){const fix=libraryButton('Fix timeline',null,'fix-timeline');fix.disabled=!!weddingRecording||!!recordingTimelineJob;fix.addEventListener('click',()=>{void fixSavedRecordingTimeline(meta.id);});card.append(fix);}
      target.append(card);
    }
    if(!shown.length){const empty=document.createElement('div');empty.className='recording-empty';const title=document.createElement('strong');title.textContent=rows.length?'No matching recordings':'No recordings yet';const text=document.createElement('p');text.textContent=rows.length?'Try another name or date.':'Record a call to keep it here.';empty.append(title,text);target.append(empty);}
  }
}
$('recording-search').addEventListener('input',()=>{void refreshRecordingLibrary();});
$('refresh-recordings').addEventListener('click',()=>{void refreshRecordingLibrary();libraryFeedback('Recordings refreshed.');});
$('header-recordings').addEventListener('click',showRecordingLibrary);
$('recording-editor').addEventListener('submit',event=>{event.preventDefault();const id=libraryState.editing;if(id)void renameSavedRecording(id,$('recording-name').value).catch(error=>libraryFeedback(error.message,true));});
$('cancel-recording-rename').addEventListener('click',()=>{closeRecordingEditor();$('recording-search').focus();});
$('cancel-recording-delete').addEventListener('click',()=>{closeDeleteConfirmation();$('recording-search').focus();});
$('confirm-recording-delete').addEventListener('click',()=>{const id=libraryState.pendingDelete;if(!id)return;const button=$('confirm-recording-delete');button.disabled=true;void deleteSavedRecording(id).catch(error=>libraryFeedback(error.message,true)).finally(()=>{button.disabled=false;});});
$('close-recording-preview').addEventListener('click',closeRecordingPreview);
$('recording-preview-video').addEventListener('error',()=>{if(libraryState.previewId&&$('recording-preview-video').error)libraryFeedback('This recording could not play here. Download it or try Fix timeline.',true);});
$('recordings-dialog').addEventListener('close',()=>{closeRecordingPreview();closeRecordingEditor();closeDeleteConfirmation();libraryFeedback('');});
$('recordings-dialog').addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  if(libraryState.pendingDelete||libraryState.editing||libraryState.previewId){event.preventDefault();event.stopImmediatePropagation();if(libraryState.pendingDelete)closeDeleteConfirmation();else if(libraryState.editing)closeRecordingEditor();else closeRecordingPreview();$('recording-search').focus();}
},true);
try{libraryState.channel=new BroadcastChannel('wedding-recording-library');libraryState.channel.onmessage=async event=>{
  const id=event.data?.id;if(typeof id!=='string')return;const meta=(await RecordingArchive.sessions()).find(m=>m.id===id),memory=recordingMemory.get(id);
  if(meta){if(memory)memory.meta=meta;}else{recordingMemory.delete(id);if(libraryState.previewId===id)closeRecordingPreview();if(libraryState.editing===id)closeRecordingEditor();if(libraryState.pendingDelete===id)closeDeleteConfirmation();}
  void refreshRecordingLibrary();
};}catch{}
void refreshRecordingLibrary();
