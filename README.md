# Our Wedding Call — Full HD edition

Phyo Arkar Soe & Myat Thu Thu Ko · Updated 11 November 2026.

A custom wedding meeting with gallery/focus views, chat, camera switching, private invitations, and local **1920×1080 recording**. The room admits up to eight devices. Full HD video calls require capable cameras, devices, and connections; the capacity limit is not a guarantee of lag-free eight-way HD on all equipment.

## What changed

- **Full HD camera mode:** camera acquisition and in-call camera changes request exactly 1920×1080. A camera that cannot provide that mode reports an error instead of silently choosing a lower capture resolution. Voice-only joining remains available.
- **No recording-related quality reduction:** starting a recording no longer lowers the camera resolution, bitrate preference, or target frame rate. Live video targets 1080p at 24 fps and up to 4 Mbit/s per peer.
- **H.264 preference:** offer/answer SDP prefers H.264 and its repair payloads while retaining other mutually supported codecs. Sender settings request full-size encoding and a maintain-resolution degradation preference, and are applied again after the connection is negotiated.
- **Actual quality labels:** remote tile labels report the received dimensions, or 1080p when that is actually arriving. Browser congestion control and hardware limits can still affect delivery; the app does not claim a lower-resolution received stream is 1080p.
- **Background recording compositor:** where supported, cloned video tracks feed bounded MediaStreamTrackProcessor streams directly into a worker. The worker draws the gallery with OffscreenCanvas and transfers one output frame at a time for capture. Full video images are not repeatedly copied through the UI thread. Static graphics are cached. Camera-off state is propagated immediately, and stopping recording stops processor clones, not the live call tracks.
- **Fixed 1080p recording:** output stays 1920×1080 with a 24 fps target. There is no automatic 540p/720p recording mode or adaptive-resolution downgrade. Unsupported worker environments use the cached main-thread 1080p renderer; this compatibility path can require more UI-thread CPU.
- **Local H.264/MP4 recording** is preferred when MediaRecorder supports it, with a WebM/VP8 fallback. Hardware acceleration depends on the browser, GPU, driver, and settings; the app cannot force it or promise that it is active.

## Calling and interface

The meeting has gallery view, a focused main video with a scrolling thumbnail strip, microphone/camera controls, participant list, chat, invitation copying, camera selection, and a recordings library. Voice-only participants can join without a camera. Changing a microphone device or upgrading from voice-only to video currently requires rejoining.

Fullscreen starts with controls hidden. Wedding names remain visible, and the REC indicator stays visible during recording. Tap to reveal controls or move the pointer into the top-right or bottom control region. Buttons stay visible while hovered, then fade after moving away. Notices confirm important actions. The room-ready prompt is excluded from fullscreen.

The host must keep the room tab open. Host leave/refresh ends the room; a new host room needs a new invitation. Guests may rejoin the existing link while the host remains present. Anyone possessing the invitation can join while there is space; there is no account login or manual admission screen. Chat stays in the current tab only, with up to 200 displayed messages.

## Recording your wedding

1. Start the room on the laptop that will save your memories.
2. Click **Record all**. If the browser offers a Save dialog, choose a filename/location. Cancelling that dialog cancels recording. Otherwise, browser storage holds the footage until you download it.
3. All updated guests receive a recording notice; the host and guests see REC, including after a guest rejoins.
4. The recording always shows everyone in a gallery, with the local microphone and audio received from connected participants. Changing the meeting's display view or opening chat does not change the recorded gallery. Muted microphones/cameras remain muted/off.
5. Click **Stop recording** and wait for saving. The selected file is finalized, or Wedding recordings offers a **Download video** button. The More menu also opens the library. Leaving the host room stops/finalizes recording while the page remains open.
6. Download and check the file, then keep a separate copy of the wedding memory.

The output is **one combined 1080p gallery video**, not eight separate original full-frame camera files. Each person's tile occupies part of that 1920×1080 gallery. Missing/offline video cannot be recovered by the recorder. Menus, chat, and notifications are not composited into the saved video.

## Network and performance limits

**Recording adds no extra video upload or recording server.** Video frames, audio mixing, encoding, file writing, and browser backups are local. Small recording-state notices are sent through the existing call connections.

The live call itself necessarily uses internet traffic. This free version is a peer-to-peer mesh: each person sends a separate stream to every other participant. At the configured 4 Mbit/s video target, eight participants can need about **28 Mbit/s upload and download per device before audio/overhead**. Allow roughly 35 Mbit/s in each direction for budgeting at that target. Actual traffic varies with motion, codec, and congestion. A media-forwarding server can reduce duplicated uploads for larger groups, but is not configured in this free static-hosting build.

No browser app can guarantee zero lag or full-rate 1080p when a camera, encoder, device, or connection cannot sustain it. Even with full-size capture, WebRTC may reduce frame rate or otherwise adapt under congestion. Received labels reflect actual arrival. Eight live HD send/receive streams plus recording are especially demanding on phones and older laptops.

Use a powered, capable desktop/laptop and a supported current browser for the recording host. Keep the tab foregrounded and devices awake. Rehearse the expected ceremony duration on the real devices and international connections, with a tested backup available. Confirm local internet-calling availability with your provider.

## Storage and recovery

- Recording targets about 4 Mbit/s video plus 128 kbit/s audio: budget roughly **1.9 GB per hour for the file**, plus space for the browser backup. Actual size varies.
- Data is written in periodic chunks, normally every 10 seconds. The selected-file path also keeps a browser backup where storage permits.
- If browser backup storage fills while file writes remain healthy, the selected file continues without accumulating the missing backup in RAM. Keep that file: it is the complete copy. If the selected file subsequently fails too, the available browser backup may cover only part of the recording.
- Pending storage is bounded. If storage cannot keep up, recording stops and offers the retained footage while the call remains connected.
- Unfinished sessions can show **Recover video** after reload. This exports saved chunks; unsaved portions may be lost and interrupted files may need repair. Emergency chunks held in memory do not survive closing the page.
- Clearing website data, private browsing, changing browser/profile/site origin, power loss, or a crash can remove or interrupt local backups. Do not close the tab while Saving is displayed.
- Check the completed file in a compatible player before clearing browser data. Older recordings remain available at the dimensions at which they were originally captured.

## Free hosting

Upload all five files together: **index.html, app.js, recording.js, styles.css, call-layout.css**. No build step or API key is required. README and preview images are optional.

For GitHub Pages: create/open a public repository, upload the files to its root, then select **Settings → Pages → Deploy from a branch**, the default branch, and **/(root)**. Open the resulting HTTPS URL, start the host room, and privately share its invitation URL. The ordinary site URL creates a separate room.

When upgrading, replace all five files and reopen/refresh the call on every device. Versioned script URLs help avoid the previous cached recording implementation.

This setup depends on PeerJS public signaling, Google STUN, jsDelivr for PeerJS, and optional Google Fonts. No TURN relay is configured, so some NATs/firewalls/mobile networks cannot connect directly. Third-party availability and limits can change. There is no paid service, cloud recording, screen sharing, telephone dial-in, persistent chat, or large-audience broadcast configured.

## Verification and its limits

- Real MediaRecorder output played back at **1920×1080** with both synthetic camera images and both test audio frequencies. The worker path used direct track-processor input and H.264/AAC MP4 output. The compatibility renderer also produced a playable 1080p file.
- A real local H.264 WebRTC connection delivered 1920×1080, with full-size sender settings, a 4 Mbit/s limit, and maintain-resolution preference. Exact capture requests and codec payload preservation were checked.
- Camera off/on was verified against recorded canvas pixels. Recorder shutdown left original call tracks live. Dynamic joins/leaves, saved chunks, downloads, direct-file path, save-on-leave, and recovery after reload were checked.
- A controlled eight-video recording benchmark kept **1080p/24 fps on both versions**. Main-thread task load fell from **17.9% to 5.5%**, total Chrome CPU use from about **1.98 to 1.09 CPU cores**, and 95th-percentile timer delay from **13.6 ms to 9.7 ms**. Inputs were animated synthetic videos. These are local measurements, not a guarantee for the wedding devices.
- Four local Full HD app instances each received three 1920×1080 streams while the worker produced a playable 1080p recording with four audio inputs. Those synthetic cameras updated at 2 fps; this verifies dimensions and functionality, not a physical 24-fps performance guarantee.
- The app admits up to eight devices, and earlier functional suites exercised eight app instances/28 media connections. A combined eight-instance Full HD stress run exceeded the single test machine's capacity; lag-free eight-device HD operation has **not** been established for your equipment/network.
- Public signaling, actual cameras, international connections, and a ceremony-length recording still need a full rehearsal. The site is not published by this task.

## References

- [PeerJS media connections](https://peerjs.com/client/api/media-connection)
- [MediaStreamTrackProcessor](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor)
- [Chrome insertable media processing](https://developer.chrome.com/docs/capabilities/web-apis/mediastreamtrack-insertable-media-processing)
- [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [WebRTC TURN requirements](https://webrtc.org/getting-started/turn-server)
