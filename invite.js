'use strict';
// QR generation stays on this device; invitation URLs are not sent to a QR service.
function drawInviteQR() {
  const canvas=$('invite-qr'),message=$('invite-qr-message');
  canvas.hidden=true;$('save-invite-qr').disabled=true;message.hidden=false;
  if(!/^https?:/.test(roomLink)){
    message.textContent='Open the hosted HTTPS website to invite another device. A local file link only works on this computer.';return;
  }
  try{
    const qr=qrcodegen.QrCode.encodeText(roomLink,qrcodegen.QrCode.Ecc.MEDIUM),border=4,scale=8;
    canvas.width=canvas.height=(qr.size+border*2)*scale;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#15171c';
    for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))ctx.fillRect((x+border)*scale,(y+border)*scale,scale,scale);
    canvas.hidden=false;message.hidden=true;$('save-invite-qr').disabled=false;
  }catch{message.textContent='QR code unavailable. Use the room code or invitation link below.';}
}
function showInviteDialog() {
  if(!active||!roomLink)return;
  toggleCameraMenu(false);clearTimeout(chromeTimer);
  const dialog=$('invite-dialog'),target=$('call-stage').classList.contains('full-view')?$('call-stage'):document.body;
  if(dialog.parentElement!==target){if(dialog.open)dialog.close();target.append(dialog);}
  $('invite-link').value=roomLink;$('invite-room-code').textContent=formatRoomCode(token);
  const website=new URL(roomLink);website.hash='';$('invite-site-address').textContent=website.href.replace(/^https?:\/\//,'');
  $('invite-feedback').textContent='';$('share-invite').hidden=typeof navigator.share!=='function';
  drawInviteQR();if(!dialog.open)dialog.showModal();$('close-invite').focus();
}
async function copyInviteValue(value,input,success) {
  try{await navigator.clipboard.writeText(value);$('invite-feedback').textContent=success;}
  catch{input.focus();input.select();$('invite-feedback').textContent='Automatic copying is unavailable. Select and copy the invitation link, or use the QR code and room code.';}
}
function applyRoomCode() {
  if(active||busy)return;
  const code=normaliseRoomCode($('join-room-code').value);
  if(!code){status('Enter the room code exactly as shown on the host’s invitation.',true);$('join-room-code').focus();return;}
  location.hash=code;lobby();status('Room code ready. Enter your name and join your family.');
  ($('display-name').value.trim()?$('join'):$('display-name')).focus();
}
$('use-room-code').addEventListener('click',applyRoomCode);
$('join-room-code').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();applyRoomCode();}});
$('clear-room-code').addEventListener('click',()=>{if(active||busy)return;history.replaceState(null,'',location.pathname+location.search);lobby();status('Ready to start a new wedding room.');});
$('close-invite').addEventListener('click',()=>$('invite-dialog').close());
$('invite-dialog').addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
$('invite-dialog').addEventListener('close',()=>{if(active)revealCallChrome();});
$('copy-invite-link').addEventListener('click',()=>{void copyInviteValue(roomLink,$('invite-link'),'Invitation link copied.');});
$('copy-room-code').addEventListener('click',()=>{void copyInviteValue(formatRoomCode(token),$('invite-link'),'Room code copied. Open the same website on the other device and enter this code.');});
$('share-invite').addEventListener('click',async()=>{
  try{await navigator.share({title:'Our wedding · Phyo Arkar Soe & Myat Thu Thu Ko',text:'Join our wedding call',url:roomLink});$('invite-feedback').textContent='Invitation shared.';}
  catch(error){if(error.name!=='AbortError')$('invite-feedback').textContent='Sharing is unavailable here. Scan the QR code or copy the link instead.';}
});
$('save-invite-qr').addEventListener('click',()=>{
  if($('invite-qr').hidden)return;
  const link=document.createElement('a');link.href=$('invite-qr').toDataURL('image/png');link.download='Our-Wedding-Invite-'+token+'.png';link.click();
  $('invite-feedback').textContent='QR image download started. This invitation works while the host keeps the room open.';
});
