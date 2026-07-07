# AI CreatorForce — Cross-Platform, Packaging & Domain Configuration
## Implementation-Ready Specification (v1.0)

> Companion to `AI-CreatorForce-Billing-Payment-Security-Spec.md`. This document covers running the app on **iOS, Android, Windows, and macOS**, distributing/signing it, and configuring the **custom domain, DNS, TLS, deep links, and app-to-domain associations**.

---

## 1. Executive Summary

The platform must ship as native-feeling apps on **iOS, Android, Windows, and macOS**, alongside the existing web app, all talking to the **same backend** over the same custom domain. Nothing about the billing/wallet/security backend changes conceptually — clients are thin, the server is the source of truth. The main new work is:

1. Choosing a client stack that covers all four OSes with one codebase where sensible.
2. Meeting each platform's **store rules, signing, and payment requirements** (see §6.6 of the billing spec — Apple/Google IAP is mandatory for credits inside mobile apps).
3. Setting up the **custom domain**: DNS records, TLS certificates, subdomain layout, deep-link / universal-link associations, and email domain auth.

---

## 2. Recommended Client Architecture

You have one backend and five frontends (web + 4 native). Recommended approach to avoid maintaining five codebases:

| Layer | Recommendation | Why |
|---|---|---|
| Mobile (iOS + Android) | **React Native** or **Flutter** | one codebase, native store integration, mature IAP plugins |
| Desktop (Windows + macOS) | **Tauri** (preferred) or **Electron** | Tauri = smaller/safer (Rust core, system webview); Electron = heavier but battle-tested |
| Web | existing web app (keep current design per original brief) | reuse |
| Shared | extract API client, types, auth, and design tokens into a shared package | one contract for all clients |

> Alternative single-stack option: **Flutter** covers iOS, Android, Windows, macOS, and web from one codebase. Viable if the team prefers Dart and wants maximum code reuse; trade-off is less mature desktop tooling than Tauri.

**Hard rule:** business logic (pricing, credit math, cost/profit, fraud checks) stays on the **server**. Clients never compute credit balances or trust client-reported usage. This keeps all five clients thin and keeps security in one place.

---

## 3. Platform-by-Platform Requirements

### 3.1 iOS
- Language/stack: React Native or Flutter; StoreKit 2 for IAP.
- **Payments:** Apple IAP only for credits/subscriptions (billing spec §6.6).
- **Signing:** Apple Developer Program ($99/yr), App Store Connect, provisioning profiles, distribution certificate.
- **Universal Links** (see §7.3) for opening `https://app.yourdomain.com/...` directly in the app.
- Push: APNs (Apple Push Notification service) for the notification events (recharge success, credits low, etc.).
- Privacy: App Store **Privacy Nutrition Label** + `NSPrivacyManifest` declaring data collection (email, purchases, usage) — must match your privacy policy exactly.
- Sign in with Apple **required** if you offer any third-party social login.

### 3.2 Android
- Stack: same React Native / Flutter codebase.
- **Payments:** Google Play Billing Library only for credits/subscriptions.
- **Signing:** Google Play Developer account ($25 one-time); app signed with an upload key, Play manages the app signing key (Play App Signing).
- **App Links** (see §7.3) for `https://` deep links via `assetlinks.json`.
- Push: Firebase Cloud Messaging (FCM).
- Privacy: Play Console **Data Safety** form must match your privacy policy.

### 3.3 Windows
- Stack: Tauri or Electron desktop shell.
- **Distribution options:**
  - **Direct download** (`.msi`/`.exe` installer) from your domain — no store cut, use Stripe/etc. directly for payments.
  - **Microsoft Store** — subject to MS Store policies; MS Store IAP optional (lower fees than Apple/Google).
- **Code signing:** Authenticode certificate (OV or EV) to avoid SmartScreen warnings. EV certs give instant reputation.
- Auto-update: Tauri updater / Electron autoUpdater pulling signed releases from `https://downloads.yourdomain.com`.

### 3.4 macOS
- Stack: same Tauri/Electron shell as Windows.
- **Distribution options:**
  - **Direct download** (`.dmg`) — must be **notarized** by Apple (`notarytool`) and signed with a Developer ID certificate, or Gatekeeper blocks it. Payments: Stripe/etc. directly (no Apple cut).
  - **Mac App Store** — requires Apple IAP for digital goods and sandboxing.
- **Signing:** Apple Developer ID Application certificate + notarization + stapling.
- Auto-update: Sparkle (native) or the Tauri/Electron updater, serving signed builds from your domain.

### 3.5 Shared client concerns (all platforms)
- **Auth:** OAuth2/OIDC + short-lived JWT (per billing spec §9.2). Tokens stored in the OS secure store: iOS Keychain, Android Keystore/EncryptedSharedPreferences, Windows DPAPI/Credential Manager, macOS Keychain. **Never** in plain files or localStorage on desktop.
- **Certificate pinning** on mobile for the API domain to resist MITM.
- **Offline behavior:** clients cache read-only data (last known balance, catalog) but must re-fetch and reconcile balance from the server before allowing any spend.
- **Force-update mechanism:** server returns a minimum-supported-client-version; clients below it must update (protects against exploited old builds).

---

## 4. Backend Impact of Going Multi-Platform

The backend from the billing spec is largely unchanged. Additions:

- `payments.gateway` enum gains `apple_iap`, `google_play_billing` (already noted in billing spec §6.6).
- New webhook/notification receivers:
  - `POST /v1/payments/webhook/apple` — App Store Server Notifications v2 (verify JWS).
  - `POST /v1/payments/webhook/google` — Play Real-time Developer Notifications (Pub/Sub push, verify + call Play Developer API to confirm).
- New table `client_releases` (`platform, version, min_supported, download_url, signed_hash, released_at`) to drive force-update and desktop auto-update feeds.
- Device/session table gains `platform` + `device_fingerprint` columns (feeds the fraud engine — e.g., many "accounts" from one device).
- Push-token registry (`user_id, platform, push_token, provider(apns/fcm)`) for notifications.

---

## 5. Domain Configuration

### 5.1 Recommended subdomain layout
| Subdomain | Purpose |
|---|---|
| `yourdomain.com` / `www.yourdomain.com` | marketing site |
| `app.yourdomain.com` | web application |
| `api.yourdomain.com` | backend API (all clients call this) |
| `admin.yourdomain.com` | Super Admin panel (optionally IP-restricted per billing spec §9.2) |
| `cdn.yourdomain.com` | static assets |
| `downloads.yourdomain.com` | desktop installers + auto-update feeds |
| `webhooks.yourdomain.com` | (optional) isolate gateway/store webhook receivers |

Keeping the API on its own subdomain lets you scale, cache, and firewall it independently and simplifies certificate pinning on mobile.

### 5.2 DNS records
| Record | Host | Points to | Purpose |
|---|---|---|---|
| A / AAAA | `api` | load balancer IP(s) | API |
| CNAME | `app`, `admin`, `cdn` | LB / CDN hostname | apps & assets |
| CNAME | `www` | apex/CDN | marketing |
| CAA | apex | your CA (e.g., `letsencrypt.org`) | restrict who can issue certs |
| MX | apex | mail provider | email |
| TXT (SPF) | apex | `v=spf1 include:...` | email auth |
| TXT (DKIM) | selector._domainkey | provider key | email auth |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=quarantine; rua=...` | email auth |

- Use a DNS provider with **DNSSEC** enabled to prevent DNS spoofing.
- Prefer a managed/anycast DNS (Cloudflare, Route 53) for resilience.

### 5.3 TLS / HTTPS
- **TLS 1.3** on every subdomain; redirect all HTTP → HTTPS.
- **HSTS** with `includeSubDomains` and `preload`, and submit the domain to the HSTS preload list.
- Certificates: automated issuance/renewal via **ACME (Let's Encrypt)** or the CDN's managed certs; wildcard cert (`*.yourdomain.com`) or per-subdomain certs.
- Set a **CAA** DNS record so only your chosen CA can issue certs for the domain.
- OCSP stapling enabled at the edge.

### 5.4 Email domain (for the notification system)
The billing spec's notifications (recharge success, invoice ready, payment reminder, etc.) go out over email. To land in inboxes and not be spoofable:
- Configure **SPF, DKIM, and DMARC** (records above) with a transactional email provider (SES, Postmark, SendGrid).
- Start DMARC at `p=none` for monitoring, then tighten to `quarantine`/`reject`.
- Use a dedicated sending subdomain (e.g., `mail.yourdomain.com`) to protect apex reputation.

---

## 6. App ↔ Domain Association (Deep Links / Universal Links)

So that links like `https://app.yourdomain.com/invoice/123` open in the installed app (and payment/return flows work), each platform needs an association file served from your domain over HTTPS.

### 6.1 iOS — Universal Links
Serve at `https://yourdomain.com/.well-known/apple-app-site-association` (JSON, **no** `.json` extension, `Content-Type: application/json`, no redirects):
```json
{
  "applinks": {
    "apps": [],
    "details": [
      { "appID": "TEAMID.com.yourcompany.creatorforce", "paths": ["*"] }
    ]
  }
}
```

### 6.2 Android — App Links
Serve at `https://yourdomain.com/.well-known/assetlinks.json`:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.yourcompany.creatorforce",
    "sha256_cert_fingerprints": ["<your signing cert SHA-256>"]
  }
}]
```

### 6.3 Desktop custom protocol (optional)
Register a scheme like `creatorforce://` for desktop deep-linking (e.g., returning from an external browser-based OAuth or web-checkout flow). Handle it in Tauri/Electron.

### 6.4 Why this matters for payments
On desktop/web where you use Stripe-hosted checkout, the return URL must be an allow-listed HTTPS URL on your domain (`https://app.yourdomain.com/payment/return`) that then deep-links/redirects back into the app. On mobile, IAP is in-app so no redirect needed — another reason the flows differ per platform.

---

## 7. CI/CD & Release Pipeline (per platform)

| Platform | Build artifact | Signing | Distribution |
|---|---|---|---|
| iOS | `.ipa` | Xcode Cloud / Fastlane + distribution cert | TestFlight → App Store |
| Android | `.aab` | Play App Signing + upload key | Internal → Production track |
| Windows | `.msi`/`.exe` | Authenticode (OV/EV) | `downloads.yourdomain.com` and/or MS Store |
| macOS | `.dmg`/`.pkg` | Developer ID + notarize + staple | `downloads.yourdomain.com` and/or Mac App Store |
| Web | container/static bundle | — | your hosting/CDN |

- Store **signing keys and certificates in the secrets manager / secure CI vault** (consistent with billing spec §9.9) — never in the repo.
- Each release records `platform, version, signed_hash` in `client_releases` for auto-update integrity verification (desktop clients verify the hash before applying an update).

---

## 8. Security Additions for Native Clients

Extends billing spec §9:
- **No secrets in the app binary.** Mobile/desktop binaries are shippable to attackers — they can be decompiled. API keys, gateway secrets, and encryption keys stay server-side; the client only ever holds a user's short-lived token.
- **Certificate pinning** for `api.yourdomain.com` on mobile.
- **Jailbreak/root detection** (advisory, not sole defense) to raise fraud-risk score.
- **Receipt/purchase validation is server-side only.** Never trust a client that says "the user paid" — always validate the Apple/Google receipt against Apple's/Google's servers before crediting the wallet. This is the #1 mobile IAP fraud vector.
- **Deep-link input is untrusted:** validate and sanitize any parameters arriving via universal link / custom protocol before acting on them.

---

## 9. Acceptance Criteria (Platform & Domain)

- [ ] One shared API contract serves web, iOS, Android, Windows, macOS.
- [ ] Credit balance is identical and interchangeable across all platforms for the same account.
- [ ] iOS/Android credit purchases go through Apple IAP / Google Play Billing and are **server-side validated** before crediting.
- [ ] Desktop builds are code-signed (Authenticode) / signed + notarized (macOS) with no security warnings on install.
- [ ] `api`, `app`, `admin`, `cdn`, `downloads` subdomains resolve over TLS 1.3 with HSTS and valid auto-renewing certificates.
- [ ] CAA + DNSSEC + SPF/DKIM/DMARC configured on the domain.
- [ ] Universal Links (iOS) and App Links (Android) open in-app from `https://` URLs.
- [ ] Force-update mechanism blocks clients below the minimum supported version.
- [ ] No secrets/keys present in any shipped client binary.

---

## 10. Future Enhancements

- Alternative external-billing on mobile in regions where the DMA/court rulings permit it (adapter already abstracted).
- Windows/Mac distribution via package managers (winget, Homebrew) in addition to direct download.
- Multi-region domain routing (GeoDNS) aligned with the data-residency requirement in the billing spec.

---

*End of specification.*
