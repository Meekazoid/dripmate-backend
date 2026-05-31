# dripmate API Documentation v5.5

## Base URL
```
Production: https://dripmate-backend-production.up.railway.app
Development: http://localhost:3000
```

## Authentication

Dripmate uses token-based authentication with device binding. After registration, include your token and deviceId in requests.

### Authentication Methods (v5.0+)

**Recommended (Secure):** Use HTTP headers
```
Authorization: Bearer YOUR_TOKEN
X-Device-ID: YOUR_DEVICE_ID
```

**Backward Compatible:** Query parameters or request body
- Query: `?token=YOUR_TOKEN&deviceId=YOUR_DEVICE_ID`
- Body: `{ "token": "YOUR_TOKEN", "deviceId": "YOUR_DEVICE_ID" }`

**Note:** Headers are preferred as they prevent token exposure in server logs, browser history, and proxy logs. The API will check headers first, then fall back to body/query parameters for backward compatibility.

---

## Endpoints

### 1. Health Check

**GET** `/api/health`

Check if the API is running.

**Request:**
```bash
curl https://your-backend.railway.app/api/health
```

**Response:**
```json
{
  "status": "ok",
  "app": "dripmate",
  "version": "5.0.0-water-hardness",
  "timestamp": "2026-02-10T10:00:00.000Z",
  "uptime": 12345.67,
  "environment": "production"
}
```

**Status Codes:**
- `200` - API is healthy

---

### 2. Validate Token

**GET** `/api/auth/validate`

Validate a user token and device binding.

**Request (Headers - Recommended):**
```bash
curl -X GET https://your-backend.railway.app/api/auth/validate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Device-ID: YOUR_DEVICE_ID"
```

**Request (Query Parameters - Backward Compatible):**
```bash
curl "https://your-backend.railway.app/api/auth/validate?token=YOUR_TOKEN&deviceId=YOUR_DEVICE_ID"
```

**Success Response (200):**
```json
{
  "success": true,
  "valid": true,
  "isFirstLogin": false,
  "user": {
    "id": 1,
    "username": "johndoe",
    "email": "john@example.com",
    "deviceId": "device-abc123",
    "grinderPreference": "fellow_gen2",
    "methodPreference": "v60",
    "waterHardness": 12.5,
    "createdAt": "2026-02-06T10:00:00.000Z"
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "valid": false,
  "error": "Invalid token"
}
```

---

### 3. Get Grinder Preference

**GET** `/api/user/grinder`

Retrieve the user's preferred grinder setting.

**Request (Headers - Recommended):**
```bash
curl -X GET https://your-backend.railway.app/api/user/grinder \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Device-ID: YOUR_DEVICE_ID"
```

**Request (Query Parameters - Backward Compatible):**
```bash
curl "https://your-backend.railway.app/api/user/grinder?token=YOUR_TOKEN&deviceId=YOUR_DEVICE_ID"
```

**Success Response (200):**
```json
{
  "success": true,
  "grinder": "fellow"
}
```

**Possible Values:**
- `"comandante_mk4"` - Comandante C40 MK4
- `"comandante_mk3"` - Comandante C40 MK3
- `"fellow_gen2"` - Fellow Ode Gen 2 (default)
- `"fellow_gen1"` - Fellow Ode Gen 1
- `"timemore_s3"` - Timemore Chestnut S3
- `"timemore_c2"` - Timemore Chestnut C2
- `"1zpresso"` - 1Zpresso
- `"baratza"` - Baratza Encore

**Error Response (401):**
```json
{
  "success": false,
  "error": "Invalid token"
}
```

---

### 4. Update Grinder Preference

**POST** `/api/user/grinder`

Update the user's preferred grinder setting.

**Request (Headers - Recommended):**
```bash
curl -X POST https://your-backend.railway.app/api/user/grinder \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Device-ID: YOUR_DEVICE_ID" \
  -d '{
    "grinder": "comandante"
  }'
```

**Request (Body - Backward Compatible):**
```bash
curl -X POST https://your-backend.railway.app/api/user/grinder \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "deviceId": "YOUR_DEVICE_ID",
    "grinder": "comandante"
  }'
```

**Request Body (Headers):**
```json
{
  "grinder": "fellow"
}
```

**Request Body (Backward Compatible):**
```json
{
  "token": "YOUR_TOKEN",
  "deviceId": "YOUR_DEVICE_ID",
  "grinder": "fellow"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "grinder": "fellow"
}
```

**Error Responses:**

**400 - Invalid Grinder:**
```json
{
  "success": false,
  "error": "Valid grinder required (fellow, comandante, or timemore)"
}
```

**401 - Invalid Token:**
```json
{
  "success": false,
  "error": "Invalid token"
}
```

**403 - Device Mismatch:**
```json
{
  "success": false,
  "error": "This token is already bound to another device"
}
```

---

### 5. Get Water Hardness

**GET** `/api/user/water-hardness`

Retrieve the user's water hardness setting.

**Request (Headers - Recommended):**
```bash
curl -X GET https://your-backend.railway.app/api/user/water-hardness \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Device-ID: YOUR_DEVICE_ID"
```

**Request (Query Parameters - Backward Compatible):**
```bash
curl "https://your-backend.railway.app/api/user/water-hardness?token=YOUR_TOKEN&deviceId=YOUR_DEVICE_ID"
```

**Success Response (200):**
```json
{
  "success": true,
  "waterHardness": 12.5
}
```

**Note:** Returns `null` if not set.

---

### 6. Update Water Hardness

**POST** `/api/user/water-hardness`

Update the user's water hardness setting (in °dH - German degrees of hardness).

**Request (Headers - Recommended):**
```bash
curl -X POST https://your-backend.railway.app/api/user/water-hardness \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Device-ID: YOUR_DEVICE_ID" \
  -d '{
    "waterHardness": 12.5
  }'
```

**Request (Body - Backward Compatible):**
```bash
curl -X POST https://your-backend.railway.app/api/user/water-hardness \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "deviceId": "YOUR_DEVICE_ID",
    "waterHardness": 12.5
  }'
```

**Request Body (Headers):**
```json
{
  "waterHardness": 12.5
}
```

**Request Body (Backward Compatible):**
```json
{
  "token": "YOUR_TOKEN",
  "deviceId": "YOUR_DEVICE_ID",
  "waterHardness": 12.5
}
```

**Success Response (200):**
```json
{
  "success": true,
  "waterHardness": 12.5
}
```

**Error Responses:**

**400 - Invalid Water Hardness:**
```json
{
  "success": false,
  "error": "Valid water hardness required (0-50 °dH)"
}
```

**401 - Invalid Token:**
```json
{
  "success": false,
  "error": "Invalid token"
}
```

**403 - Device Mismatch:**
```json
{
  "success": false,
  "error": "This token is already bound to another device"
}
```

---

### 7. Get User's Coffees

**GET** `/api/coffees`

Retrieve all coffees for a user.

**Request (Headers - Recommended):**
```bash
curl -X GET https://your-backend.railway.app/api/coffees \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Device-ID: YOUR_DEVICE_ID"
```

**Request (Query Parameters - Backward Compatible):**
```bash
curl "https://your-backend.railway.app/api/coffees?token=YOUR_TOKEN&deviceId=YOUR_DEVICE_ID"
```

**Success Response (200):**
```json
{
  "success": true,
  "coffees": [
    {
      "id": 1,
      "name": "Finca Milán",
      "origin": "Colombia, Calarcá",
      "process": "washed",
      "cultivar": "Caturra",
      "altitude": "1650",
      "roaster": "Local Roasters",
      "tastingNotes": "Watermelon, Lemonade",
      "addedDate": "2026-02-06T10:00:00.000Z",
      "savedAt": "2026-02-06T10:00:00.000Z"
    }
  ]
}
```

---

### 8. Save User's Coffees

**POST** `/api/coffees`

Save/update all coffees for a user (replaces existing). **Now uses database transactions** to prevent data loss if save operation fails.

**Request (Headers - Recommended):**
```bash
curl -X POST https://your-backend.railway.app/api/coffees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Device-ID: YOUR_DEVICE_ID" \
  -d '{
    "coffees": [
      {
        "name": "Finca Milán",
        "origin": "Colombia, Calarcá",
        "process": "washed",
        "cultivar": "Caturra",
        "altitude": "1650",
        "roaster": "Local Roasters",
        "tastingNotes": "Watermelon, Lemonade",
        "addedDate": "2026-02-06T10:00:00.000Z"
      }
    ]
  }'
```

**Request (Body - Backward Compatible):**
```bash
curl -X POST https://your-backend.railway.app/api/coffees \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "deviceId": "YOUR_DEVICE_ID",
    "coffees": [
      {
        "name": "Finca Milán",
        "origin": "Colombia, Calarcá",
        "process": "washed",
        "cultivar": "Caturra",
        "altitude": "1650",
        "roaster": "Local Roasters",
        "tastingNotes": "Watermelon, Lemonade",
        "addedDate": "2026-02-06T10:00:00.000Z"
      }
    ]
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "saved": 1
}
```

**Note:** This endpoint now uses database transactions. If any save operation fails, all changes are rolled back to prevent data loss.

---

### 9. Analyze Coffee Image

**POST** `/api/analyze-coffee`

Analyze a coffee bag image using Claude AI.

⚠️ **Rate Limited:** 10 requests per hour per IP

**Request (Headers - Recommended):**
```bash
curl -X POST https://your-backend.railway.app/api/analyze-coffee \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Device-ID: YOUR_DEVICE_ID" \
  -d '{
    "imageData": "BASE64_ENCODED_IMAGE_DATA",
    "mediaType": "image/jpeg"
  }'
```

**Request (Body - Backward Compatible):**
```bash
curl -X POST https://your-backend.railway.app/api/analyze-coffee \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "deviceId": "YOUR_DEVICE_ID",
    "imageData": "BASE64_ENCODED_IMAGE_DATA",
    "mediaType": "image/jpeg"
  }'
```

**Request Body (Headers):**
```json
{
  "imageData": "/9j/4AAQSkZJRg...",
  "mediaType": "image/jpeg"
}
```

**Request Body (Backward Compatible):**
```json
{
  "token": "YOUR_TOKEN",
  "deviceId": "YOUR_DEVICE_ID",
  "imageData": "/9j/4AAQSkZJRg...",
  "mediaType": "image/jpeg"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "name": "Finca Milán",
    "origin": "Colombia, Calarcá",
    "process": "washed",
    "cultivar": "Caturra",
    "altitude": "1650",
    "roaster": "Local Roasters",
    "tastingNotes": "Watermelon, Lemonade",
    "addedDate": "2026-02-06T10:00:00.000Z"
  }
}
```

---

### 10. Self-Service Beta Signup

**POST** `/api/auth/signup`

Public endpoint — no authentication required. Handles self-service onboarding with a configurable beta cap and automatic waitlist. This is the **primary** signup entry point; `POST /api/auth/register` continues to work for backward compatibility but only accepts already-whitelisted emails.

**Request Body:**
```json
{ "email": "user@example.com" }
```

**Response — spot available (or already whitelisted):**
```json
{ "status": "invited", "resent": false }
```
`resent: true` when the email was already whitelisted and a registration already existed (token re-sent).

**Response — cap reached, email added to waitlist:**
```json
{ "status": "waitlisted" }
```
A waitlist confirmation email is sent via Resend.

**Response — cap reached, email was already on waitlist:**
```json
{ "status": "already_waitlisted" }
```
No email is sent.

**Error Response (400):**
```json
{ "success": false, "error": "Invalid email address" }
```

**How it works:**
1. If the email is already on the whitelist → issue or re-send BREW token (same as `/register`).
2. Otherwise, read `BETA_INVITE_CAP` (default 200) and `COUNT(*) FROM whitelist` inside a single transaction.
   - If count < cap → atomically add to `whitelist` (`invite_source='self_signup'`) + create `registrations` row, then send token email.
   - If count ≥ cap → add to `waitlist_emails` (if not already present) + send waitlist confirmation email.

---

### 11. Beta Registration (Backward-Compatible)

**POST** `/api/auth/register`

Original registration endpoint — still active for backward compatibility. Accepts whitelisted emails only; returns `{ success: true, resent: boolean }`. Returns `403 { error: 'not_whitelisted' }` if the email is not on the whitelist. New integrations should use `/api/auth/signup` instead.

---

### 12. List Waitlist

**GET** `/api/admin/waitlist`

**Auth:** `X-Admin-Token: <session-token>` (obtained via `POST /api/admin/login`)

Returns all waitlist entries ordered by sign-up time.

**Response (200):**
```json
{
  "success": true,
  "entries": [
    {
      "email": "user@example.com",
      "note": "",
      "created_at": "2026-05-31T10:00:00.000Z",
      "promoted": false,
      "promoted_at": null
    }
  ]
}
```

---

### 13. Promote Waitlist Entry

**POST** `/api/admin/waitlist/promote`

**Auth:** `X-Admin-Token: <session-token>`

Moves an entry from the waitlist to the whitelist and immediately issues a BREW token + sends the access email. Idempotent — if the email is already whitelisted or has a registration, the existing token is re-sent.

**Request Body:**
```json
{ "email": "user@example.com" }
```

**Response (200):**
```json
{ "success": true, "resent": false }
```
`resent: true` if a registration already existed (token re-sent rather than newly created).

**What it does (in order):**
1. Adds email to `whitelist` with `invite_source='admin'` (no-op if already present).
2. Issues or re-sends a BREW token via the shared `issueOrResendToken` helper.
3. Sets `promoted=true` + `promoted_at=now` on the `waitlist_emails` row.

---

### 14. Full Account Purge

**DELETE** `/api/admin/purge`

**Auth:** `X-Admin-Token: <session-token>`

⚠️ **Irreversible.** Atomically removes a person from every relevant table in one transaction. Frees a beta slot. Distinct from `DELETE /api/admin/whitelist/:id`, which only removes the whitelist entry.

**Request Body:**
```json
{ "email": "user@example.com" }
```

**Response (200):**
```json
{
  "success": true,
  "email": "user@example.com",
  "hadAccount": true,
  "deletedFrom": ["users", "coffees", "magic_link_tokens", "ai_scan_usage_daily", "registrations", "whitelist"]
}
```

`hadAccount: false` example (invited but never activated):
```json
{
  "success": true,
  "email": "user@example.com",
  "hadAccount": false,
  "deletedFrom": ["registrations", "whitelist"]
}
```

**`deletedFrom` values:**
- `users` — account row deleted (present only when `hadAccount: true`)
- `coffees` — cascaded automatically from `users` delete
- `magic_link_tokens` — cascaded automatically from `users` delete
- `ai_scan_usage_daily` — cascaded automatically from `users` delete
- `registrations` — deleted explicitly (no FK to users)
- `whitelist` — deleted explicitly (no FK to users)
- `waitlist_emails` — deleted explicitly, only if a waitlist entry existed

**Error Response (400):**
```json
{ "success": false, "error": "Invalid email address" }
```

---

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| General API | 100 requests | 15 minutes |
| AI Analysis | 10 requests | 1 hour |

---

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request — invalid input |
| 401 | Unauthorized — invalid/missing token |
| 403 | Forbidden — device mismatch or daily limit reached |
| 404 | Not Found — endpoint or resource doesn't exist |
| 409 | Conflict — username or email already exists |
| 422 | Unprocessable — image not a coffee bag, or AI could not process |
| 429 | Too Many Requests — rate limit exceeded |
| 500 | Internal Server Error |
| 502 | Bad Gateway — upstream AI provider unavailable |
| 503 | Service Unavailable — AI auth error or provider overloaded |
| 504 | Gateway Timeout — AI analysis timed out |

### AI Analysis Error Codes (v5.4+)

The `POST /api/analyze-coffee` endpoint returns an `errorCode` field on failure:

| `errorCode` | HTTP Status | Meaning |
|-------------|-------------|---------|
| `DAILY_SCAN_LIMIT_REACHED` | 403 | User has used all 5 daily scans |
| `AI_AUTH_ERROR` | 503 | Anthropic API key invalid |
| `AI_RATE_LIMIT` | 429 | Anthropic rate limit hit |
| `AI_OVERLOADED` | 503 | Anthropic service overloaded |
| `AI_BAD_REQUEST` | 422 | Image too large or invalid format |
| `AI_UPSTREAM_ERROR` | 502 | Anthropic unreachable / network failure |
| `AI_TIMEOUT` | 504 | Request to Anthropic timed out |
| `AI_INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Examples

### JavaScript/Fetch

```javascript
// Get grinder preference
const getGrinderPreference = async (token, deviceId) => {
  const response = await fetch('https://dripmate-backend-production.up.railway.app/api/user/grinder', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-ID': deviceId
    }
  });
  return response.json();
};

// Update grinder preference
const updateGrinderPreference = async (token, deviceId, grinder) => {
  const response = await fetch('https://dripmate-backend-production.up.railway.app/api/user/grinder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Device-ID': deviceId
    },
    body: JSON.stringify({ grinder })
  });
  return response.json();
};

// Get coffees
const getCoffees = async (token, deviceId) => {
  const response = await fetch('https://dripmate-backend-production.up.railway.app/api/coffees', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Device-ID': deviceId
    }
  });
  return response.json();
};
```

### Python

```python
import requests

BASE = 'https://dripmate-backend-production.up.railway.app'
HEADERS = lambda token, device_id: {
    'Authorization': f'Bearer {token}',
    'X-Device-ID': device_id
}

# Get grinder preference
def get_grinder_preference(token, device_id):
    response = requests.get(f'{BASE}/api/user/grinder', headers=HEADERS(token, device_id))
    return response.json()

# Update grinder preference
def update_grinder_preference(token, device_id, grinder):
    response = requests.post(
        f'{BASE}/api/user/grinder',
        headers={**HEADERS(token, device_id), 'Content-Type': 'application/json'},
        json={'grinder': grinder}
    )
    return response.json()
```

---

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id                  SERIAL PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE,
    token               TEXT NOT NULL UNIQUE,
    email               TEXT,
    device_id           TEXT,
    device_info         TEXT,
    grinder_preference  TEXT DEFAULT 'fellow_gen2',
    method_preference   VARCHAR(20) DEFAULT 'v60',
    water_hardness      DECIMAL(4,1) DEFAULT NULL,
    last_login_at       TIMESTAMP,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Coffees Table
```sql
CREATE TABLE coffees (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    coffee_uid TEXT NOT NULL,
    data       TEXT NOT NULL,
    method     VARCHAR(20) DEFAULT 'v60',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, coffee_uid)
);
```

### Additional Tables

**`whitelist`** — beta access email whitelist

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL / AUTOINCREMENT | PK |
| `email` | TEXT UNIQUE NOT NULL | |
| `name` | TEXT DEFAULT '' | |
| `website` | TEXT DEFAULT '' | |
| `note` | TEXT DEFAULT '' | |
| `added_at` | TIMESTAMP | |
| `invite_source` | TEXT DEFAULT 'admin' | `'admin'` or `'self_signup'` |
| `invited_by` | INTEGER NULL | Reserved for future invite-code feature |

**`registrations`** — pending BREW-XXXXXX tokens

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL / AUTOINCREMENT | PK |
| `email` | TEXT UNIQUE NOT NULL | |
| `token` | TEXT UNIQUE NOT NULL | Format: `BREW-XXXXXX` |
| `used` | BOOLEAN DEFAULT FALSE | Set to true after first login |
| `created_at` | TIMESTAMP | |

**`waitlist_emails`** — emails waiting for a beta slot (v5.5+)

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL / AUTOINCREMENT | PK |
| `email` | TEXT UNIQUE NOT NULL | |
| `note` | TEXT DEFAULT '' | |
| `created_at` | TIMESTAMP | |
| `promoted` | BOOLEAN DEFAULT FALSE | Set to true when promoted to whitelist |
| `promoted_at` | TIMESTAMP NULL | Timestamp of promotion |

**`magic_link_tokens`** — one-time login link tokens (15 min expiry)

**`ai_scan_usage_daily`** — per-user daily AI scan counter

---

## Grinder Values

The `grinder_preference` field accepts the following values:

| Value | Description |
|-------|-------------|
| `fellow_gen2` | Fellow Ode Gen 2 (default) |
| `fellow_gen1` | Fellow Ode Gen 1 |
| `comandante_mk4` | Comandante C40 MK4 |
| `comandante_mk3` | Comandante C40 MK3 |
| `timemore_s3` | Timemore Chestnut S3 |
| `timemore_c2` | Timemore Chestnut C2 |
| `1zpresso` | 1Zpresso |
| `baratza` | Baratza Encore |

## Method Values

The `method_preference` field accepts: `v60`, `chemex`, `aeropress`.

---

## Environment Variables

Required for deployment:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-xxxxx
RESEND_API_KEY=re_xxxxx

# Required in production
DATABASE_URL=postgresql://user:pass@host:5432/db
ALLOWED_ORIGINS=https://dripmate.app
FRONTEND_URL=https://dripmate.app

# Optional
NODE_ENV=production
DATABASE_PATH=./db/dripmate.db   # SQLite only (development)
PORT=3000
ADMIN_PASSWORD=your-admin-secret  # For admin whitelist/waitlist endpoints
BETA_INVITE_CAP=200               # Max self-signup spots before waitlist; default 200
```

---

## Migration Guide (v5.0 → v5.4)

All schema migrations run automatically on server startup via `initDatabase()`. No manual SQL required. Key changes:
- Transactions now use `withTransaction()` instead of `beginTransaction()`/`commit()`/`rollback()`
- PATCH `/api/brews/:id` uses direct O(1) update instead of full-rewrite
- AI analysis returns differentiated `errorCode` values
- `POST /api/auth/email` now requires device binding (both `Authorization` and `X-Device-ID` headers)

---

## Support

For issues or questions:
- GitHub: [dripmate-backend](https://github.com/Meekazoid/dripmate-backend)

**Version:** 5.5.0  
**Last Updated:** May 31, 2026
