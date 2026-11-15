'use strict';
// Camera frames and QR images stay on this device. The reader loads only on demand.
const qrScanner={generation:0,stream:null,timer:null,cameras:[],facing:'environment',torch:false,canvas:document.createElement('canvas')};
let qrReaderPromise=null;
function scannerMessage(text,error=false) {
  const message=$('scan-status');if(message.textContent!==text)message.textContent=text;message.classList.toggle('error',error);
}
function loadQRReader() {
  if(typeof window.jsQR==='function')return Promise.resolve(window.jsQR);
  if(qrReaderPromise)return qrReaderPromise;
  qrReaderPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='jsqr.js?v=20261115-scan';
    const fail=()=>{clearTimeout(timeout);script.remove();qrReaderPromise=null;reject(new Error('READER_UNAVAILABLE'));};
    const timeout=setTimeout(fail,10000);script.onerror=fail;
    script.onload=()=>{clearTimeout(timeout);if(typeof window.jsQR==='function')resolve(window.jsQR);else fail();};document.head.append(script);
  });return qrReaderPromise;
}
function stopQRScanner() {
  ++qrScanner.generation;clearTimeout(qrScanner.timer);qrScanner.timer=null;
  for(const track of qrScanner.stream?.getTracks()||[]){track.onended=null;track.stop();}
  qrScanner.stream=null;qrScanner.torch=false;$('scan-video').pause();$('scan-video').srcObject=null;
  $('scan-camera').disabled=true;$('scan-flip').disabled=true;$('scan-light').hidden=true;
  $('scan-pause').textContent='Resume camera';$('scan-pause').disabled=false;
}
function scannerCameraError(error) {
  if(error.message==='READER_UNAVAILABLE')return 'The QR reader could not load. Refresh the website or enter the room code instead.';
  if(error.name==='NotAllowedError'||error.name==='SecurityError')return 'Camera access was blocked. Allow camera access in your browser, retry, or upload a QR image.';
  if(error.name==='NotFoundError'||error.name==='OverconstrainedError')return 'No suitable camera was found. Try another camera or upload a QR image.';
  if(error.name==='NotReadableError')return 'The camera is in use. Close other camera apps, retry, or upload a QR image.';
  return 'The camera could not start. Retry or upload a QR image instead.';
}
async function refreshScannerCameras(generation) {
  try{
    const cameras=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId);
    if(generation!==qrScanner.generation||!qrScanner.stream)return;
    qrScanner.cameras=cameras;const selected=qrScanner.stream.getVideoTracks()[0]?.getSettings().deviceId;
    $('scan-camera').replaceChildren();for(const [i,camera] of cameras.entries())$('scan-camera').add(new Option(camera.label||'Camera '+(i+1),camera.deviceId));
    if(selected&&!cameras.some(c=>c.deviceId===selected))$('scan-camera').add(new Option('Current camera',selected));
    if(selected)$('scan-camera').value=selected;$('scan-camera').disabled=!$('scan-camera').options.length;$('scan-flip').disabled=cameras.length===1;
  }catch{/* Camera selection is optional; scanning remains available. */}
}
function finishQRJoin(code) {
  stopQRScanner();$('scan-dialog').close();$('join-room-code').value=formatRoomCode(code);applyRoomCode();
  notify('Wedding invitation scanned',{detail:'Review your name and devices, then select Join our wedding call.'});
}
function scanCameraFrame(generation) {
  if(generation!==qrScanner.generation||!$('scan-dialog').open||!qrScanner.stream)return;
  const video=$('scan-video'),canvas=qrScanner.canvas;
  try{
    if(video.readyState>=2&&video.videoWidth){
      const scale=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight)),w=Math.max(1,Math.round(video.videoWidth*scale)),h=Math.max(1,Math.round(video.videoHeight*scale));
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,0,0,w,h);
      const result=window.jsQR(ctx.getImageData(0,0,w,h).data,w,h,{inversionAttempts:'attemptBoth'});
      if(result){const code=roomCodeFromInvite(result.data);if(code){finishQRJoin(code);return;}scannerMessage('That QR is not an invitation from this wedding website. Scan the host’s invitation.',true);}
    }
  }catch{stopQRScanner();scannerMessage('The camera image could not be read. Resume the camera or upload a QR image.',true);return;}
  qrScanner.timer=setTimeout(()=>scanCameraFrame(generation),250);
}
async function startQRScanner({deviceId='',facing=qrScanner.facing}={}) {
  if(active||busy||!$('scan-dialog').open)return;
  stopQRScanner();const generation=qrScanner.generation;$('scan-pause').disabled=true;$('scan-retry').hidden=true;
  scannerMessage('Opening your camera…');
  try{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new DOMException('Camera requires HTTPS','SecurityError');
    const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:12,max:15},...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:facing}})}});
    if(generation!==qrScanner.generation||!$('scan-dialog').open||active||busy){media.getTracks().forEach(t=>t.stop());return;}
    qrScanner.stream=media;const track=media.getVideoTracks()[0];qrScanner.facing=track.getSettings().facingMode||facing;
    track.onended=()=>{if(generation===qrScanner.generation){stopQRScanner();scannerMessage('The camera stopped. Resume it or upload a QR image.');}};
    $('scan-video').srcObject=media;await $('scan-video').play();
    if(generation!==qrScanner.generation)return;
    $('scan-pause').disabled=false;$('scan-pause').textContent='Pause camera';$('scan-flip').disabled=false;
    try{$('scan-light').hidden=!track.getCapabilities?.().torch;}catch{}
    $('scan-light').textContent='Turn light on';$('scan-light').setAttribute('aria-pressed','false');
    void refreshScannerCameras(generation);scannerMessage('Loading the QR reader…');await loadQRReader();
    if(generation!==qrScanner.generation)return;
    scannerMessage('Point your camera at the host’s QR code. Keep it steady and well lit.');scanCameraFrame(generation);
  }catch(error){if(generation!==qrScanner.generation)return;stopQRScanner();$('scan-retry').hidden=false;scannerMessage(scannerCameraError(error),true);}
}
function openQRScanner({camera=true}={}) {
  if(active||busy)return;
  stopMedia();const dialog=$('scan-dialog');if(!dialog.open)dialog.showModal();
  $('close-scan').focus();if(camera)void startQRScanner();else scannerMessage('Choose an image containing the host’s invitation QR code.');
}
function chooseQRImage() {
  if(active||busy)return;openQRScanner({camera:false});stopQRScanner();$('scan-image').value='';$('scan-image').click();
}
async function readQRImage(file) {
  if(!file)return;stopQRScanner();const generation=qrScanner.generation;
  scannerMessage('Reading the QR image…');
  if(file.size>20*1024*1024){scannerMessage('Choose an image smaller than 20 MB.',true);return;}
  let image,url;
  try{
    await loadQRReader();if(generation!==qrScanner.generation||!$('scan-dialog').open)return;
    if(typeof createImageBitmap==='function')image=await createImageBitmap(file);
    else {url=URL.createObjectURL(file);image=new Image();image.src=url;await image.decode();}
    if(generation!==qrScanner.generation||!$('scan-dialog').open)return;
    const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height,scale=Math.min(1,1920/Math.max(width,height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const result=window.jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});
    if(!result){scannerMessage('No QR code was found. Try a clearer image or resume the camera.',true);return;}
    const code=roomCodeFromInvite(result.data);
    if(!code){scannerMessage('This image does not contain an invitation from this wedding website.',true);return;}
    finishQRJoin(code);
  }catch(error){if(generation===qrScanner.generation)scannerMessage(error.message==='READER_UNAVAILABLE'?scannerCameraError(error):'This image could not be read. Choose a PNG, JPEG, or WebP QR image.',true);}
  finally{image?.close?.();if(url)URL.revokeObjectURL(url);}
}
$('scan-to-join').addEventListener('click',()=>openQRScanner());
$('upload-to-join').addEventListener('click',chooseQRImage);
$('scan-upload').addEventListener('click',chooseQRImage);
$('scan-image').addEventListener('change',()=>{void readQRImage($('scan-image').files[0]);});
$('scan-image').addEventListener('cancel',()=>scannerMessage('No image selected. Resume the camera or choose another image.'));
$('scan-camera').addEventListener('change',()=>{void startQRScanner({deviceId:$('scan-camera').value});});
$('scan-flip').addEventListener('click',()=>{
  const current=qrScanner.stream?.getVideoTracks()[0]?.getSettings().deviceId||$('scan-camera').value,cameras=qrScanner.cameras;
  if(cameras.length>1){const index=cameras.findIndex(c=>c.deviceId===current);void startQRScanner({deviceId:cameras[(index+1)%cameras.length].deviceId});}
  else void startQRScanner({facing:qrScanner.facing==='environment'?'user':'environment'});
});
$('scan-pause').addEventListener('click',()=>{if(qrScanner.stream){stopQRScanner();scannerMessage('Camera paused. Resume when ready, or upload a QR image.');}else void startQRScanner();});
$('scan-retry').addEventListener('click',()=>{void startQRScanner();});
$('scan-light').addEventListener('click',async()=>{
  const generation=qrScanner.generation,track=qrScanner.stream?.getVideoTracks()[0];if(!track)return;const next=!qrScanner.torch;
  try{await track.applyConstraints({advanced:[{torch:next}]});if(generation!==qrScanner.generation)return;qrScanner.torch=next;$('scan-light').textContent=next?'Turn light off':'Turn light on';$('scan-light').setAttribute('aria-pressed',String(next));}
  catch{if(generation===qrScanner.generation)scannerMessage('The camera light is unavailable. Try a brighter place.');}
});
$('close-scan').addEventListener('click',()=>$('scan-dialog').close());
$('scan-dialog').addEventListener('close',stopQRScanner);
$('scan-dialog').addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&$('scan-dialog').open&&qrScanner.stream){stopQRScanner();scannerMessage('Camera paused while the page is hidden. Resume when ready.');}});
window.addEventListener('pagehide',stopQRScanner);
