# Our Wedding Call — meeting edition

Phyo Arkar Soe & Myat Thu Thu Ko. Updated 11 November 2026.

A lightweight browser meeting for up to **8 devices**, with a Zoom-inspired layout and blush pink, crystal, and chrome styling. The video area uses neutral grey; real camera images are not tinted.

## Features

- Gallery view for everyone, plus focus view with a horizontally scrollable thumbnail strip. Click/tap a tile to focus it. Swapping layouts reuses existing video elements and connections.
- Compact icon toolbar: microphone, camera, participants, chat, invite, camera/quality settings, and leave.
- Collapsible participant and chat panels, also usable in fullscreen. Unread chat badge when the panel is closed.
- Camera selection before joining and in-call switching. Audio, microphone mute, and camera-off state are preserved on a successful switch. Failed switches attempt to restore the previous track.
- Eight-device room capacity enforced by the host, with admission rejection for the ninth device. Participant lists and gallery update on leave/rejoin.
- Group quality (default): requests 720p for 1–3 devices, 480p for 4–5, and 360p for 6–8. Requested per-peer video caps are 900, 450, and 250 kbit/s respectively, where the browser supports them. Actual resolution/bitrate may differ. Manual 360p, 720p, and 1080p options are also available during the call.
- Fullscreen or expanded-page fallback starts with controls hidden. Only the wedding heading and names remain above the video. Tap to reveal controls, or move the pointer over the top-right or bottom control area. Controls stay visible while hovered, then fade three seconds after moving away. The first reveal tap does not activate a button or focus a tile. Open menus/panels keep controls available. Escape closes an open panel/menu first. The room-ready prompt is excluded from fullscreen.
- Private random invitation, optional host-controlled local recording, chat stored only in the current tab (200 displayed messages), and no application-imposed call timer.

## What was tested

Passed with eight separate app instances and a test signaling adapter:

- 28 real local WebRTC media connections, one per pair of participants, using synthetic camera/audio tracks.
- Media streams between every pair, eight-way chat, rejection of a ninth participant, and guest leave/rejoin.
- In-call camera replacement sent to seven peer connections and Group bitrate settings on real RTP senders.
- Gallery/focus layouts, scrolling thumbnails while the main video stays pinned, panels, fullscreen auto-hide, touch reveal, and responsive layouts at 1440×950, 390×844, 320×568, and 844×390.
- JavaScript syntax check.

**These were local tests with substituted signaling. Public PeerJS signaling, physical cameras, eight real devices, and connections between your countries have not been verified. The website is not published.** The included preview is a layout demonstration with simulated participants.

## Hosting for free on GitHub Pages

1. Create or open your GitHub repository.
2. Upload **index.html, app.js, recording.js, styles.css, and call-layout.css** together to the repository root. Upload all five when upgrading; recording.js is newly required. The README and preview are optional.
3. In **Settings → Pages**, select **Deploy from a branch**, your default branch, and **/(root)**. Save and wait for the HTTPS address.
4. Open that HTTPS address on the hosting device, enter a name, test/select devices, then start the room.
5. Copy its invitation link and privately send it to the other participants. The ordinary website address creates a new room; guests need the invitation link.
6. Keep the host tab open. It coordinates admission, the participant list, and chat.

There is no build step, account key, payment integration, or paid service configured by the source. The ZIP contains the deployable files and this guide.

## Practical limits

- This is a P2P mesh: each device sends a separate stream to every other device. Eight-device support is a room limit, not a guarantee of eight-device performance on every phone/network. Use Group quality and rehearse with your intended devices. Larger groups need a media-forwarding server architecture.
- The free configuration depends on PeerJS public signaling, Google STUN, jsDelivr for PeerJS 1.5.5, and optional Google Fonts. Third-party availability, policies, and limits can change.
- **No TURN relay is configured.** Some NATs, mobile networks, and firewalls prevent direct calls. A relay may be needed and sustained relayed video may exceed free allowances.
- The host must stay present. Host leave/refresh closes the room; start a new room and share its new link. There is no host migration.
- The invitation grants access to anyone possessing it while there is space. There is no login, manual admission, or identity verification. Connection providers process metadata.
- Changing the microphone device or upgrading from voice-only to video requires rejoining. If the host rejoins, everyone needs the new invitation. Some phones cannot open a second camera while the first is active; such a switch may fail while preserving the old camera.
- No screen sharing, telephone dial-in, persistent chat, or large-audience broadcast is implemented.
- Browser backgrounding and screen lock may interrupt calls. Keep devices powered, page foregrounded, and use headphones where possible.
- Confirm UAE internet-calling availability with your provider. Rehearse from every actual location for the expected ceremony duration and keep a tested backup.

## References

- [PeerJS documentation](https://peerjs.com/docs/)
- [RTP sender configuration](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters)
- [WebRTC TURN requirements](https://webrtc.org/getting-started/turn-server)
- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## Fullscreen cleanup verification

Passed browser checks for immediate clear fullscreen entry, solo-host room-ready prompt removal in native and fallback fullscreen, title persistence, targeted pointer reveal, hover hold, safe first-tap reveal, menus, desktop/mobile/landscape bounds, stable eight-tile layout, and exit cleanup. The Connection notes section was removed from the webpage. Operational details remain in this guide.

## Action feedback

Brief crystal-style notices confirm copied invitations, microphone/camera toggles, camera changes, and quality preferences. Errors also appear as notices so they remain visible in fullscreen. Invite temporarily changes to “Copied!”. If clipboard access is blocked, a persistent notice contains a selectable invitation link and a dismiss button, including in fullscreen. Notices use a polite accessible live region, replace one another, and normally dismiss automatically without revealing hidden controls.

Browser checks passed for clipboard success and denied-access fallback, fullscreen placement, manual-copy interaction while controls remain hidden, button feedback/reset, microphone/camera state, camera/quality notices, error styling, notice replacement/expiry, mobile bounds, and moving the notice back to the document on fullscreen exit.

## Recording your wedding

1. Start the room on the laptop/device that will save your memories. The host sees **Record all** in the toolbar.
2. Click it when you want to begin. On supported desktop browsers, choose a filename/location in the Save dialog. Cancelling that dialog cancels recording. Other supported browsers save chunks in browser storage instead.
3. A persistent **REC** indicator appears for the host and guests, including guests who join/rejoin later. Recording is explicit and never starts just because someone joins. Let your families know you are recording.
4. Continue the call normally. The recording always shows everyone in a gallery, with participant names and all audio reaching the host. Switching the screen to focus view, opening chat, switching cameras, or entering fullscreen does not change the recorded gallery. Muted microphones and disabled cameras remain muted/off.
5. Click **Stop recording** and wait for saving to finish. A selected file is closed and saved, or a **Wedding recordings** dialog offers **Download video**. The More menu also opens this library. Leaving the host room stops and finalizes the recording automatically while the page remains open.
6. Download/check your video, then keep a separate copy of the memory. The library is also shown below the meeting and on the join page when recordings exist on this device.

### What is saved

One combined gallery video, targeted at **1920×1080, 24 fps**, with mixed local and remote audio. Output normally uses **WebM (VP8/Opus)**; MP4 is a compatibility fallback where supported. It is not a set of independent original camera files. Individual tiles retain the quality of the video actually received by the host; missing/offline video cannot be recorded. Chat, menus, popups, and view changes are not composited into the video. Recording is processed locally and is not sent to a cloud recording service.

### Long calls and recovery

- **Desktop Chrome or Edge on a powered laptop is preferred.** Keep the recording tab open and foregrounded. Browser suspension, screen lock, device sleep, power loss, or a crash can interrupt recording. Do not close the page while Saving is displayed.
- Supported browsers stream data to your chosen file, and also save periodic chunks in IndexedDB. When direct file access is unavailable, browser storage is the recording destination until you download. Private browsing, storage quotas, clearing website data, or switching browser/profile/origin can remove or hide this local backup.
- Recording uses a 4 Mbit/s video target plus audio: allow roughly **1.9 GB per hour for the file**, plus space for the browser backup; actual size varies. Check free disk space before a long ceremony. Recording and an eight-device mesh also increase CPU/battery use.
- If an unfinished session remains after a reload, **Recover video** exports the chunks saved so far. The most recent unsaved portion may be missing, and severely interrupted files may need repair. Recovery is not a guarantee against every crash or storage failure.
- If direct-file writes fail, the browser backup remains available. If browser storage fills without a working direct file, recording stops and offers the retained footage. Download immediately in that case: emergency chunks held in memory do not survive closing/reloading the page.
- Browser-recorded WebM duration/seek metadata varies between players. Check the downloaded video with a compatible player such as VLC before relying on it.

### Recording verification

Passed real browser MediaRecorder recording/download/playback with synthetic camera and audio sources: a 1920×1080 file contained both camera images and both test audio frequencies. Also passed dynamic participant joins/leaves, focus/chat independence, periodic chunk storage, direct-file writer path, save-on-leave, interrupted-session recovery after reload, storage-quota emergency recovery, direct-file failure fallback, picker cancellation, and guest recording indicators. A separate eight-instance local WebRTC run verified eight recording audio inputs, guest/rejoin notifications, persisted video output, all-to-all media, and chat. Local test signaling and synthetic inputs were used; a full-length ceremony on your physical devices and international networks remains an essential rehearsal.

Recording API references: [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [canvas capture](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream), [file picker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker).
