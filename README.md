# Our Wedding Call — meeting edition

Phyo Arkar Soe & Myat Thu Thu Ko. Updated 24 October 2026.

A lightweight browser meeting for up to **8 devices**, with a Zoom-inspired layout and blush pink, crystal, and chrome styling. The video area uses neutral grey; real camera images are not tinted.

## Features

- Gallery view for everyone, plus focus view with a horizontally scrollable thumbnail strip. Click/tap a tile to focus it. Swapping layouts reuses existing video elements and connections.
- Compact icon toolbar: microphone, camera, participants, chat, invite, camera/quality settings, and leave.
- Collapsible participant and chat panels, also usable in fullscreen. Unread chat badge when the panel is closed.
- Camera selection before joining and in-call switching. Audio, microphone mute, and camera-off state are preserved on a successful switch. Failed switches attempt to restore the previous track.
- Eight-device room capacity enforced by the host, with admission rejection for the ninth device. Participant lists and gallery update on leave/rejoin.
- Group quality (default): requests 720p for 1–3 devices, 480p for 4–5, and 360p for 6–8. Requested per-peer video caps are 900, 450, and 250 kbit/s respectively, where the browser supports them. Actual resolution/bitrate may differ. Manual 360p, 720p, and 1080p options are also available during the call.
- Fullscreen or expanded-page fallback starts with controls hidden. Only the wedding heading and names remain above the video. Tap to reveal controls, or move the pointer over the top-right or bottom control area. Controls stay visible while hovered, then fade three seconds after moving away. The first reveal tap does not activate a button or focus a tile. Open menus/panels keep controls available. Escape closes an open panel/menu first. The room-ready prompt is excluded from fullscreen.
- Private random invitation, no recording, chat stored only in the current tab (200 displayed messages), and no application-imposed call timer.

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
2. Upload **index.html, app.js, styles.css, and call-layout.css** together to the repository root. Replace all four when upgrading from the old three-device version. The README and preview are optional.
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
- No screen sharing, recording, telephone dial-in, persistent chat, or large-audience broadcast is implemented.
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
