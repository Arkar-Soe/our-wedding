'use strict';
function indexedRecordingBlob(chunks,mime) {
  let spans=[];
  for(const part of [...chunks].sort((a,b)=>a.index-b.index)){
    const start=part.position,end=start+part.blob.size;if(!Number.isSafeInteger(start)||start<0)throw new Error('Invalid timeline file offset.');
    const next=[];for(const old of spans){
      if(old.end<=start||old.start>=end){next.push(old);continue;}
      if(old.start<start)next.push({start:old.start,end:start,blob:old.blob.slice(0,start-old.start)});
      if(old.end>end)next.push({start:end,end:old.end,blob:old.blob.slice(end-old.start)});
    }
    next.push({start,end,blob:part.blob});spans=next.sort((a,b)=>a.start-b.start);
  }
  let position=0;for(const span of spans){if(span.start!==position)throw new Error('The timeline file is incomplete. The original is still available.');position=span.end;}
  if(!position)throw new Error('No indexed video data was found.');return new Blob(spans.map(s=>s.blob),{type:mime});
}
function timelineProgressUI() {
  const job=recordingTimelineJob;$('timeline-progress').hidden=!job;$('timeline-cancel').hidden=!job;
  if(job){$('timeline-progress').value=job.progress;$('timeline-status').textContent='Preparing video timeline… '+Math.round(job.progress*100)+'%';}
  $('repair-recording-file').disabled=!!job||!!weddingRecording||recordingPreparing;
}
async function buildRecordingTimeline(blob,mime,{chunkSize,onProgress}={}) {
  if(recordingTimelineJob)throw new Error('Another recording timeline is being prepared.');
  await RecordingArchive.open();const key='timeline:'+crypto.randomUUID();
  const sourceURL=new URL('recording-timeline-worker.js?v=20261115-seek',document.baseURI);
  const wrapperURL=location.protocol==='file:'?URL.createObjectURL(new Blob(['importScripts('+JSON.stringify(sourceURL.href)+');'],{type:'text/javascript'})):null;
  let worker;try{worker=new Worker(wrapperURL||sourceURL);}catch(error){if(wrapperURL)URL.revokeObjectURL(wrapperURL);throw error;}
  const job={key,worker,progress:0,cancel:null};recordingTimelineJob=job;timelineProgressUI();recordingControls();
  try{
    return await new Promise((resolve,reject)=>{
      let settled=false;const fail=error=>{if(settled)return;settled=true;reject(error);};
      job.cancel=()=>fail(new DOMException('Timeline preparation cancelled. The original recording was kept.','AbortError'));
      worker.onerror=event=>{event.preventDefault();fail(new Error('The timeline tools could not load. Keep the original and check that all website files were uploaded.'));};
      worker.onmessage=event=>{const data=event.data;
        if(data.type==='progress'){job.progress=data.progress;timelineProgressUI();onProgress?.(data.progress);recordingControls();}
        if(data.type==='error')fail(new Error(data.message));
        if(data.type==='complete'&&!settled){settled=true;resolve(data);}
      };
      worker.postMessage({blob,key,mime,chunkSize,libraryURL:new URL('mediabunny.js?v=1.66.0',document.baseURI).href});
    });
  }catch(error){worker.terminate();try{await RecordingArchive.deleteChunks(key);}catch{}throw error;}
  finally{worker.terminate();if(wrapperURL)URL.revokeObjectURL(wrapperURL);if(recordingTimelineJob===job)recordingTimelineJob=null;timelineProgressUI();recordingControls();}
}
async function persistTimelineMetadata(meta,result) {
  const next={...meta,timelineKey:result.key,timelineVersion:1,timelineState:'ready',bytes:result.size,durationMs:result.durationMs,backupIncomplete:false,fileTimelineReady:meta.savedToFile?false:meta.fileTimelineReady,timelineNote:''};
  await RecordingArchive.putSession(next);Object.assign(meta,next);recordingMemory.set(meta.id,{meta:{...meta},tail:[]});
}
async function finishSessionTimeline(session) {
  let source,result,committed=false;
  try{
    if(session.meta.backupIncomplete&&session.fileHandle?.getFile)source=await session.fileHandle.getFile();
    else source=(await recordingBlob(session.meta.id)).blob;
    result=await buildRecordingTimeline(source,session.meta.mime);
    const indexed=indexedRecordingBlob(await RecordingArchive.chunks(result.key),session.meta.mime);if(indexed.size!==result.size)throw new Error('The indexed file is incomplete.');
    await persistTimelineMetadata(session.meta,result);committed=true;
    // A new durable indexed copy now exists. Release redundant raw browser chunks.
    try{await RecordingArchive.deleteChunks(session.meta.id);}catch{}
    session.tail=[];
    if(session.meta.savedToFile&&session.fileHandle){
      let writer;
      try{
        writer=await session.fileHandle.createWritable();
        const reader=indexed.stream().getReader();try{for(;;){const {value,done}=await reader.read();if(done)break;await writer.write(value);}}finally{reader.releaseLock();}
        await writer.close();session.meta.fileTimelineReady=true;
      }catch{await writer?.abort().catch(()=>{});session.meta.fileTimelineReady=false;session.meta.timelineNote='Your selected file still has the original container. Download the seekable copy from Wedding recordings.';}
    }
  }catch(error){if(!committed){if(result?.key)try{await RecordingArchive.deleteChunks(result.key);}catch{}session.meta.timelineState='pending';}session.meta.timelineNote=error.name==='AbortError'?'Timeline preparation was cancelled. The original footage was kept.':'Timeline preparation could not finish. The original footage was kept. '+error.message;}
}
async function fixSavedRecordingTimeline(id) {
  if(weddingRecording||recordingPreparing||recordingTimelineJob)return;
  let result,committed=false;
  try{
    const {meta,blob}=await recordingBlob(id);result=await buildRecordingTimeline(blob,meta.mime);const indexed=indexedRecordingBlob(await RecordingArchive.chunks(result.key),meta.mime);if(indexed.size!==result.size)throw new Error('The indexed file is incomplete.');await persistTimelineMetadata(meta,result);committed=true;
    try{await RecordingArchive.deleteChunks(id);}catch{}
    $('timeline-status').textContent='Timeline ready. Download the seekable copy below.';await refreshRecordingLibrary();notify('Video timeline fixed',{detail:'Download the updated recording to scrub forward and backward.'});
  }catch(error){if(result?.key&&!committed)try{await RecordingArchive.deleteChunks(result.key);}catch{}$('timeline-status').textContent=error.message;notify('Original recording kept',{kind:'info',detail:error.message,duration:6500});}
}
async function repairRecordingFile(file) {
  if(!file||weddingRecording||recordingPreparing||recordingTimelineJob)return;
  let result,committed=false;
  try{
    const head=new Uint8Array(await file.slice(0,16).arrayBuffer()),mp4=String.fromCharCode(...head.slice(4,8))==='ftyp',webm=[0x1a,0x45,0xdf,0xa3].every((v,i)=>head[i]===v);
    if(!mp4&&!webm)throw new Error('Choose an MP4 or WebM wedding recording.');
    const mime=mp4?'video/mp4':'video/webm';result=await buildRecordingTimeline(file,mime);
    const meta={id:crypto.randomUUID(),filename:file.name.replace(/\.(mp4|webm)$/i,'')+'-seekable.'+(mp4?'mp4':'webm'),mime,startedAt:file.lastModified||Date.now(),durationMs:result.durationMs,bytes:result.size,state:'complete',note:'Timeline repaired from a selected file. The original file is unchanged.',direct:false,savedToFile:false};
    const indexed=indexedRecordingBlob(await RecordingArchive.chunks(result.key),mime);if(indexed.size!==result.size)throw new Error('The indexed file is incomplete.');
    await persistTimelineMetadata(meta,result);committed=true;$('timeline-status').textContent='Timeline fixed. Download the seekable copy below.';await refreshRecordingLibrary();notify('Video timeline fixed',{detail:'Download the new copy. Your original file is unchanged.'});
  }catch(error){if(result?.key&&!committed)try{await RecordingArchive.deleteChunks(result.key);}catch{}$('timeline-status').textContent=error.message;notify('Original file kept',{kind:'info',detail:error.message,duration:6500});}
}
$('timeline-cancel').addEventListener('click',()=>recordingTimelineJob?.cancel?.());
$('repair-recording-file').addEventListener('click',()=>{$('timeline-file').value='';$('timeline-file').click();});
$('timeline-file').addEventListener('change',()=>{void repairRecordingFile($('timeline-file').files[0]);});
$('open-recording-tools').addEventListener('click',showRecordingLibrary);
