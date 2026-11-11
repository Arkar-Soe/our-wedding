'use strict';
// Local gallery recording. Nothing is uploaded to a recording service.
const RecordingArchive = {
  connection: null,
  async open() {
    if (this.connection) return this.connection;
    this.connection = await new Promise((resolve,reject)=>{
      const request=indexedDB.open('our-wedding-memories',1);
      request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('sessions',{keyPath:'id'});const chunks=db.createObjectStore('chunks',{keyPath:['session','index']});chunks.createIndex('session','session');};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    return this.connection;
  },
  async transaction(store,mode,run) {
    const db=await this.open();
    return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let result;try{result=run(tx.objectStore(store));}catch(e){reject(e);return;}tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));});
  },
  putSession(meta) {return this.transaction('sessions','readwrite',s=>s.put(meta));},
  putChunk(id,index,blob) {return this.transaction('chunks','readwrite',s=>s.put({session:id,index,blob}));},
  sessions() {return this.transaction('sessions','readonly',s=>s.getAll());},
  chunks(id) {return this.transaction('chunks','readonly',s=>s.index('session').getAll(id));}
};
let weddingRecording=null, recordingPreparing=false, remoteRecording=false;
const recordingMemory=new Map();
let recordingURLs=[];
function recordingDuration(ms) {const s=Math.floor(ms/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');}
function recordingCapability() {return !!(window.MediaRecorder&&HTMLCanvasElement.prototype.captureStream&&(window.AudioContext||window.webkitAudioContext)&&window.indexedDB);}
function recordingControls() {
  const button=$('record-toggle');
  button.hidden=!active||!isHost;
  button.disabled=recordingPreparing||!!weddingRecording?.stopping||!recordingCapability();
  buttonLabel('record-toggle',recordingPreparing?'Preparing…':weddingRecording?.stopping?'Saving…':weddingRecording?'Stop recording':'Record all');
  button.setAttribute('aria-pressed',String(!!weddingRecording&&!weddingRecording.stopping));
  button.title=recordingCapability()?'Record everyone and save on this device':'Recording is unavailable in this browser. Use desktop Chrome or Edge.';
  const show=!!weddingRecording||remoteRecording,wasVisible=!$('recording-indicator').hidden;
  $('recording-indicator').hidden=!show;
  if(show!==wasVisible)requestAnimationFrame(arrangeVideos);
  if(weddingRecording)$('recording-indicator').textContent=weddingRecording.stopping?'Saving recording…':'REC '+recordingDuration(performance.now()-weddingRecording.startedClock);
  else if(remoteRecording)$('recording-indicator').textContent='REC · Host is recording';
  if(show)$('recording-indicator').title='The host is recording the gallery and all connected audio on their device.';
}
function recordingNoticeForGuests(data) {
  const next=!!data?.active;
  if(next!==remoteRecording){remoteRecording=next;if(next)notify('The host is recording this call',{detail:'Video and audio are being saved on the host’s device.',kind:'info',duration:6500});}
  recordingControls();
}
function recordingState() {return {active:!!weddingRecording&&!weddingRecording.stopping,by:ownName};}
function recordingSources() {
  const list=[{id:selfId,name:ownName,video:$('local-video'),stream}];
  for(const member of roster){if(member.id===selfId)continue;const video=tiles.get(member.id)?.querySelector('video');list.push({id:member.id,name:member.name,video,stream:video?.srcObject});}
  return list;
}
function syncRecordingAudio(session) {
  const inputs=recordingSources(),ids=new Set();
  for(const input of inputs){
    const tracks=input.stream?.getAudioTracks().filter(t=>t.readyState==='live')||[];
    if(!tracks.length)continue;
    const key=input.id+':'+tracks.map(t=>t.id).join(',');ids.add(key);
    if(session.audioSources.has(key))continue;
    const source=session.audio.createMediaStreamSource(new MediaStream(tracks));
    source.connect(session.compressor);session.audioSources.set(key,source);
  }
  for(const [key,source] of session.audioSources)if(!ids.has(key)){source.disconnect();session.audioSources.delete(key);}
}
function recordingText(ctx,text,x,y,maxWidth) {
  let value=String(text);while(ctx.measureText(value).width>maxWidth&&value.length>1)value=value.slice(0,-2)+'…';ctx.fillText(value,x,y);
}
function drawWeddingRecording(session) {
  const ctx=session.context,canvas=session.canvas,w=canvas.width,h=canvas.height;
  const inputs=recordingSources().slice(0,MAX_PARTICIPANTS),n=Math.max(1,inputs.length),columns=n===1?1:n<=4?2:3,rows=Math.ceil(n/columns);
  ctx.fillStyle='#e9ecf1';ctx.fillRect(0,0,w,h);ctx.fillStyle='#fbfbfd';ctx.fillRect(0,0,w,106);
  ctx.fillStyle='#6c7483';ctx.font='20px Arial';ctx.fillText('OUR WEDDING',32,34);
  ctx.fillStyle='#343a45';ctx.font='32px Georgia';recordingText(ctx,'Phyo Arkar Soe & Myat Thu Thu Ko',32,79,w-340);
  ctx.fillStyle='#a04e70';ctx.font='20px Arial';ctx.fillText('REC '+recordingDuration(performance.now()-session.startedClock),w-220,59);
  const gap=14,top=124,bottom=38,cw=(w-gap*(columns+1))/columns,ch=(h-top-bottom-gap*(rows-1))/rows;
  inputs.forEach((input,i)=>{
    const x=gap+(i%columns)*(cw+gap),y=top+Math.floor(i/columns)*(ch+gap),v=input.video;
    ctx.save();ctx.beginPath();ctx.rect(x,y,cw,ch);ctx.clip();ctx.fillStyle='#dce2eb';ctx.fillRect(x,y,cw,ch);
    if(v&&v.readyState>=2&&v.videoWidth&&v.videoHeight){const scale=Math.min(cw/v.videoWidth,ch/v.videoHeight),dw=v.videoWidth*scale,dh=v.videoHeight*scale;try{ctx.drawImage(v,x+(cw-dw)/2,y+(ch-dh)/2,dw,dh);}catch{}}
    else {ctx.fillStyle='#8993a3';ctx.font='42px Georgia';ctx.textAlign='center';ctx.fillText(input.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase(),x+cw/2,y+ch/2);ctx.textAlign='left';}
    ctx.font='18px Arial';const label=input.name+(input.id===selfId?' · Host':'');
    ctx.fillStyle='#ffffffdf';ctx.fillRect(x+9,y+ch-44,Math.min(cw-18,ctx.measureText(label).width+22),34);
    ctx.fillStyle='#343a45';recordingText(ctx,label,x+19,y+ch-20,cw-38);ctx.restore();
  });
  ctx.fillStyle='#788191';ctx.font='15px Arial';ctx.fillText('Our beginning, together.',32,h-12);
  session.videoTrack.requestFrame?.();
}
async function persistRecordingChunk(session,blob) {
  const index=session.sequence++;
  session.queue=session.queue.then(async()=>{
    let backedUp=false;
    try{await RecordingArchive.putChunk(session.meta.id,index,blob);backedUp=true;}
    catch{session.tail.push({index,blob});session.meta.backupIncomplete=true;}
    if(session.writer){try{await session.writer.write(blob);}catch{session.fileFailed=true;const failedWriter=session.writer;session.writer=null;void failedWriter.abort().catch(()=>{});notify('Direct file saving stopped',{detail:'The browser backup will be available to download.',kind:'error',duration:6500});}}
    session.meta.bytes+=blob.size;session.meta.durationMs=performance.now()-session.startedClock;
    recordingMemory.set(session.meta.id,{meta:{...session.meta},tail:session.tail});
    try{await RecordingArchive.putSession({...session.meta});}catch{}
    if(!backedUp&&!session.writer){session.problem='Browser storage filled or became unavailable. Recording stopped; download the recovered footage now.';void stopWeddingRecording();}
  }).catch(error=>{session.problem='Recording storage failed. Download the recovered footage.';void stopWeddingRecording();});
}
async function startWeddingRecording() {
  if(!active||!isHost||recordingPreparing||weddingRecording)return;
  if(!recordingCapability()){notify('Recording is unavailable in this browser',{detail:'Use desktop Chrome or Edge.',kind:'error'});return;}
  const generation=epoch;recordingPreparing=true;recordingControls();
  let audio,writer,session;
  try{
    // Audio resume is initiated in the recording button's user gesture.
    audio=new (window.AudioContext||window.webkitAudioContext)();const resumed=audio.resume();
    const mime=['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime)throw new Error('No supported recording format.');
    const extension=mime.includes('mp4')?'mp4':'webm',filename='Our-Wedding-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+extension;
    if(typeof window.showSaveFilePicker==='function'){
      try {
        const handle=await showSaveFilePicker({suggestedName:filename,types:[{description:'Wedding video',accept:{[extension==='mp4'?'video/mp4':'video/webm']:['.'+extension]}}]});
        if(!active||epoch!==generation)throw new DOMException('Call ended','AbortError');
        writer=await handle.createWritable();
      } catch(error) {
        if(error.name!=='SecurityError'&&error.name!=='NotAllowedError')throw error;
        // Embedded/unsupported file pickers fall back to local browser storage.
      }
    }
    await resumed;
    if(!active||epoch!==generation)throw new DOMException('Call ended','AbortError');
    await RecordingArchive.open();
    const meta={id:crypto.randomUUID(),filename,mime,startedAt:Date.now(),durationMs:0,bytes:0,state:'recording',direct:!!writer,backupIncomplete:false};
    await RecordingArchive.putSession(meta);
    const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
    const videoStream=canvas.captureStream(24),videoTrack=videoStream.getVideoTracks()[0];
    const destination=audio.createMediaStreamDestination(),compressor=audio.createDynamicsCompressor();compressor.threshold.value=-18;compressor.ratio.value=4;compressor.connect(destination);
    const output=new MediaStream([videoTrack,...destination.stream.getAudioTracks()]);
    const recorder=new MediaRecorder(output,{mimeType:mime,videoBitsPerSecond:4000000,audioBitsPerSecond:128000});
    session={meta,canvas,context:canvas.getContext('2d'),audio,compressor,destination,videoTrack,videoStream,output,recorder,writer,audioSources:new Map(),startedClock:performance.now(),sequence:0,queue:Promise.resolve(),tail:[],stopping:false,fileFailed:false};
    session.finished=new Promise(resolve=>session.finish=resolve);
    recorder.ondataavailable=event=>{if(event.data.size)void persistRecordingChunk(session,event.data);};
    recorder.onerror=()=>{session.problem='The browser interrupted recording. Recover the saved footage below.';void stopWeddingRecording();};
    recorder.onstop=()=>{void finishWeddingRecording(session);};
    syncRecordingAudio(session);drawWeddingRecording(session);
    if(!active||epoch!==generation)throw new DOMException('Call ended','AbortError');
    weddingRecording=session;recorder.start(5000);
    session.paintTimer=setInterval(()=>{try{drawWeddingRecording(session);}catch{}},1000/24);
    session.syncTimer=setInterval(()=>{try{syncRecordingAudio(session);}catch{}recordingControls();},500);
    broadcast({type:'recording',...recordingState()});
    for(const input of recordingSources())input.video?.play().catch(()=>{});
    notify('Recording everyone',{detail:writer?'Saving to your selected file, with a browser backup.':'Saving in this browser. Stop recording to download your video.',kind:'info',duration:6500});
  }catch(error){
    if(session){session.videoStream.getTracks().forEach(t=>t.stop());session.destination.stream.getTracks().forEach(t=>t.stop());}
    await writer?.abort().catch(()=>{});await audio?.close().catch(()=>{});
    if(error.name!=='AbortError')notify('Recording could not start',{detail:'Check available storage and use desktop Chrome or Edge. '+error.message,kind:'error',duration:7000});
    else notify('Recording was not started',{kind:'info'});
    if(weddingRecording===session)weddingRecording=null;
  }finally{recordingPreparing=false;recordingControls();}
}
async function stopWeddingRecording() {
  const session=weddingRecording;if(!session)return;
  if(!session.stopping){session.stopping=true;broadcast({type:'recording',active:false,by:ownName});recordingControls();if(session.recorder.state!=='inactive')session.recorder.stop();}
  return session.finished;
}
async function finishWeddingRecording(session) {
  if(session.finalizing)return;session.finalizing=true;
  clearInterval(session.paintTimer);clearInterval(session.syncTimer);
  await session.queue;
  if(session.writer){try{await session.writer.close();session.meta.savedToFile=true;}catch{session.fileFailed=true;session.problem='Could not finish the selected file. Download the browser backup.';}}
  session.audioSources.forEach(source=>source.disconnect());session.compressor.disconnect();
  session.videoStream.getTracks().forEach(t=>t.stop());session.destination.stream.getTracks().forEach(t=>t.stop());await session.audio.close().catch(()=>{});
  if(!session.meta.bytes)session.problem='No video data was produced. Please make a short test recording before the ceremony.';
  session.meta.durationMs=performance.now()-session.startedClock;session.meta.endedAt=Date.now();session.meta.note=session.problem||'';session.meta.state=session.problem?'interrupted':'complete';
  recordingMemory.set(session.meta.id,{meta:{...session.meta},tail:session.tail});
  try{await RecordingArchive.putSession({...session.meta});}catch{}
  session.finalizedData=true;
  await refreshRecordingLibrary();
  if(session.problem)notify('Recording needs attention',{detail:session.problem,kind:'error',duration:9000});
  else notify(session.meta.savedToFile?'Wedding recording saved to your file':'Wedding recording saved in this browser',{detail:session.meta.savedToFile?'You can also download the browser backup.':'Download your video from Wedding recordings.',duration:6500});
  if(!session.meta.savedToFile||session.problem)showRecordingLibrary();
  if(weddingRecording===session)weddingRecording=null;
  recordingControls();session.finish(session.meta);
}
async function recordingBlob(id) {
  const saved=await RecordingArchive.sessions().catch(()=>[]),memory=recordingMemory.get(id),meta=memory?.meta||saved.find(s=>s.id===id);
  if(!meta)throw new Error('Recording was not found on this device.');
  const chunks=await RecordingArchive.chunks(id).catch(()=>[]),byIndex=new Map(chunks.map(c=>[c.index,c.blob]));
  for(const c of memory?.tail||[])byIndex.set(c.index,c.blob);
  if(!byIndex.size)throw new Error('No video chunks were saved.');
  if(meta.backupIncomplete&&meta.savedToFile&&!memory?.tail.length)throw new Error('This browser backup is incomplete. Use the selected recording file.');
  return {meta,blob:new Blob([...byIndex].sort((a,b)=>a[0]-b[0]).map(([,blob])=>blob),{type:meta.mime})};
}
async function downloadRecording(id) {
  try{const {meta,blob}=await recordingBlob(id),url=URL.createObjectURL(blob),a=document.createElement('a');recordingURLs.push(url);a.href=url;a.download=meta.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);recordingURLs=recordingURLs.filter(u=>u!==url);},60000);notify('Recording download started',{detail:'Keep your downloaded video somewhere safe.'});}
  catch(error){notify('Could not download this recording',{detail:error.message,kind:'error',duration:7000});}
}
async function refreshRecordingLibrary() {
  let saved=[];try{saved=await RecordingArchive.sessions();}catch{}
  const all=new Map(saved.map(meta=>[meta.id,meta]));for(const [id,entry] of recordingMemory)all.set(id,entry.meta);
  const rows=[...all.values()].filter(meta=>meta.bytes>0||meta.state==='interrupted'||meta.id===weddingRecording?.meta.id).sort((a,b)=>b.startedAt-a.startedAt);
  $('recordings-section').hidden=!rows.length;
  for(const target of [$('recordings-list'),$('recordings-modal-list')]){
    target.replaceChildren();
    for(const meta of rows){
      const row=document.createElement('div');row.className='recording-row';
      const body=document.createElement('div'),title=document.createElement('strong'),info=document.createElement('p'),button=document.createElement('button');
      title.textContent=new Date(meta.startedAt).toLocaleString();
      const incomplete=meta.state!=='complete',inProgress=meta.id===weddingRecording?.meta.id&&!weddingRecording.finalizedData;
      info.textContent=recordingDuration(meta.durationMs)+' · '+(meta.bytes/1048576).toFixed(1)+' MB · '+(inProgress?'Recording now':meta.savedToFile?'Saved to selected file':incomplete?'Interrupted — recover saved footage':'Saved in this browser');
      body.append(title,info);if(meta.note){const note=document.createElement('p');note.textContent=meta.note;body.append(note);}button.type='button';button.textContent=inProgress?'Recording…':incomplete?'Recover video':'Download video';
      button.disabled=!meta.bytes||(meta.id===weddingRecording?.meta.id&&!weddingRecording.finalizedData);
      if(meta.backupIncomplete&&meta.savedToFile&&!recordingMemory.get(meta.id)?.tail.length){button.disabled=true;button.textContent='Use saved file';}
      button.addEventListener('click',()=>{button.disabled=true;void downloadRecording(meta.id).finally(()=>{button.disabled=false;});});row.append(body,button);target.append(row);
    }
    if(!rows.length){const p=document.createElement('p');p.className='fine-print';p.textContent='Recordings saved on this device will appear here.';target.append(p);}
  }
}
function showRecordingLibrary() {
  toggleCameraMenu(false);
  const dialog=$('recordings-dialog'),target=$('call-stage').classList.contains('full-view')?$('call-stage'):document.body;
  if(dialog.parentElement!==target){if(dialog.open)dialog.close();target.append(dialog);}
  void refreshRecordingLibrary();if(!dialog.open)dialog.showModal();
}
$('record-toggle').addEventListener('click',()=>{if(weddingRecording)void stopWeddingRecording();else void startWeddingRecording();});
$('open-recordings').addEventListener('click',showRecordingLibrary);
$('close-recordings').addEventListener('click',()=>$('recordings-dialog').close());
$('recordings-dialog').addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
window.addEventListener('beforeunload',event=>{if(weddingRecording||recordingPreparing){event.preventDefault();event.returnValue='';}});
void refreshRecordingLibrary();
