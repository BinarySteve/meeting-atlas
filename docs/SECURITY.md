# Security review

## Owner authentication

Owner authentication supports discoverable WebAuthn passkeys through SimpleWebAuthn plus the existing Argon2 password as recovery. Registration requires an authenticated session. Registration and authentication require user verification. PostgreSQL stores credential public keys, counters, transports, backup/device type, creation time, and last-use time. Zero-counter authenticators remain supported through the library verifier.

New passwords are normalized to Unicode NFC, must contain 15–128 characters, are checked against common and account-derived values, and have no arbitrary composition rule. Argon2id uses 64 MiB memory, three iterations, and one lane. Password managers, generated values, spaces, and paste remain supported. Password changes require the current password and invalidate every session.

Profile and session controls live under Account. Login-email changes, passkey registration, and passkey revocation require current-password reauthentication and revoke other sessions. The page lists active devices, authentication methods, last activity, and individual/all-other revocation controls. Sessions have a two-hour idle timeout and a twelve-hour absolute timeout. Successful security changes are recorded without passwords, IP addresses, private meeting data, or credential material.

Forgotten-password recovery is host-only through `npm run owner:reset-password`. There is no remotely reachable reset endpoint, email dependency, or knowledge-based security question. The command requires exactly one database owner, applies the same password policy and hashing, audits the reset, and invalidates all sessions without automatically signing in.

Challenges are stored server-side with operation, optional user binding, five-minute expiry, single-use state, and an HTTP-only SameSite cookie. Verification uses only configured expected origin and RP ID. Passkey changes revoke other sessions. Owner sessions use signed HTTP-only, SameSite=Strict, secure-in-production cookies plus server-side revocation records.

Production requires HTTPS and a stable hostname. `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` come only from trusted environment configuration; startup rejects insecure or mismatched production settings. Authentication handlers never log passwords, assertions, challenges, cookies, recordings, or transcript content.

## PWA cache boundary

Service worker allowlist contains only the offline screen and app icons. It does not cache authenticated pages, APIs, authentication responses, recordings/audio ranges, transcripts, summaries, action items, decisions, or owner data. Navigation uses network and falls back to the public offline explanation only when unreachable.

## Backup boundary

Backup list, creation, verification, download, and deletion require owner authentication; mutations also enforce expected origin. Archive names are generated and allowlisted, paths are canonicalized under configured backup root, and tar entries are checked before extraction. Archives include private recordings and database content, receive no-store download headers, and must be encrypted when copied elsewhere. Browser routes never restore or overwrite live data.

## Processing event stream

The meeting processing SSE endpoint requires the same owner session as the meeting page and verifies access before opening the stream. Redis channel messages are invalidations only and contain no transcript, summary, evidence, recording, or owner content. The server re-reads PostgreSQL and sends only the processing snapshot required by the UI.

Client-side disabled controls are feedback, not authorization or concurrency enforcement. Mutation routes re-check the owner session and active job. PostgreSQL's partial unique index is the final one-active-job-per-meeting boundary, including concurrent requests from separate tabs or clients. Conflict responses expose only the authenticated meeting's current processing snapshot.

Transcript reprocessing is owner-authenticated, bounded by the same active-job constraint, and targets only a transcript belonging to the meeting. It refuses a manually active transcript so derived machine processing cannot silently replace human work. PostgreSQL meeting-row locks serialize job creation with transcript editing and pointer restoration/activation. New raw artifacts and transcript versions are written immutably; active transcript/summary pointers change together only after successful completion.

## Enforced

- Single owner; Argon2id password; signed 12-hour HTTP-only SameSite=Strict cookie with two-hour server-side idle expiry.
- Proxy and each mutation/API re-check authorization.
- No public registration or recovery endpoint.
- FastAPI rejects missing/incorrect bearer credential.
- Browser cannot address infrastructure/model services through application code.
- Upload body streams to disk; 2 GiB limit; FFprobe verifies real audio stream.
- Generated storage keys, canonical-root checks, traversal rejection, `0600` files.
- FFmpeg/FFprobe/whisper use argument arrays and no shell interpolation.
- Timeouts, bounded logs, retries, cancellation, idempotency guards.
- Authenticated processing SSE; no private artifacts in Redis Pub/Sub payloads; database-enforced active-job uniqueness.
- Immutable transcript history, manual-version reprocessing guard, and atomic active transcript/summary activation.
- No remote runtime assets, telemetry SDKs, cloud APIs, or automatic model downloads.
- Secrets excluded by `.env*`; logs redact auth/password/token fields.

## Network policy

Windows firewall should allow TCP 6982 only from trusted LAN/VLAN or the Nginx Proxy Manager host. Kubuntu should allow TCP 8080 only from Windows homelab IP. LM Studio TCP 1234 should allow only Kubuntu loopback/service needs. PostgreSQL/Redis must not bind LAN in production. Deny WAN/Cloudflare exposure.

Example Kubuntu UFW rules (adjust Windows IP):

```bash
sudo ufw allow from 192.168.4.20 to any port 8080 proto tcp
sudo ufw deny 8080/tcp
sudo ufw deny 1234/tcp
```

Verify rule order before enabling. If Windows directly health-checks LM Studio, allow only its exact IP to 1234 instead of blanket deny.

## Residual risks

- LAN owner browser/session compromise exposes private meetings.
- Filesystem/DB backups contain sensitive data; encrypt backup destination.
- WeSpeaker public model setup reveals downloader IP to host, but sends no account/contact data.
- User systemd needs linger for unattended boot before login.
- Long-lived SSE connections increase authenticated connection count; reverse-proxy limits and timeouts must be sized for expected open meeting tabs.
