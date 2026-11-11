# Our Wedding Call — Auto quality

Phyo Arkar Soe & Myat Thu Thu Ko · Updated 11 November 2026.

A free, custom wedding meeting for up to eight devices, with gallery/focus views, camera switching, voice, chat, private invitations, and local recording. **Auto is now the default for live video and saved recordings.**

## Automatic quality

Live video can target 1080p, 720p, 480p, 360p, or 240p. The app adjusts camera resolution, sender bitrate, and frame rate using connection statistics and device load. Sustained packet loss, high round-trip time, bandwidth/encoder pressure, dropped received frames, and UI stalls trigger reductions. Ordinary pressure needs two samples; severe pressure can reduce immediately. Recovery needs eight healthy samples, about 32 seconds, to avoid frequent switching.

Auto starts conservatively for larger rooms and less capable devices: four/five devices target at most 720p; six–eight target at most 480p. Available browser hints for Data Saver and slower connections can lower this further. The host shares its quality ceiling with guests. Each device also monitors its own connections. Browser congestion control remains enabled. Targets depend on camera/browser support; tile labels report actual received dimensions.

**More → Video quality** offers Auto, Auto up to 720p, and Auto data saver. These are quality ceilings; automatic reductions remain enabled. Cameras use preferred dimensions rather than rejecting a device that cannot provide exactly 1080p.

Recording follows live quality and has its own frame-delivery/device-load monitor. Its gallery output can use 1080p/24 fps, 720p/20 fps, 540p/15 fps, 360p/12 fps, or 240p/10 fps. Sustained recording pressure lowers the tier; recovery is gradual. Recording can recover up to its starting tier because the browser's encoder bitrate is chosen when recording starts. The REC badge shows the current recording target.

**MP4 is the default recording format when supported.** It uses H.264/AAC and saves a real .mp4 file. Choose **More → Recording format** before starting a recording. MP4 keeps its starting resolution and automatically reduces frame rate when needed; the live call still adapts resolution, bitrate, and frame rate.

**WebM · adaptive resolution** remains available for continuous resolution changes within one file, using VP8/Opus. If the browser cannot record MP4, the menu disables MP4, selects WebM, and explains the fallback. Format selection is locked during recording. Player support for changing dimensions varies; check the finished file in a compatible player. Existing WebM recordings remain WebM; changing the setting affects new recordings only.

## Recording your wedding

1. Start the room on the laptop that will save your memories.
2. MP4 is selected by default where available. To change the format, use **More → Recording format**, then click **Record all**. Choose a filename/location if the browser offers a Save dialog. Cancelling cancels recording. Otherwise, footage is kept in browser storage until downloaded.
3. Guests receive a recording notice and see REC. The host records a gallery of everyone, their microphone, and audio received from participants. Focus view, chat, and controls do not change the recorded gallery.
4. Click **Stop recording** and wait for saving. The selected file is finalized, or the recordings library offers **Download video**. The More menu also opens the library. Leaving the room stops and finalizes recording while the page remains open.
5. Download, play back, and keep a separate copy of your wedding memory.

This is one combined gallery video. Each camera occupies part of the gallery; missing or disconnected footage cannot be recovered. Microphone/camera mute states are respected.

Where supported, cloned video tracks feed a background worker through MediaStreamTrackProcessor. OffscreenCanvas composes the gallery, with only one output frame in flight and cached decorations. A cached main-thread renderer supplies compatibility when these APIs are unavailable. Stopping the recorder stops its clones, leaving live call tracks running.

Recording adds **no extra video upload** or cloud recording service. Compositing, audio mixing, encoding, file writing, and backups happen on the recording device. Small recording/quality notices use existing data connections. Recording still consumes local CPU, battery, and storage; Auto reduces demand when necessary.

## Interface and room behaviour

The meeting includes gallery view, a focused main video with thumbnails, camera/microphone controls, participant list, chat, invitation copying, camera selection, and the recordings library. Voice-only joining is available. Changing the microphone device or upgrading from voice-only to video requires rejoining.

Fullscreen begins with controls hidden. Wedding names and REC remain visible. Tap to reveal controls, or move the pointer into a control region. Controls remain while hovered and fade after moving away. The room-ready prompt stays outside fullscreen. Notifications confirm actions and automatic quality changes.

The host must keep the room tab open. Leaving/refreshing the host ends the room; a newly started room needs a new invitation. Guests can rejoin the same link while the host remains present. Anyone with the invitation can join while space remains. There is no login or manual admission screen. Chat stays in the current tab, with up to 200 displayed messages.

## Storage and recovery

- At the highest starting tier, video targets 3.5 Mbit/s plus 128 kbit/s audio, approximately 1.6 GB/hour before overhead. Actual file sizes vary with content and quality changes; allow additional space for the browser backup.
- Data is written in chunks, normally every 10 seconds. Selected-file recording also keeps a browser backup where storage permits.
- If browser storage fills while file writes remain healthy, the selected file continues without accumulating missing backups in RAM. Keep that file: the backup may be incomplete.
- If storage cannot keep up, recording stops and offers retained footage while the call remains connected.
- Interrupted sessions can offer **Recover video** after reload. This exports saved chunks; unsaved portions may be lost and interrupted files may need repair. Emergency chunks held in memory do not survive closing the page.
- Clearing website data, private browsing, a different browser/profile/site origin, power loss, or crashes can remove or interrupt backups. Keep the tab open while Saving is displayed.

## Free hosting and connection limits

Upload these five files together: **index.html, app.js, recording.js, styles.css, call-layout.css**. No build step or API key is required. README and preview images are optional.

For GitHub Pages, upload the files to a public repository, then choose **Settings → Pages → Deploy from a branch**, the default branch and **/(root)**. Open the HTTPS site, start the host room, and privately share its invitation link. The ordinary site URL creates a separate room.

When upgrading, replace all five files and refresh/reopen the call on **every device**. Versioned script URLs help load this update.

The free call is a peer-to-peer mesh: each device sends to every other device. Auto reduces demand, but bandwidth still grows with the number of participants. This build uses PeerJS public signaling, Google STUN, jsDelivr for PeerJS, and optional Google Fonts. No TURN relay is configured, so some firewalls/NATs/mobile networks cannot connect directly. There is no paid service, screen sharing, telephone dial-in, persistent chat, or large-audience broadcast configured.

Use a powered laptop for recording, keep the tab foregrounded and the device awake, and rehearse on the actual devices and international connections. Automatic reduction helps with overload; it cannot guarantee zero lag or restore footage that never arrived.

## Verification

The MP4 update downloaded a real MP4 file and played it to the end at 1920×1080 with both synthetic cameras and both audio test tones. Automatic frame-rate targets changed 24 → 20 → 15 → 20 without interrupting the file. Format selection, its recording-time lock, the mobile menu, guest visibility, and automatic WebM fallback when MP4 support was disabled were checked. The fallback WebM also retained working resolution changes and audio playback.

The Auto update was checked with real local WebRTC delivery, including 1080p → 720p → 480p reduction and recovery, bitrate changes, and injected encoder-pressure statistics. Continuous worker and compatibility-renderer recordings played to the end through 1080p → 720p → 540p → 720p, preserving both synthetic camera images and both audio test tones. The recording governor reduced quality after sustained frame-delivery pressure and recovered after healthy samples. Camera-off privacy, original-track cleanup, and fullscreen recording controls passed.

Eight local app instances established 28 media connections with Auto enabled, recorded eight audio inputs, and passed chat, camera switching, participant-limit, leave/rejoin, guest recording-notice, and responsive-layout checks. Inputs were small synthetic videos; this is a functional check, not a real-world performance guarantee.

These local tests use synthetic cameras and local signaling; actual camera hardware, public signaling, international networks, and ceremony-length recording require rehearsal. The site was not published by this update.

## References

- [PeerJS media connections](https://peerjs.com/client/api/media-connection)
- [WebRTC statistics](https://www.w3.org/TR/webrtc-stats/)
- [MediaStream Recording](https://www.w3.org/TR/mediastream-recording/)
- [WebRTC TURN setup](https://webrtc.org/getting-started/turn-server)
