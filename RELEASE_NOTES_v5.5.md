# dripmate backend - v5.5 Beta Onboarding & Waitlist

**Released:** May 31, 2026

## Overview

This update adds self-service beta onboarding with a configurable invite cap, a persistent waitlist, admin tools to promote waitlisted users and fully purge accounts, and a shared invite-helper module that consolidates token generation and email sending.

---

## ✨ Feature 1: Self-Service Signup (`POST /api/auth/signup`)

### Problem
The previous flow required an admin to manually add every email to the whitelist before the user could request a token via `POST /api/auth/register`. Emails submitted by non-whitelisted users were discarded with a `403 not_whitelisted` response.

### Solution
New public endpoint `POST /api/auth/signup` handles the entire onboarding flow automatically:

1. **Already whitelisted** → issue or idempotently re-send the BREW token.
2. **Under cap** → atomically add email to `whitelist` (`invite_source='self_signup'`) + create registration + send token email.
3. **Cap reached, new email** → add to `waitlist_emails` + send waitlist confirmation email.
4. **Cap reached, already on waitlist** → return `{ status: 'already_waitlisted' }`, send nothing.

The cap is controlled by `BETA_INVITE_CAP` (default 200). The count-and-insert uses `withTransaction()` so concurrent requests cannot overshoot the cap.

**Responses:**
```json
{ "status": "invited",          "resent": false }   // new slot claimed
{ "status": "invited",          "resent": true  }   // already whitelisted, token re-sent
{ "status": "waitlisted"                        }   // cap reached, added to waitlist
{ "status": "already_waitlisted"                }   // cap reached, already waiting
```

`POST /api/auth/register` continues to work unchanged for backward compatibility.

---

## ✨ Feature 2: Waitlist Management (Admin)

### New Endpoints

**`GET /api/admin/waitlist`** — Lists all `waitlist_emails` rows (email, note, created_at, promoted, promoted_at), ordered by sign-up time.

**`POST /api/admin/waitlist/promote`** — Promotes one entry:
1. Adds email to `whitelist` with `invite_source='admin'` (idempotent).
2. Issues or re-sends a BREW token via `issueOrResendToken`.
3. Sets `promoted=true`, `promoted_at=NOW()` on the waitlist row.

Both endpoints use the existing `adminAuth` middleware (`X-Admin-Token` header, 8-hour session).

---

## ✨ Feature 3: Full Account Purge (`DELETE /api/admin/purge`)

### Problem
The existing `DELETE /api/admin/whitelist/:id` only removed the whitelist row. If a user had already activated their account, their `users` row (and all associated data) remained, and they could still log in.

### Solution
New admin endpoint `DELETE /api/admin/purge` accepts `{ email }` and removes the person from every table in one atomic transaction:

| Table | Deletion method |
|-------|----------------|
| `users` | Explicit DELETE WHERE email (cascades coffees, magic_link_tokens, ai_scan_usage_daily) |
| `registrations` | Explicit DELETE WHERE email |
| `whitelist` | Explicit DELETE WHERE email |
| `waitlist_emails` | Explicit DELETE WHERE email (no-op if not present) |

Returns `{ hadAccount: boolean, deletedFrom: string[] }` so the caller knows what was actually removed.

The existing `DELETE /api/admin/whitelist/:id` is unchanged.

---

## 🔧 Refactor: `utils/inviteHelper.js`

Extracted the three shared helpers that were previously duplicated (or would have been duplicated) across `register.js` and `signup.js`:

| Export | Description |
|--------|-------------|
| `generateUniqueToken()` | Generates a collision-free `BREW-XXXXXX` token |
| `sendTokenMail(email, token)` | Sends the access token email via Resend (10 s timeout) |
| `issueOrResendToken(email)` | Idempotent: re-sends existing token or creates + sends new one |

`routes/register.js` now imports from `inviteHelper` instead of defining its own copies.

---

## 🗄️ Database Changes

All migrations are idempotent and run automatically on startup.

### New table: `waitlist_emails`
```sql
CREATE TABLE IF NOT EXISTS waitlist_emails (
    id          SERIAL PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    note        TEXT DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    promoted    BOOLEAN DEFAULT FALSE,
    promoted_at TIMESTAMP NULL
);
```

### New columns on `whitelist` (future-proofing, no logic yet)
```sql
ALTER TABLE whitelist ADD COLUMN IF NOT EXISTS invite_source TEXT DEFAULT 'admin';
ALTER TABLE whitelist ADD COLUMN IF NOT EXISTS invited_by    INTEGER NULL;
```

### New index
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_whitelist_email ON whitelist(email);
```

### New `queries` methods
`countWhitelist()`, `addToWaitlist(email, note)`, `getWaitlistEmail(email)`, `getWaitlistWithStatus()`, `markWaitlistPromoted(email)`, `purgeUserByEmail(email)`

`addToWhitelist` gains an optional fifth parameter `inviteSource` (default `'admin'`).

---

## 📧 Email Changes (`utils/emailTemplate.js`)

Added `buildWaitlistEmail(email)` — branded HTML email confirming waitlist placement. Style matches the existing `buildTokenEmail` template (same brand header, legal footer with Impressum / Datenschutz links).

---

## 🖥️ Frontend Changes

**`register.html`** — Form now calls `POST /api/auth/signup` instead of `/api/auth/register`. Handles all four response states with appropriate copy.

**`admin.html`** — New sections:
- Counter line: `X / 200 invited · Y on waitlist`
- Waitlist table with per-row **Einladen** (promote) button
- Per-whitelist-row **Komplett entfernen** (purge) button with double confirmation; visually distinct from the existing whitelist-only **Entfernen** button

---

## 🔄 Backward Compatibility

- ✅ `POST /api/auth/register` unchanged
- ✅ `DELETE /api/admin/whitelist/:id` unchanged
- ✅ All existing admin endpoints unchanged
- ✅ `addToWhitelist` signature extended with optional 5th param — existing callers unaffected
- ✅ No breaking changes to any user-facing auth or coffee endpoints

---

## 📊 New Environment Variable

| Variable | Default | Description |
|----------|---------|-------------|
| `BETA_INVITE_CAP` | `200` | Max self-signup beta spots before waitlist |
