'use strict';
// Public signaling + STUN. No paid service or TURN relay is configured.
const $ = id => document.getElementById(id);
const guests = new Map(), calls = new Map(), tiles = new Map();
const MAX_PARTICIPANTS = 8;
let layoutMode = "gallery", openPanel = null, unreadMessages = 0;
let qualityQueue = Promise.resolve(), lastQualityProfile = "";
let stream, peer, hostConnection, token, ownName, selfId, hostId, roomLink;
let active = false, busy = false, isHost = false, epoch = 0, roster = [], ticker, repair;
let selectedVideo = null;
let noticeTimer = null, inviteLabelTimer = null;
function placeNotifications() {
  const region = $('notification-region');
  const target = $('call-stage').classList.contains('full-view') ? $('call-stage') : document.body;
  if (region.parentElement !== target) target.append(region);
}
function notify(text, {kind = 'success', detail = '', manualLink = '', duration = 3600} = {}) {
  clearTimeout(noticeTimer); placeNotifications();
  const region = $('notification-region'), card = document.createElement('div'), icon = document.createElement('span'), body = document.createElement('div'), title = document.createElement('strong');
  card.className = 'notification-card'; card.dataset.kind = kind;
  icon.className = 'notification-icon'; icon.textContent = kind === 'error' ? '!' : kind === 'info' ? 'i' : '✓'; icon.setAttribute('aria-hidden','true');
  body.className = 'notification-body'; title.textContent = text; body.append(title);
  if (detail) {const p = document.createElement('p'); p.textContent = detail; body.append(p);}
  if (manualLink) {
    const input = document.createElement('input'); input.id = 'manual-invitation'; input.readOnly = true; input.value = manualLink; input.setAttribute('aria-label','Invitation link to copy manually'); body.append(input);
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'notification-dismiss'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label','Dismiss notification'); dismiss.addEventListener('click',()=>{region.hidden=true;}); card.append(dismiss);
  }
  card.prepend(icon, body); region.replaceChildren(card); region.hidden = false;
  if (duration > 0) noticeTimer = setTimeout(()=>{region.hidden=true;},duration);
  if (manualLink) {const input = $('manual-invitation'); input.focus({preventScroll:true}); input.select();}
}
let chromeTimer = null;
let chromePointerInside = false, suppressRevealClickUntil = 0;
function setCallChrome(visible) {
  const stage = $('call-stage');
  const hide = stage.classList.contains('full-view') && !visible;
  stage.classList.toggle('chrome-hidden', hide);
  stage.querySelectorAll('.stage-actions, .controls, .tile-select').forEach(el => {el.inert = hide;});
  if (hide && stage.querySelector('.stage-actions, .controls') &&
      document.activeElement?.closest('.stage-actions, .controls, .tile-select')) stage.focus({preventScroll:true});
}
function scheduleChromeHide() {
  clearTimeout(chromeTimer);
  if ($('call-stage').classList.contains('full-view') && $('camera-menu').hidden && !openPanel && !chromePointerInside) {
    chromeTimer = setTimeout(() => setCallChrome(false), 3000);
  }
}
function revealCallChrome() {setCallChrome(true); scheduleChromeHide();}
function pointerAtControls(event) {
  return [...$('call-stage').querySelectorAll('.stage-actions, .controls')].some(el => {
    const r = el.getBoundingClientRect(), padding = 12;
    return event.clientX >= r.left-padding && event.clientX <= r.right+padding &&
      event.clientY >= r.top-padding && event.clientY <= r.bottom+padding;
  });
}
function toggleCameraMenu(open, returnFocus = false) {
  $('camera-menu').hidden = !open;
  $('more-options').setAttribute('aria-expanded', String(open));
  revealCallChrome();
  if (open) {$('close-camera-menu').focus(); void refreshCallCameras();}
  else if (returnFocus) $('more-options').focus();
}
let cameraSwitch = null;
function cameraFeedback(text) { $('camera-feedback').textContent = text; if (/^Camera changed/.test(text)) notify(text); else if (/^Could not|^Camera permission denied|^Camera list unavailable/.test(text)) notify(text,{kind:'error',duration:6500}); }
function cameraControls() {
  const video = stream?.getVideoTracks()[0];
  $('call-camera').disabled = !active || !video || !!cameraSwitch;
  $('flip-camera').disabled = $('call-camera').disabled || $('call-camera').options.length < 2;
  $('toggle-video').disabled = !video || !!cameraSwitch;
}
function mirrorCamera() {
  const track = stream?.getVideoTracks()[0];
  const rear = track?.getSettings().facingMode === 'environment' || /back|rear|environment/i.test(track?.label || '');
  $('local-video').style.transform = rear ? 'none' : 'scaleX(-1)';
  $('preview').style.transform = rear ? 'none' : 'scaleX(-1)';
}
async function refreshCallCameras() {
  const generation = epoch;
  try {
    const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && d.deviceId);
    if (!active || epoch !== generation) return;
    const current = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    $('call-camera').replaceChildren();
    for (const [i, device] of list.entries()) $('call-camera').add(new Option(device.label || `Camera ${i + 1}`, device.deviceId));
    if (current && !list.some(d => d.deviceId === current)) $('call-camera').add(new Option('Current camera', current));
    if (!$('call-camera').options.length) $('call-camera').add(new Option('Current camera', ''));
    if (current) $('call-camera').value = current;
  } catch { if (active && epoch === generation) cameraFeedback('Camera list unavailable. Check camera permissions.'); }
  cameraControls();
}
async function changeCamera(deviceId) {
  const old = stream?.getVideoTracks()[0];
  if (!active || !old || cameraSwitch || !deviceId) return;
  if (old.getSettings().deviceId === deviceId && old.readyState === 'live') return;
  const generation = epoch, currentStream = stream, operation = {};
  cameraSwitch = operation; cameraControls(); cameraFeedback('Switching camera…');
  let acquired, next;
  const targets = [];
  try {
    const h = videoProfile().height;
    acquired = await navigator.mediaDevices.getUserMedia({audio:false, video:{deviceId:{exact:deviceId}, width:{ideal:Math.round(h*16/9)}, height:{ideal:h}, frameRate:{ideal:24,max:30}}});
    next = acquired.getVideoTracks()[0];
    if (!next) throw new Error('NO_CAMERA');
    if (!active || epoch !== generation) return;
    next.enabled = old.enabled;
    for (const [id, call] of calls) {
      const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) targets.push({id, call, sender});
    }
    const results = await Promise.allSettled(targets.map(t => t.sender.replaceTrack(next)));
    if (!active || epoch !== generation) return;
    if (results.some(r => r.status === 'rejected')) {
      const restored = await Promise.allSettled(targets.map(t => t.sender.replaceTrack(old)));
      if (!active || epoch !== generation) return;
      restored.forEach((r,i) => {if (r.status === 'rejected' && calls.get(targets[i].id) === targets[i].call) closeCall(targets[i].id);});
      throw new Error('REPLACE_FAILED');
    }
    currentStream.removeTrack(old); currentStream.addTrack(next);
    $('local-video').srcObject = currentStream; $('preview').srcObject = currentStream;
    old.stop(); acquired = null;
    mirrorCamera();
    $('local-video').play().catch(() => {});
    if ([...$('camera').options].some(o => o.value === deviceId)) $('camera').value = deviceId;
    cameraFeedback(next.enabled ? 'Camera changed.' : 'Camera changed. Your camera is still off.');
  } catch (error) {
    if (active && epoch === generation) cameraFeedback(error.name === 'NotAllowedError'
      ? 'Camera permission denied. Your previous camera is unchanged.'
      : 'Could not switch cameras. Your previous camera is kept; try another camera or close other camera apps.');
  } finally {
    acquired?.getTracks().forEach(t => t.stop());
    if (cameraSwitch === operation) {
      cameraSwitch = null;
      if (active && epoch === generation) { await refreshCallCameras(); reconcile(); scheduleQuality(true); }
      cameraControls();
    }
  }
}
function videoEntries() { return [['local', $('local-tile')], ...tiles.entries()]; }
function arrangeVideos() {
  const entries = videoEntries();
  const grid = $("videos");
  $('call-stage').style.setProperty('--controls-clearance', Math.max(0, $('call-stage').getBoundingClientRect().bottom - $('call-stage').querySelector('.controls').getBoundingClientRect().top + 14) + 'px');
  $('call-stage').style.setProperty('--header-height', $('call-stage').querySelector('.stage-toolbar').getBoundingClientRect().height + 'px');
  $('call-stage').style.setProperty('--title-clearance', Math.max(0, $('call-stage').querySelector('.stage-title').getBoundingClientRect().bottom - $('call-stage').getBoundingClientRect().top + 10) + 'px');
  grid.classList.toggle("gallery-view", layoutMode === "gallery");
  grid.classList.toggle("focus-view", layoutMode === "focus");
  const columns = entries.length === 1 ? 1 : grid.clientWidth < 650 ? 2 : entries.length > 4 ? 3 : 2;
  grid.style.setProperty("--gallery-columns", columns);
  grid.style.setProperty("--gallery-rows", Math.ceil(entries.length / columns));
  buttonLabel("view-mode", layoutMode === "gallery" ? "Focus view" : "Gallery view");
  $("swap-video").hidden = layoutMode === "gallery";
  if (!entries.some(([id]) => id === selectedVideo)) selectedVideo = tiles.keys().next().value || 'local';
  // On first arrival, show the family large unless the user has chosen a view.
  const main = selectedVideo || 'local';
  let overlay = 0;
  for (const [id, tile] of entries) {
    const primary = id === main;
    tile.classList.toggle('main-video', layoutMode === 'focus' && primary);
    tile.classList.toggle('overlay-video', layoutMode === 'focus' && !primary);
    tile.style.setProperty('--overlay-index', primary ? 0 : overlay++);
    const button = tile.querySelector('.tile-select');
    if (button) { button.hidden = layoutMode === 'focus' && primary; button.tabIndex = button.hidden ? -1 : 0; }
  }
  $('swap-video').disabled = entries.length < 2;
}
function selectVideo(id) { selectedVideo = id; layoutMode = 'focus'; $('videos').scrollLeft = 0; arrangeVideos(); }
function fullScreenElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
function syncFullscreen() {
  const stage = $('call-stage'), wasOn = stage.classList.contains('full-view');
  const on = fullScreenElement() === stage || stage.classList.contains('expanded');
  buttonLabel('fullscreen', on ? 'Exit full screen' : 'Full screen');
  $('fullscreen').setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('stage-expanded', on);
  stage.classList.toggle('full-view', on); placeNotifications();
  arrangeVideos();
  if (on && !wasOn) {
    // Fullscreen starts clear, including when a settings panel was previously open.
    setPanel(null); toggleCameraMenu(false); chromePointerInside = false;
    clearTimeout(chromeTimer); setCallChrome(false);
  } else if (!on) {chromePointerInside = false; revealCallChrome();}
}
async function exitStage() {
  $('call-stage').classList.remove('expanded');
  try {
    if (fullScreenElement() === $('call-stage')) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  } catch { /* The browser may already have exited fullscreen. */ }
  syncFullscreen();
}
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); if (error) notify(text, {kind:'error',duration:6500}); };
const cleanName = value => typeof value === 'string' ? value.trim().slice(0, 40) || 'Family' : 'Family';
function invitation() { const v = new URLSearchParams(location.hash.slice(1)).get('room'); return /^[a-f0-9]{48}$/.test(v || '') ? v : ''; }
function lobby() {
  $('join').textContent = invitation() ? 'Join our wedding call ↗' : 'Start our wedding call ↗';
  $('join-hint').textContent = invitation() ? 'Your family has saved you a seat. Join when you’re ready.' : 'Start a room, then send the invitation link to your families.';
}
function stopMedia() {
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  $('preview').srcObject = null; $('local-video').srcObject = null; $('preview-placeholder').hidden = false;
}
async function devices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  for (const [id, kind] of [['camera', 'videoinput'], ['microphone', 'audioinput']]) {
    const previous = $(id).value;
    $(id).replaceChildren(new Option(`Default ${id}`, ''));
    all.filter(d => d.kind === kind).forEach((d, i) => $(id).add(new Option(d.label || `${id} ${i + 1}`, d.deviceId)));
    if ([...$(id).options].some(o => o.value === previous)) $(id).value = previous;
  }
}
async function capture() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Host this page on HTTPS to enable the camera and microphone.');
  stopMedia();
  const h = videoProfile().height;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, ...($('microphone').value ? {deviceId: {exact: $('microphone').value}} : {}) },
    video: $('mode').value === 'audio' ? false : {width: {ideal: Math.round(h * 16 / 9)}, height: {ideal: h}, frameRate: {ideal: 24, max: 30}, ...($('camera').value ? {deviceId: {exact: $('camera').value}} : {facingMode: 'user'})}
  });
  $('preview').srcObject = stream; $('preview-placeholder').hidden = stream.getVideoTracks().length > 0;
  await $('preview').play().catch(() => {}); await devices().catch(() => {});
}
function mediaError(e) {
  if (e.name === 'NotAllowedError') return 'Allow camera and microphone access in your browser settings, then try again.';
  if (e.name === 'NotFoundError') return 'Camera or microphone not found. Connect a device, or choose Voice only if you have no camera.';
  if (e.name === 'NotReadableError') return 'Your camera or microphone is busy. Close other apps using it and retry.';
  return e.message === 'Host this page on HTTPS to enable the camera and microphone.' ? e.message : 'Could not start the call. Check your devices, browser permissions, and internet connection.';
}
function send(c, data) { if (!c?.open) return false; try {c.send(data); return true;} catch {return false;} }
function broadcast(data) { for (const g of guests.values()) send(g.connection, data); }
function message(author, body, system = false) {
  const row = document.createElement('div'); row.className = 'message' + (system ? ' system' : '');
  if (!system) {const b = document.createElement('strong'); b.textContent = author; row.append(b);}
  const p = document.createElement('p'); p.textContent = body; row.append(p); $('messages').append(row);
  while ($('messages').children.length > 200) $('messages').firstElementChild.remove();
  $('messages').scrollTop = $('messages').scrollHeight;
  if (!system && openPanel !== 'chat' && author !== ownName) {unreadMessages++;$('chat-badge').textContent=unreadMessages;$('chat-badge').hidden=false;}
}
function closeCall(id) { const c = calls.get(id); calls.delete(id); c?.close(); const v = tiles.get(id)?.querySelector('video'); if (v) v.srcObject = null; }
function render() {
  for (const [id, tile] of tiles) if (!roster.some(m => m.id === id)) {closeCall(id); tile.remove(); tiles.delete(id);}
  for (const m of roster) {
    if (m.id === selfId) continue;
    if (!tiles.has(m.id)) {
      const tile = document.createElement('article'); tile.className = 'video-tile';
      const back = document.createElement('div'); back.className = 'tile-backdrop'; back.textContent = m.name.split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase();
      const video = document.createElement('video'); video.autoplay = true; video.playsInline = true;
      const label = document.createElement('div'); label.className = 'tile-label';
      const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'tile-select';
      choose.setAttribute('aria-label', `Show ${m.name} in the main view`);
      const hint = document.createElement('span'); hint.textContent = 'Focus'; choose.append(hint);
      choose.addEventListener('click', () => selectVideo(m.id));
      if (!tiles.size && selectedVideo === 'local') selectedVideo = null;
      tile.append(back, video, label, choose); tiles.set(m.id, tile); $('videos').append(tile);
    }
    const tile = tiles.get(m.id);
    tile.querySelector('.tile-label').textContent = m.name + (tile.querySelector('video').srcObject ? ' · Connected' : ' · Connecting…');
  }
  $('people-count').textContent = `${roster.length} / ${MAX_PARTICIPANTS} devices`; $('waiting').hidden = roster.length > 1;
  arrangeVideos(); renderParticipants(); scheduleQuality();
}
function reconcile() {
  if (!active || cameraSwitch || !peer || peer.destroyed || peer.disconnected) return;
  for (const m of roster) if (selfId < m.id && !calls.has(m.id)) {
    try {const c = peer.call(m.id, stream, {metadata: {room: token}}); if (c) attach(c);} catch {status('Retrying a family connection…');}
  }
}
function attach(c) {
  if (calls.has(c.peer)) {c.close(); return;}
  calls.set(c.peer, c); const generation = epoch;
  const deadline = setTimeout(() => {
    if (generation === epoch && calls.get(c.peer) === c && !tiles.get(c.peer)?.querySelector('video').srcObject) {
      closeCall(c.peer); status('A family device could not connect. This free setup has no TURN relay; try a different permitted network.', true);
    }
  }, 25000);
  c.on('stream', remote => {
    if (generation !== epoch || calls.get(c.peer) !== c) return;
    clearTimeout(deadline); render(); const v = tiles.get(c.peer)?.querySelector('video'); if (!v) return;
    v.srcObject = remote; void tuneSender(c, videoProfile()); v.play().catch(() => {$('play-audio').hidden = false;}); render(); status('Together at last. Your wedding call is connected.');
  });
  const ended = () => {
    clearTimeout(deadline); if (calls.get(c.peer) !== c) return;
    calls.delete(c.peer); const v = tiles.get(c.peer)?.querySelector('video'); if (v) v.srcObject = null; render();
  };
  c.on('close', ended); c.on('error', () => {ended(); c.close();});
  c.peerConnection?.addEventListener('connectionstatechange', () => {
    if (generation !== epoch) return;
    if (c.peerConnection.connectionState === 'failed') {ended(); c.close();}
    if (c.peerConnection.connectionState === 'disconnected') status('A connection is interrupted. Waiting for it to recover…');
  });
}
function publishRoster() {
  roster = [{id: selfId, name: ownName}, ...[...guests].map(([id, g]) => ({id, name: g.name}))];
  broadcast({type: 'roster', members: roster}); render(); reconcile();
}
function enter() {
  document.body.classList.add('in-call'); selectedVideo = null; layoutMode = 'gallery'; lastQualityProfile = ''; unreadMessages = 0; setPanel(null); $('call-quality').value = $('quality').value;
  active = true; busy = false; $('lobby').hidden = true; $('call-room').hidden = false; $('join').disabled = false;
  $('local-video').srcObject = stream; $('local-video').play().catch(() => {});
  $('local-label').textContent = `${ownName} · You${isHost ? ' · Host' : ''}`;
  buttonLabel('toggle-mic', 'Mute microphone'); $('toggle-mic').setAttribute('aria-pressed', 'false');
  buttonLabel('toggle-video', stream.getVideoTracks().length ? 'Turn camera off' : 'Voice only');
  $('toggle-video').disabled = !stream.getVideoTracks().length; $('toggle-video').setAttribute('aria-pressed', 'false');
  mirrorCamera(); cameraFeedback(stream.getVideoTracks().length ? '' : 'Voice-only call. Rejoin with video to enable a camera.');
  cameraControls(); void refreshCallCameras();
  $('invitation').value = roomLink; $('messages').replaceChildren(); message('', 'Welcome to our wedding. Chat is not saved after you leave.', true);
  const start = Date.now(); $('elapsed').textContent = '00:00:00';
  ticker = setInterval(() => {const s = Math.floor((Date.now() - start) / 1000); $('elapsed').textContent = [Math.floor(s/3600), Math.floor(s/60)%60, s%60].map(n => String(n).padStart(2,'0')).join(':');}, 1000);
  repair = setInterval(reconcile, 8000);
  status(isHost ? 'Your room is open. Copy the invitation link for your families.' : 'You’ve joined the family. Connecting video and voice…');
}
function acceptGuest(c) {
  if (!isHost || !active) {c.close(); return;}
  const generation = epoch; let admitted = false;
  const deadline = setTimeout(() => {if (!admitted) c.close();}, 15000);
  c.on('data', data => {
    if (generation !== epoch || !data || typeof data !== 'object') return;
    if (!admitted) {
      if (data.type !== 'hello' || data.token !== token) {c.close(); return;}
      if (guests.size >= MAX_PARTICIPANTS - 1 || guests.has(c.peer)) {send(c, {type: 'rejected'}); setTimeout(() => c.close(), 500); return;}
      admitted = true; clearTimeout(deadline); guests.set(c.peer, {connection: c, name: cleanName(data.name)});
      message('', `${cleanName(data.name)} joined the family.`, true); publishRoster(); return;
    }
    if (data.type === 'chat' && typeof data.text === 'string') {
      const text = data.text.trim().slice(0,1000); if (!text) return;
      const author = guests.get(c.peer)?.name; if (!author) return;
      message(author, text); broadcast({type: 'chat', author, text});
    }
  });
  c.on('close', () => {
    clearTimeout(deadline); if (generation !== epoch || guests.get(c.peer)?.connection !== c) return;
    message('', `${guests.get(c.peer).name} left the call.`, true); guests.delete(c.peer); closeCall(c.peer); publishRoster();
  });
  c.on('error', () => c.close());
}
function joinHost(generation) {
  const c = hostConnection = peer.connect(hostId, {reliable: true, serialization: 'json'});
  const deadline = setTimeout(() => {if (epoch === generation && !active) end('Could not reach the host. Ask them to keep the room open and check both networks. A TURN relay may be needed.', true);}, 30000);
  c.on('open', () => send(c, {type: 'hello', token, name: ownName}));
  c.on('data', data => {
    if (generation !== epoch || !data || typeof data !== 'object') return;
    if (data.type === 'rejected') {clearTimeout(deadline); end('This room already has eight devices. Ask a family member to leave before joining.', true);}
    if (data.type === 'ended') {clearTimeout(deadline); end('The host ended the wedding room. Ask for a new invitation to reconnect.');}
    if (data.type === 'roster' && Array.isArray(data.members)) {
      if (data.members.length > MAX_PARTICIPANTS) return;
      const members = data.members;
      if (new Set(members.map(m=>m?.id)).size !== members.length) return;
      if (!members.every(m => m && typeof m.id === 'string' && typeof m.name === 'string')) return;
      if (!members.some(m => m.id === selfId) || !members.some(m => m.id === hostId)) return;
      clearTimeout(deadline); roster = members.map(m => ({id: m.id, name: cleanName(m.name)}));
      if (!active) enter(); render(); reconcile();
    }
    if (data.type === 'chat' && active && typeof data.text === 'string') message(cleanName(data.author), data.text.slice(0,1000));
  });
  const failed = () => {clearTimeout(deadline); if (generation === epoch) end('The host connection closed. If their room is still open, press Join to reconnect.', true);};
  c.on('close', failed); c.on('error', failed);
}
async function start() {
  if (busy || active) return;
  if (!$('display-name').value.trim()) {$('display-name').focus(); status('Please enter your name so your family knows who is joining.', true); return;}
  if (!window.Peer) {status('The calling library did not load. Check your connection and reload the page.', true); return;}
  ownName = cleanName($('display-name').value); busy = true; $('join').disabled = true; $('preview-button').disabled = true;
  const generation = ++epoch;
  try {
    status('Opening your microphone and selected camera…'); await capture();
    token = invitation(); isHost = !token;
    if (isHost) token = [...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2,'0')).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    hostId = 'nikah-' + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,'0')).join('');
    const url = new URL(location.href); url.hash = new URLSearchParams({room: token}).toString(); roomLink = url.href;
    const options = {config: {iceServers: [{urls:'stun:stun.l.google.com:19302'}]}, debug: 0};
    peer = isHost ? new Peer(hostId, options) : new Peer(options); status('Connecting to the wedding room…');
    const deadline = setTimeout(() => {if (generation === epoch && busy) end('The signaling service did not respond. Check your internet connection and retry.', true);},35000);
    peer.on('open', id => {if (epoch !== generation) return; clearTimeout(deadline); selfId = id; if (isHost) {if (!active) enter(); publishRoster();} else if (!active) joinHost(generation);});
    peer.on('connection', acceptGuest);
    peer.on('call', c => {
      const accept = () => {
        if (epoch === generation && active && cameraSwitch) {setTimeout(accept, 200); return;}
        if (epoch !== generation || !active || c.metadata?.room !== token || !roster.some(m => m.id === c.peer) || calls.has(c.peer)) {c.close(); return;}
        attach(c); c.answer(stream);
      };
      if (roster.some(m => m.id === c.peer)) accept(); else setTimeout(accept, 1200);
    });
    peer.on('disconnected', () => {
      if (epoch !== generation) return; status('Signaling disconnected. Existing calls may continue; reconnecting…');
      setTimeout(() => {if (epoch === generation && peer && !peer.destroyed && peer.disconnected) {try {peer.reconnect();} catch {status('Signaling is unavailable. Leave and rejoin if calls stop.',true);}}},2000);
    });
    peer.on('error', e => {
      if (epoch !== generation) return;
      if (!active) {clearTimeout(deadline); end(e.type === 'peer-unavailable' ? 'The host is not online. Ask them to open their room and send its invitation link.' : 'The calling service could not connect. Check your network and try again.',true);}
      else status('A family connection needs attention. Retrying media connections; leave and rejoin if it does not recover.',true);
    });
  } catch (e) {end(mediaError(e),true);} finally {$('preview-button').disabled = busy;}
}
function end(reason = 'You’ve left the call. Thank you for being part of our beginning.', error = false) {
  setPanel(null); toggleCameraMenu(false); clearTimeout(chromeTimer); chromePointerInside = false; suppressRevealClickUntil = 0;
  void exitStage(); document.body.classList.remove('in-call'); selectedVideo = null;
  if (isHost && active) broadcast({type:'ended'});
  ++epoch; active = false; busy = false; cameraSwitch = null; clearInterval(ticker); clearInterval(repair);
  const oldCalls = [...calls.values()]; calls.clear(); oldCalls.forEach(c => c.close());
  guests.clear(); roster = []; peer?.destroy(); peer = null; hostConnection = null; stopMedia();
  for (const tile of tiles.values()) tile.remove(); tiles.clear();
  $('call-room').hidden = true; $('lobby').hidden = false; $('join').disabled = false; $('preview-button').disabled = false;
  $('play-audio').hidden = true; $('messages').replaceChildren(); lobby(); status(reason,error);
}
$('join').addEventListener('click', start);
$('more-options').addEventListener('click', () => toggleCameraMenu($('camera-menu').hidden));
$('close-camera-menu').addEventListener('click', () => toggleCameraMenu(false, true));
$('call-stage').addEventListener('pointerdown', event => {
  if (event.target.closest('#notification-region')) {suppressRevealClickUntil = 0; return;}
  if (!$('call-stage').classList.contains('chrome-hidden')) suppressRevealClickUntil = 0;
  if (event.pointerType === 'touch') chromePointerInside = false;
  if ($('call-stage').classList.contains('chrome-hidden')) {
    event.preventDefault(); event.stopImmediatePropagation();
    suppressRevealClickUntil = performance.now() + 1200;
    revealCallChrome(); return;
  }
  if (!$('camera-menu').hidden && !event.target.closest('#camera-menu, #more-options')) toggleCameraMenu(false);
  revealCallChrome();
}, true);
$('call-stage').addEventListener('click', event => {
  // The first tap reveals the controls without focusing a tile or activating a button.
  if (event.detail && performance.now() < suppressRevealClickUntil) {
    event.preventDefault(); event.stopImmediatePropagation(); suppressRevealClickUntil = 0;
  }
}, true);
$('call-stage').addEventListener('pointermove', event => {
  if (event.pointerType === 'touch' || !$('call-stage').classList.contains('full-view')) return;
  const inside = pointerAtControls(event), previouslyInside = chromePointerInside;
  chromePointerInside = inside;
  if (inside) revealCallChrome();
  else if (previouslyInside) scheduleChromeHide();
});
$('call-stage').addEventListener('pointerleave', () => {
  chromePointerInside = false;
  if (!$('call-stage').classList.contains('chrome-hidden')) scheduleChromeHide();
});
$('call-stage').addEventListener('keydown', event => {
  if (event.key === 'Escape' && openPanel) {event.preventDefault();event.stopPropagation();setPanel(null);return;}
  if (event.key === 'Escape' && !$('camera-menu').hidden) {event.preventDefault();event.stopPropagation();toggleCameraMenu(false,true);return;}
  revealCallChrome();
});
$('call-camera').addEventListener('change', () => {void changeCamera($('call-camera').value);});
$('flip-camera').addEventListener('click', () => {
  const options = [...$('call-camera').options];
  if (options.length < 2) return;
  const index = options.findIndex(o => o.value === stream?.getVideoTracks()[0]?.getSettings().deviceId);
  void changeCamera(options[(index + 1) % options.length].value);
});
navigator.mediaDevices?.addEventListener('devicechange', () => {if (active && !cameraSwitch) void refreshCallCameras();});
$('local-tile').querySelector('.tile-select').addEventListener('click', () => selectVideo('local'));
$('swap-video').addEventListener('click', () => {
  const ids = videoEntries().map(([id]) => id);
  selectVideo(ids[(ids.indexOf(selectedVideo) + 1) % ids.length]);
});
$('fullscreen').addEventListener('click', async () => {
  const stage = $('call-stage');
  if (fullScreenElement() === stage || stage.classList.contains('expanded')) { await exitStage(); return; }
  try {
    if (stage.requestFullscreen) await stage.requestFullscreen();
    else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
    else stage.classList.add('expanded');
  } catch { stage.classList.add('expanded'); }
  syncFullscreen();
});
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('call-stage').classList.contains('expanded')) { void exitStage(); $('fullscreen').focus(); }
});
$('preview-button').addEventListener('click', async () => {
  $('preview-button').disabled = true; $('join').disabled = true;
  try {await capture(); status('Preview ready. Your microphone is available; its sound is not played back here.');}
  catch(e) {status(mediaError(e),true);} finally {$('preview-button').disabled = false; $('join').disabled = false;}
});
for (const id of ['camera','microphone','quality','mode']) $(id).addEventListener('change', () => {
  if (!active && !busy) {stopMedia(); status('Settings changed. Test your devices or join when you’re ready.');}
  $('camera').disabled = $('mode').value === 'audio'; $('quality').disabled = $('mode').value === 'audio';
});
$('toggle-mic').addEventListener('click', () => {
  const t = stream?.getAudioTracks()[0]; if (!t) return; t.enabled = !t.enabled;
  buttonLabel('toggle-mic', t.enabled ? 'Mute microphone' : 'Unmute microphone'); $('toggle-mic').setAttribute('aria-pressed',String(!t.enabled)); notify(t.enabled ? 'Microphone on' : 'Microphone muted', {kind:'info'});
});
$('toggle-video').addEventListener('click', () => {
  const t = stream?.getVideoTracks()[0]; if (!t) return; t.enabled = !t.enabled;
  buttonLabel('toggle-video', t.enabled ? 'Turn camera off' : 'Turn camera on'); $('toggle-video').setAttribute('aria-pressed',String(!t.enabled)); notify(t.enabled ? 'Camera on' : 'Camera off', {kind:'info'});
});
$('leave').addEventListener('click', () => end());
$('play-audio').addEventListener('click', async () => {const r = await Promise.allSettled([...tiles.values()].map(t => t.querySelector('video').play())); $('play-audio').hidden = r.every(v => v.status === 'fulfilled');});
$('copy-link').addEventListener('click', async () => {
  clearTimeout(inviteLabelTimer);
  try {
    await navigator.clipboard.writeText(roomLink);
    buttonLabel('copy-link','Copied!');
    notify('Invitation link copied', {detail:'Send it privately to your family.'});
    inviteLabelTimer = setTimeout(()=>buttonLabel('copy-link','Invite'),2200);
  } catch {
    buttonLabel('copy-link','Invite');
    notify('Copy the invitation manually', {kind:'info',detail:'Automatic copying is unavailable. Select this link and copy it.',manualLink:roomLink,duration:0});
  }
});
$('chat-form').addEventListener('submit', e => {
  e.preventDefault(); const text = $('chat-input').value.trim().slice(0,1000); if (!active || !text) return;
  if (isHost) {message(ownName,text); broadcast({type:'chat',author:ownName,text});}
  else if (!send(hostConnection,{type:'chat',text})) {status('Message not sent. The host is disconnected.',true); return;}
  $('chat-input').value = '';
});
window.addEventListener('pagehide', () => {if (peer || stream) end();});
window.addEventListener('hashchange', () => {if (!active && !busy) lobby();});
window.addEventListener('offline', () => status('Your internet is offline. Keep this page open while it reconnects.',true));
window.addEventListener('online', () => status(active ? 'Internet restored. Waiting for family connections to recover…' : 'Internet restored. You can join the wedding call.'));
lobby();

// Meeting layout and bandwidth controls.
const ICONS = {
 'toggle-mic':'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
 'toggle-video':'<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 9 6-3v12l-6-3"/>',
 'participants-toggle':'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v2"/>',
 'chat-toggle':'<path d="M21 11a8 8 0 0 1-8 8H7l-5 3V7a5 5 0 0 1 5-5h9a5 5 0 0 1 5 5Z"/><path d="M6 8h11M6 12h8"/>',
 'copy-link':'<path d="m9 15 6-6M9 7l1-1a5 5 0 0 1 7 7l-1 1M15 17l-1 1a5 5 0 0 1-7-7l1-1"/>',
 'more-options':'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 'view-mode':'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 'fullscreen':'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
 'swap-video':'<path d="M4 7h16l-4-4M20 17H4l4 4"/>',
 'play-audio':'<path d="M11 4 5 9H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>'
};
function buttonLabel(id,text) {
 const button=$(id),label=button.querySelector('.button-label');
 if(label)label.textContent=text;else button.textContent=text;
 button.setAttribute('aria-label',text);
}
function installIcons() {
 for(const [id,path] of Object.entries(ICONS)){
  const button=$(id),badge=button.querySelector('[id$="-badge"]'),label=document.createElement('span');label.className='button-label';
  label.textContent=id==='participants-toggle'?'Participants':id==='chat-toggle'?'Chat':button.textContent.trim();button.replaceChildren();
  // Static application-owned SVG paths only.
  button.insertAdjacentHTML('afterbegin','<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24">'+path+'</svg>');button.append(label);if(badge)button.append(badge);
 }
}
function setPanel(panel) {
 openPanel=panel;$('meeting-panel').hidden=!panel;$('chat-panel').hidden=panel!=='chat';$('participants-panel').hidden=panel!=='participants';
 $('panel-title').textContent=panel==='participants'?'Participants':'Family chat';
 $('chat-toggle').setAttribute('aria-expanded',String(panel==='chat'));$('participants-toggle').setAttribute('aria-expanded',String(panel==='participants'));
 if(panel==='chat'){unreadMessages=0;$('chat-badge').hidden=true;}
 revealCallChrome();requestAnimationFrame(arrangeVideos);
}
function renderParticipants() {
 $('participant-list').replaceChildren();
 for(const m of roster){
  const row=document.createElement('li'),avatar=document.createElement('span'),name=document.createElement('span'),sub=document.createElement('small');
  avatar.className='participant-avatar';avatar.textContent=m.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  name.className='participant-name';name.textContent=m.name+(m.id===selfId?' (you)':'');
  sub.textContent=m.id===hostId||(isHost&&m.id===selfId)?'Host':'Guest';name.append(sub);row.append(avatar,name);$('participant-list').append(row);
 }
 $('participant-badge').textContent=roster.length;
}
function videoProfile() {
 const choice=$('quality').value,n=Math.max(1,roster.length);
 if(choice==='group')return n>5?{height:360,bitrate:250000,fps:18}:n>3?{height:480,bitrate:450000,fps:20}:{height:720,bitrate:900000,fps:24};
 const h=Number(choice)||360;return {height:h,bitrate:h>=1080?2000000:h>=720?1200000:300000,fps:24};
}
async function tuneSender(call,profile) {
 const pc=call.peerConnection;if(!pc||pc.connectionState==='closed')return;
 const sender=pc.getSenders().find(s=>s.track?.kind==='video');if(!sender?.getParameters||!sender.setParameters)return;
 const p=sender.getParameters();if(!p.encodings?.length)return;
 p.encodings.forEach(e=>{e.maxBitrate=profile.bitrate;e.maxFramerate=profile.fps;});
 try{await sender.setParameters(p);}catch{/* Browser adaptation remains available when limits are unsupported. */}
}
function scheduleQuality(force=false) {
 if(!active)return;
 const profile=videoProfile(),signature=JSON.stringify(profile);if(!force&&signature===lastQualityProfile)return;
 lastQualityProfile=signature;const generation=epoch;
 qualityQueue=qualityQueue.catch(()=>{}).then(async()=>{
  if(!active||epoch!==generation)return;
  const track=stream?.getVideoTracks()[0];
  if(track?.applyConstraints)try{await track.applyConstraints({width:{ideal:Math.round(profile.height*16/9)},height:{ideal:profile.height},frameRate:{ideal:profile.fps,max:profile.fps}});}catch{}
  if(!active||epoch!==generation)return;
  await Promise.allSettled([...calls.values()].map(c=>tuneSender(c,profile)));
 });
}
installIcons();
$('view-mode').addEventListener('click',()=>{layoutMode=layoutMode==='gallery'?'focus':'gallery';$('videos').scrollLeft=0;arrangeVideos();});
$('chat-toggle').addEventListener('click',()=>setPanel(openPanel==='chat'?null:'chat'));
$('participants-toggle').addEventListener('click',()=>setPanel(openPanel==='participants'?null:'participants'));
$('close-panel').addEventListener('click',()=>{const prior=openPanel;setPanel(null);$(prior==='chat'?'chat-toggle':'participants-toggle').focus();});
$('waiting-invite').addEventListener('click',()=>$('copy-link').click());
$('call-quality').addEventListener('change',()=>{$('quality').value=$('call-quality').value;scheduleQuality(true);cameraFeedback('Video quality preference updated.');notify('Video quality preference updated', {detail:$('call-quality').selectedOptions[0].textContent});});
new ResizeObserver(()=>{if(active)arrangeVideos();}).observe($('videos'));

