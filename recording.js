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
let weddingRecording=null, recordingPreparing=false, remoteRecording=false, remoteRecordingResolution='';
const recordingMemory=new Map();
let recordingURLs=[];
function recordingDuration(ms) {const s=Math.floor(ms/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');}
function recordingCapability() {return !!(window.MediaRecorder&&HTMLCanvasElement.prototype.captureStream&&(window.AudioContext||window.webkitAudioContext)&&window.indexedDB);}
const RECORDING_FORMATS={mp4:['video/mp4;codecs=avc1.42E028,mp4a.40.2','video/mp4'],webm:['video/webm;codecs=vp8,opus','video/webm']};
function recordingMime(format) {
  return window.MediaRecorder&&RECORDING_FORMATS[format]?.find(type=>MediaRecorder.isTypeSupported(type))||'';
}
function recordingFormatControls() {
  const select=$('recording-format');
  $('recording-format-settings').hidden=!active||!isHost;
  for(const option of select.options)option.disabled=!recordingMime(option.value);
  if(!recordingMime(select.value))select.value=[...select.options].find(option=>!option.disabled)?.value||'';
  select.disabled=recordingPreparing||!!weddingRecording||!recordingMime(select.value);
  $('recording-format-help').textContent=!recordingMime('mp4')
    ? 'MP4 recording is unavailable in this browser. WebM will be used when supported.'
    : select.value==='mp4'?'MP4 keeps its starting resolution and automatically adjusts frame rate. WebM can also change resolution during recording.'
    : 'WebM automatically adjusts resolution and frame rate during recording.';
}
function recordingControls() {
  recordingFormatControls();
  const button=$('record-toggle');
  button.hidden=!active||!isHost;
  button.disabled=recordingPreparing||!!weddingRecording?.stopping||!recordingCapability()||!recordingMime($('recording-format').value);
  const label=recordingPreparing?'Preparing…':weddingRecording?.stopping?'Saving…':weddingRecording?'Stop recording':'Record all';
  if(button.querySelector('.button-label')?.textContent!==label)buttonLabel('record-toggle',label);
  button.setAttribute('aria-pressed',String(!!weddingRecording&&!weddingRecording.stopping));
  button.title=recordingCapability()?'Record everyone and save on this device':'Recording is unavailable in this browser. Use desktop Chrome or Edge.';
  const show=!!weddingRecording||remoteRecording,wasVisible=!$('recording-indicator').hidden;
  $('recording-indicator').hidden=!show;
  if(show!==wasVisible)requestAnimationFrame(arrangeVideos);
  if(weddingRecording){const text=weddingRecording.stopping?'Saving recording…':'REC Auto '+(weddingRecording.currentProfile||weddingRecording.profile).height+'p '+recordingDuration(performance.now()-weddingRecording.startedClock);if($('recording-indicator').textContent!==text)$('recording-indicator').textContent=text;}
  else if(remoteRecording)$('recording-indicator').textContent='REC · Host is recording'+(remoteRecordingResolution?' · '+remoteRecordingResolution:'');
  if(show)$('recording-indicator').title='The host is recording the gallery and all connected audio on their device.';
}
function recordingNoticeForGuests(data) {
  const next=!!data?.active;remoteRecordingResolution=next&&Number.isFinite(data?.height)?data.height+'p':'';
  if(next!==remoteRecording){remoteRecording=next;if(next)notify('The host is recording this call',{detail:'Video and audio are being saved on the host’s device.',kind:'info',duration:6500});}
  recordingControls();
}
function recordingState() {const p=weddingRecording?.currentProfile||weddingRecording?.profile;return {active:!!weddingRecording&&!weddingRecording.stopping,by:ownName,width:p?.width,height:p?.height,automatic:true};}
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
const RECORDING_LEVELS=[{width:1920,height:1080,fps:24,bitrate:3500000},{width:1280,height:720,fps:20,bitrate:1800000},{width:960,height:540,fps:15,bitrate:1000000},{width:640,height:360,fps:12,bitrate:500000},{width:426,height:240,fps:10,bitrate:260000}];
function recordingProfile() {
 const live=videoProfile().height,cores=navigator.hardwareConcurrency||4,memory=navigator.deviceMemory||4;
 let ceiling=live>=1080?1080:live>=720?720:live>=480?540:live>=360?360:240;
 if(roster.length>4||cores<=4||memory<=4)ceiling=Math.min(ceiling,720);
 return {...RECORDING_LEVELS.find(p=>p.height<=ceiling)||RECORDING_LEVELS.at(-1)};
}
function applyRecordingProfile(session,profile) {
 if(session.stopping)return;
 if(!session.dynamicResolution)profile={...profile,width:session.profile.width,height:session.profile.height};
 if(session.currentProfile&&session.currentProfile.width===profile.width&&session.currentProfile.height===profile.height&&session.targetFPS===profile.fps)return;
 session.currentProfile={...profile};session.targetFPS=profile.fps;
 session.meta.qualityHistory.push({atMs:performance.now()-session.startedClock,width:profile.width,height:profile.height,fps:profile.fps});
 session.meta.currentWidth=profile.width;session.meta.currentHeight=profile.height;
 session.sceneSignature=null;
 if(session.workerReady)session.worker.postMessage({type:'profile',profile});
 else {
  session.canvas.width=profile.width;session.canvas.height=profile.height;
  if(session.renderCanvas!==session.canvas){session.renderCanvas.width=profile.width;session.renderCanvas.height=profile.height;}
  for(const layer of [session.background,session.foreground]){layer.width=profile.width;layer.height=profile.height;}
  session.nextPaint=performance.now();
 }
 refreshRecordingScene(session);broadcast({type:'recording',...recordingState()});recordingControls();
 notify('Recording quality adjusted automatically',{kind:'info',detail:profile.height+'p · '+profile.fps+' fps · recording continues'});
}
function adaptRecordingQuality() {
 const session=weddingRecording;if(!session||session.stopping)return;
 const now=performance.now();if(session.lastAdaptAt&&now-session.lastAdaptAt<3000)return;
 const elapsed=session.lastAdaptAt?(now-session.lastAdaptAt)/1000:0,frames=(session.framesPresented||0)-(session.lastAdaptFrames||0);
 session.lastAdaptAt=now;session.lastAdaptFrames=session.framesPresented||0;
 const lowFPS=elapsed>0&&frames/elapsed<session.targetFPS*.65;
 const struggling=lowFPS||autoQuality.cpuPressure||autoQuality.maxLoopLag>150;
 session.badQualitySamples=struggling?(session.badQualitySamples||0)+1:0;
 session.goodQualitySamples=struggling?0:(session.goodQualitySamples||0)+1;
 if(session.badQualitySamples>=2){session.recordingPenalty=Math.min(RECORDING_LEVELS.length-1,(session.recordingPenalty||0)+1);session.badQualitySamples=0;}
 else if(session.goodQualitySamples>=10&&(session.recordingPenalty||0)>0){session.recordingPenalty--;session.goodQualitySamples=0;}
 const base=recordingProfile(),baseIndex=RECORDING_LEVELS.findIndex(p=>p.height===base.height),initial=RECORDING_LEVELS.findIndex(p=>p.height===session.profile.height);
 const desired=RECORDING_LEVELS[Math.min(RECORDING_LEVELS.length-1,Math.max(initial,baseIndex)+(session.recordingPenalty||0))];
 applyRecordingProfile(session,{...desired});
}


function weddingCompositorWorker() {
  let renderWidth=1920,renderHeight=1080,frameRate=24;
  let canvas,ctx,back,front,members=[],rects=[],lastKey='',lastSecond=-1,timer,started=0,available=true;
  const tracks=new Map();
  async function readTrack(id,stream){const reader=stream.getReader(),entry={reader,frame:null};const previous=tracks.get(id);if(previous){previous.frame?.close();void previous.reader.cancel().catch(()=>{});}tracks.set(id,entry);try{while(tracks.get(id)===entry){const result=await reader.read();if(result.done)break;if(tracks.get(id)!==entry){result.value.close();break;}entry.frame?.close();entry.frame=result.value;}}catch{}finally{if(tracks.get(id)===entry){entry.frame?.close();tracks.delete(id);}}}
  function paintTracks(){if(!available||!canvas)return;try{layers(performance.now()-started);ctx.drawImage(back,0,0);for(const r of rects){if(r.member.visible===false)continue;const frame=tracks.get(r.member.id)?.frame;if(!frame)continue;const x=r.x*renderWidth/1920,y=r.y*renderHeight/1080,cw=r.width*renderWidth/1920,ch=r.height*renderHeight/1080,scale=Math.min(cw/frame.displayWidth,ch/frame.displayHeight),w=frame.displayWidth*scale,h=frame.displayHeight*scale;ctx.drawImage(frame,x+(cw-w)/2,y+(ch-h)/2,w,h);}ctx.drawImage(front,0,0);const bitmap=canvas.transferToImageBitmap();available=false;self.postMessage({type:'frame',bitmap},[bitmap]);}catch(error){self.postMessage({type:'failed',message:error.message});clearInterval(timer);}}
  const duration=ms=>{const s=Math.floor(ms/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');};
  function text(c,value,x,y,max){value=String(value);while(c.measureText(value).width>max&&value.length>1)value=value.slice(0,-2)+'…';c.fillText(value,x,y);}
  function layers(elapsed) {
    const second=Math.floor(elapsed/1000),key=members.map(m=>m.id+':'+m.name).join('|');
    if(lastKey===key&&lastSecond===second)return;
    lastKey=key;lastSecond=second;
    const n=Math.max(1,members.length),cols=n===1?1:n<=4?2:3,rows=Math.ceil(n/cols),gap=14,top=124,bottom=38,cw=(1920-gap*(cols+1))/cols,ch=(1080-top-bottom-gap*(rows-1))/rows;
    rects=members.map((member,i)=>({x:gap+(i%cols)*(cw+gap),y:top+Math.floor(i/cols)*(ch+gap),width:cw,height:ch,member}));
    const b=back.getContext('2d'),f=front.getContext('2d');b.setTransform(renderWidth/1920,0,0,renderHeight/1080,0,0);f.setTransform(renderWidth/1920,0,0,renderHeight/1080,0,0);b.fillStyle='#e9ecf1';b.fillRect(0,0,1920,1080);b.fillStyle='#fbfbfd';b.fillRect(0,0,1920,106);
    f.clearRect(0,0,1920,1080);f.fillStyle='#6c7483';f.font='20px Arial';f.fillText('OUR WEDDING',32,34);f.fillStyle='#343a45';f.font='32px Georgia';text(f,'Phyo Arkar Soe & Myat Thu Thu Ko',32,79,1580);f.fillStyle='#a04e70';f.font='20px Arial';f.fillText('REC '+duration(elapsed),1700,59);
    for(const r of rects){const {x,y,width:w,height:h,member}=r;b.fillStyle='#dce2eb';b.fillRect(x,y,w,h);b.fillStyle='#8993a3';b.font='42px Georgia';b.textAlign='center';b.fillText(member.name.split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase(),x+w/2,y+h/2);b.textAlign='left';const label=member.name+(member.host?' · Host':'');f.font='18px Arial';f.fillStyle='#ffffffdf';f.fillRect(x+9,y+h-44,Math.min(w-18,f.measureText(label).width+22),34);f.fillStyle='#343a45';text(f,label,x+19,y+h-20,w-38);}
    f.fillStyle='#788191';f.font='15px Arial';f.fillText('Our beginning, together.',32,1068);
  }
  self.onmessage=event=>{
    const data=event.data;
    if(data.type==='init'){
      try{renderWidth=data.profile.width;renderHeight=data.profile.height;frameRate=data.profile.fps;canvas=new OffscreenCanvas(renderWidth,renderHeight);ctx=canvas.getContext('2d',{alpha:false});back=new OffscreenCanvas(renderWidth,renderHeight);front=new OffscreenCanvas(renderWidth,renderHeight);self.postMessage({type:'ready'});}catch(error){self.postMessage({type:'failed',message:error.message});}
      return;
    }
    if(data.type==='profile'){renderWidth=data.profile.width;renderHeight=data.profile.height;frameRate=data.profile.fps;for(const layer of [canvas,back,front]){layer.width=renderWidth;layer.height=renderHeight;}lastKey='';if(timer){clearInterval(timer);timer=setInterval(paintTracks,1000/frameRate);}return;}
    if(data.type==='scene'){members=data.members;lastKey='';return;}
    if(data.type==='track'){void readTrack(data.id,data.stream);return;}
    if(data.type==='remove'){const entry=tracks.get(data.id);tracks.delete(data.id);entry?.frame?.close();void entry?.reader.cancel().catch(()=>{});return;}
    if(data.type==='run'){started=performance.now()-data.elapsed;clearInterval(timer);frameRate=data.fps;timer=setInterval(paintTracks,1000/frameRate);paintTracks();return;}
    if(data.type==='ack'){available=true;return;}
    if(data.type!=='frame')return;
    try{
      layers(data.elapsed);ctx.drawImage(back,0,0);const images=new Map(data.images.map(image=>[image.id,image.bitmap]));
      for(const r of rects){const bitmap=images.get(r.member.id);if(!bitmap)continue;const scale=Math.min(r.width/bitmap.width,r.height/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;ctx.drawImage(bitmap,r.x+(r.width-w)/2,r.y+(r.height-h)/2,w,h);}
      ctx.drawImage(front,0,0);const bitmap=canvas.transferToImageBitmap();self.postMessage({type:'frame',bitmap},[bitmap]);
    }catch(error){self.postMessage({type:'failed',message:error.message});}
    finally{for(const image of data.images||[])image.bitmap.close();}
  };
}
function fallbackRecordingRenderer(session) {
  const wasWorker=session.workerReady;session.workerReady=false;session.workerBusy=false;for(const entry of session.processors?.values()||[])entry.clone.stop();session.processors?.clear();session.worker?.terminate();session.worker=null;
  if(session.presentContext?.transferFromImageBitmap){session.renderCanvas=new OffscreenCanvas(session.currentProfile.width,session.currentProfile.height);session.context=session.renderCanvas.getContext('2d',{alpha:false});}
  else {session.renderCanvas=session.canvas;session.context=session.presentContext||session.canvas.getContext('2d',{alpha:false});}
  session.meta.compositor='main-fallback';session.meta.frameTransport='canvas';session.sceneSignature=null;
  if(wasWorker&&!session.stopping&&session.recorder?.state==='recording')startRecordingPainter(session);
}
async function initializeRecordingRenderer(session) {
  if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof MediaStreamTrackProcessor==='undefined'){fallbackRecordingRenderer(session);return;}
  try{
    const source='('+weddingCompositorWorker.toString()+')();';session.workerURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    session.worker=new Worker(session.workerURL);
    session.presentContext=session.canvas.getContext('bitmaprenderer')||session.canvas.getContext('2d',{alpha:false});
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Recording worker did not start')),5000);
      session.worker.onmessage=event=>{
        const data=event.data;
        if(data.type==='ready'){clearTimeout(timeout);session.workerReady=true;session.meta.compositor='worker';session.meta.frameTransport='track-processor';resolve();return;}
        if(data.type==='frame'){
          session.workerBusy=false;
          try{
            if(!session.stopping){if(session.canvas.width!==data.bitmap.width||session.canvas.height!==data.bitmap.height){session.canvas.width=data.bitmap.width;session.canvas.height=data.bitmap.height;}if(session.presentContext.transferFromImageBitmap)session.presentContext.transferFromImageBitmap(data.bitmap);else session.presentContext.drawImage(data.bitmap,0,0);if(session.manualCapture)session.videoTrack.requestFrame();session.framesPresented=(session.framesPresented||0)+1;}
          }finally{data.bitmap.close();if(!session.stopping)session.worker?.postMessage({type:'ack'});}
        }
        if(data.type==='failed'){clearTimeout(timeout);if(!session.workerReady)reject(new Error(data.message));else{fallbackRecordingRenderer(session);refreshRecordingScene(session);}}
      };
      session.worker.onerror=event=>{event.preventDefault();clearTimeout(timeout);if(!session.workerReady)reject(new Error('Worker unavailable'));else{fallbackRecordingRenderer(session);refreshRecordingScene(session);}};
      session.worker.postMessage({type:'init',profile:session.currentProfile});
    });
  }catch{fallbackRecordingRenderer(session);}
}
function syncRecordingVideoTracks(session) {
  if(!session.workerReady)return;
  session.processors ||= new Map();const present=new Set();
  for(const input of session.inputs||recordingSources()){
    const original=input.stream?.getVideoTracks().find(t=>t.readyState==='live');if(!original)continue;
    present.add(input.id);const existing=session.processors.get(input.id);
    if(existing?.original===original){existing.clone.enabled=original.enabled;continue;}
    if(existing){existing.clone.stop();session.worker.postMessage({type:'remove',id:input.id});}
    const clone=original.clone();clone.enabled=original.enabled;
    try{const processor=new MediaStreamTrackProcessor({track:clone,maxBufferSize:1});session.worker.postMessage({type:'track',id:input.id,stream:processor.readable},[processor.readable]);session.processors.set(input.id,{original,clone,processor});}
    catch{clone.stop();fallbackRecordingRenderer(session);refreshRecordingScene(session);return;}
  }
  for(const [id,entry] of session.processors)if(!present.has(id)){entry.clone.stop();session.processors.delete(id);session.worker.postMessage({type:'remove',id});}
}
function recordingVideoStateChanged() {
  const session=weddingRecording;if(!session||session.stopping)return;
  session.sceneSignature=null;refreshRecordingScene(session);syncRecordingVideoTracks(session);
}
function releaseRecordingRenderer(session) {for(const entry of session.processors?.values()||[])entry.clone.stop();session.processors?.clear();session.worker?.terminate();if(session.workerURL)URL.revokeObjectURL(session.workerURL);}

function refreshRecordingScene(session) {
  session.inputs=recordingSources().slice(0,MAX_PARTICIPANTS);
  const signature=session.inputs.map(input=>input.id+':'+input.name).join('|');
  const second=Math.floor((performance.now()-session.startedClock)/1000);
  if(signature===session.sceneSignature&&second===session.sceneSecond)return;
  session.sceneSignature=signature;session.sceneSecond=second;
  const w=session.canvas.width,h=session.canvas.height,scale=w/1920;
  const n=Math.max(1,session.inputs.length),columns=n===1?1:n<=4?2:3,rows=Math.ceil(n/columns);
  const gap=14*scale,top=124*scale,bottom=38*scale,cw=(w-gap*(columns+1))/columns,ch=(h-top-bottom-gap*(rows-1))/rows;
  session.rects=session.inputs.map((input,i)=>({x:gap+(i%columns)*(cw+gap),y:top+Math.floor(i/columns)*(ch+gap),width:cw,height:ch,input}));
  if(session.workerReady){session.worker.postMessage({type:'scene',members:session.inputs.map(input=>({id:input.id,name:input.name,host:input.id===selfId,visible:input.stream?.getVideoTracks()[0]?.enabled!==false}))});return;}
  const back=session.background.getContext('2d'),front=session.foreground.getContext('2d');
  back.setTransform(scale,0,0,scale,0,0);front.setTransform(scale,0,0,scale,0,0);
  back.fillStyle='#e9ecf1';back.fillRect(0,0,1920,1080);back.fillStyle='#fbfbfd';back.fillRect(0,0,1920,106);
  front.clearRect(0,0,1920,1080);front.fillStyle='#6c7483';front.font='20px Arial';front.fillText('OUR WEDDING',32,34);
  front.fillStyle='#343a45';front.font='32px Georgia';recordingText(front,'Phyo Arkar Soe & Myat Thu Thu Ko',32,79,1580);
  front.fillStyle='#a04e70';front.font='20px Arial';front.fillText('REC '+recordingDuration(performance.now()-session.startedClock),1700,59);
  for(const r of session.rects){
    const x=r.x/scale,y=r.y/scale,cw=r.width/scale,ch=r.height/scale,input=r.input;
    back.fillStyle='#dce2eb';back.fillRect(x,y,cw,ch);
    back.fillStyle='#8993a3';back.font='42px Georgia';back.textAlign='center';back.fillText(input.name.split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase(),x+cw/2,y+ch/2);back.textAlign='left';
    const label=input.name+(input.id===selfId?' · Host':'');front.font='18px Arial';front.fillStyle='#ffffffdf';front.fillRect(x+9,y+ch-44,Math.min(cw-18,front.measureText(label).width+22),34);front.fillStyle='#343a45';recordingText(front,label,x+19,y+ch-20,cw-38);
  }
  front.fillStyle='#788191';front.font='15px Arial';front.fillText('Our beginning, together.',32,1068);
}
function drawWeddingRecording(session) {
  if(!session.inputs)refreshRecordingScene(session);
  if(session.workerReady)return;
  const ctx=session.context;
  ctx.drawImage(session.background,0,0);
  for(const r of session.rects){
    const v=r.input.video;if(!v||v.readyState<2||!v.videoWidth||!v.videoHeight)continue;
    const scale=Math.min(r.width/v.videoWidth,r.height/v.videoHeight),dw=v.videoWidth*scale,dh=v.videoHeight*scale;
    try{ctx.drawImage(v,r.x+(r.width-dw)/2,r.y+(r.height-dh)/2,dw,dh);}catch{}
  }
  ctx.drawImage(session.foreground,0,0);
  if(session.presentContext?.transferFromImageBitmap)session.presentContext.transferFromImageBitmap(session.renderCanvas.transferToImageBitmap());
  if(!session.workerReady)session.framesPresented=(session.framesPresented||0)+1;
  if(session.manualCapture)session.videoTrack.requestFrame();
}
function startRecordingPainter(session) {
  cancelAnimationFrame(session.paintRAF);
  if(session.workerReady){syncRecordingVideoTracks(session);session.worker.postMessage({type:'run',elapsed:performance.now()-session.startedClock,fps:session.targetFPS});return;}
  session.nextPaint=performance.now();session.paintEWMA=0;session.lateFrames=0;session.framesDrawn=0;
  const paint=now=>{
    if(session.stopping)return;
    if(now>=session.nextPaint){
      const interval=1000/session.targetFPS,late=now-session.nextPaint,start=performance.now();
      try{drawWeddingRecording(session);}catch{}
      const cost=performance.now()-start;session.framesDrawn++;
      session.paintEWMA=session.paintEWMA*.9+cost*.1;
      // Never catch up with a burst of expensive frames after a stall.
      session.nextPaint=late>interval?now+interval:session.nextPaint+interval;
      session.lateFrames=late>100||cost>interval*.4?session.lateFrames+1:Math.max(0,session.lateFrames-1);
      // Skip catch-up frames; the quality governor handles sustained pressure.
    }
    session.paintRAF=requestAnimationFrame(paint);
  };
  session.paintRAF=requestAnimationFrame(paint);
}
async function persistRecordingChunk(session,blob) {
  const index=session.sequence++;
  session.pendingChunks=(session.pendingChunks||0)+1;session.queuedBytes=(session.queuedBytes||0)+blob.size;
  if(session.pendingChunks>6||session.queuedBytes>32*1024*1024){session.problem='Recording stopped because storage could not keep up. The call remains connected; save the recorded portion before trying again.';void stopWeddingRecording();}
  session.queue=session.queue.then(async()=>{
    let backedUp=false,fileWritten=false;
    try{await RecordingArchive.putChunk(session.meta.id,index,blob);backedUp=true;}
    catch{session.meta.backupIncomplete=true;}
    if(session.writer){try{await session.writer.write(blob);fileWritten=true;}catch{session.fileFailed=true;const failedWriter=session.writer;session.writer=null;void failedWriter.abort().catch(()=>{});notify('Direct file saving stopped',{detail:'Download the available browser backup.',kind:'error',duration:6500});}}
    // Do not retain an entire long ceremony in RAM if browser backup storage fills.
    if(!backedUp&&!fileWritten)session.tail.push({index,blob});
    if(!backedUp&&fileWritten&&!session.backupNotice){session.backupNotice=true;notify('Browser backup storage is full',{detail:'Recording continues in your selected file.',kind:'info',duration:6500});}
    session.meta.bytes+=blob.size;session.meta.durationMs=performance.now()-session.startedClock;
    recordingMemory.set(session.meta.id,{meta:{...session.meta},tail:session.tail});
    try{await RecordingArchive.putSession({...session.meta});}catch{}
    if(!backedUp&&!session.writer){session.problem='Browser storage filled or became unavailable. Recording stopped; download the recovered footage now.';void stopWeddingRecording();}
  }).catch(()=>{session.problem='Recording storage failed. Download the recovered footage.';void stopWeddingRecording();})
    .finally(()=>{session.pendingChunks--;session.queuedBytes-=blob.size;});
}
async function startWeddingRecording() {
  if(!active||!isHost||recordingPreparing||weddingRecording)return;
  if(!recordingCapability()){notify('Recording is unavailable in this browser',{detail:'Use desktop Chrome or Edge.',kind:'error'});return;}
  const generation=epoch;recordingPreparing=true;recordingControls();
  let audio,writer,session;
  try{
    // Audio resume is initiated in the recording button's user gesture.
    audio=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'playback'});const resumed=audio.resume();
    const mime=recordingMime($('recording-format').value);
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
    const profile=recordingProfile();
    const meta={recordingWidth:profile.width,recordingHeight:profile.height,recordingFPS:profile.fps,id:crypto.randomUUID(),filename,mime,startedAt:Date.now(),durationMs:0,bytes:0,state:'recording',direct:!!writer,backupIncomplete:false};
    await RecordingArchive.putSession(meta);
    const canvas=document.createElement('canvas');canvas.width=profile.width;canvas.height=profile.height;
    const manualCapture=typeof CanvasCaptureMediaStreamTrack!=='undefined'&&typeof CanvasCaptureMediaStreamTrack.prototype.requestFrame==='function';
    const videoStream=canvas.captureStream(manualCapture?0:profile.fps),videoTrack=videoStream.getVideoTracks()[0];
    const background=document.createElement('canvas'),foreground=document.createElement('canvas');
    for(const layer of [background,foreground]){layer.width=profile.width;layer.height=profile.height;}
    const destination=audio.createMediaStreamDestination(),compressor=audio.createDynamicsCompressor();destination.channelCount=1;compressor.threshold.value=-18;compressor.ratio.value=4;compressor.connect(destination);
    const output=new MediaStream([videoTrack,...destination.stream.getAudioTracks()]);
    const recorder=new MediaRecorder(output,{mimeType:mime,videoBitsPerSecond:profile.bitrate,audioBitsPerSecond:128000});
    session={meta,profile,currentProfile:{...profile},dynamicResolution:mime.includes("webm"),background,foreground,manualCapture,targetFPS:profile.fps,canvas,context:null,audio,compressor,destination,videoTrack,videoStream,output,recorder,writer,audioSources:new Map(),startedClock:performance.now(),sequence:0,queue:Promise.resolve(),tail:[],stopping:false,fileFailed:false};
    meta.qualityHistory=[{atMs:0,width:profile.width,height:profile.height,fps:profile.fps}];
    session.finished=new Promise(resolve=>session.finish=resolve);
    recorder.ondataavailable=event=>{if(event.data.size)void persistRecordingChunk(session,event.data);};
    recorder.onerror=()=>{session.problem='The browser interrupted recording. Recover the saved footage below.';void stopWeddingRecording();};
    recorder.onstop=()=>{void finishWeddingRecording(session);};
    await initializeRecordingRenderer(session);
    syncRecordingAudio(session);refreshRecordingScene(session);drawWeddingRecording(session);
    if(!active||epoch!==generation)throw new DOMException('Call ended','AbortError');
    weddingRecording=session;recorder.start(10000);
    startRecordingPainter(session);
    session.syncTimer=setInterval(()=>{try{syncRecordingAudio(session);refreshRecordingScene(session);syncRecordingVideoTracks(session);adaptRecordingQuality();}catch{}recordingControls();},1000);
    broadcast({type:'recording',...recordingState()});
    for(const input of recordingSources())input.video?.play().catch(()=>{});
    notify('Recording everyone — '+extension.toUpperCase()+' · Auto quality',{detail:writer?'Saving to your selected file, with a browser backup.':'Saving in this browser. Stop recording to download your video.',kind:'info',duration:6500});
  }catch(error){
    if(session){releaseRecordingRenderer(session);session.videoStream.getTracks().forEach(t=>t.stop());session.destination.stream.getTracks().forEach(t=>t.stop());}
    await writer?.abort().catch(()=>{});await audio?.close().catch(()=>{});
    if(error.name!=='AbortError')notify('Recording could not start',{detail:'Check available storage and use desktop Chrome or Edge. '+error.message,kind:'error',duration:7000});
    else notify('Recording was not started',{kind:'info'});
    if(weddingRecording===session)weddingRecording=null;
  }finally{recordingPreparing=false;recordingControls();}
}
async function stopWeddingRecording() {
  const session=weddingRecording;if(!session)return;
  if(!session.stopping){session.stopping=true;cancelAnimationFrame(session.paintRAF);broadcast({type:'recording',active:false,by:ownName});recordingControls();if(session.recorder.state!=='inactive')session.recorder.stop();}
  return session.finished;
}
async function finishWeddingRecording(session) {
  if(session.finalizing)return;session.finalizing=true;
  cancelAnimationFrame(session.paintRAF);clearInterval(session.syncTimer);releaseRecordingRenderer(session);
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
      info.textContent=recordingDuration(meta.durationMs)+' · '+(meta.mime?.includes('mp4')?'MP4':'WebM')+(meta.qualityHistory?.length?' · Auto '+[...new Set(meta.qualityHistory.map(p=>p.height+'p'))].join(' → '):meta.recordingWidth?' · '+meta.recordingWidth+'×'+meta.recordingHeight:'')+' · '+(meta.bytes/1048576).toFixed(1)+' MB · '+(inProgress?'Recording now':meta.savedToFile?'Saved to selected file':incomplete?'Interrupted — recover saved footage':'Saved in this browser');
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
$('recording-format').addEventListener('change',()=>{recordingFormatControls();notify('Recording format updated',{detail:$('recording-format').value.toUpperCase()+' · applies to your next recording'});});
$('open-recordings').addEventListener('click',showRecordingLibrary);
$('close-recordings').addEventListener('click',()=>$('recordings-dialog').close());
$('recordings-dialog').addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
window.addEventListener('beforeunload',event=>{if(weddingRecording||recordingPreparing){event.preventDefault();event.returnValue='';}});
void refreshRecordingLibrary();
