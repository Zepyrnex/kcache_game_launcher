# Kcache Backend & Features — AI Knowledge Base

> This file is the source of truth for backend design, auth, stats, game vault features, and future roadmap. Any AI working on Kcache should read this before implementing.

---

## 1. App Identity

- **App Name:** Kcache
- **Tagline:** GPU shader cache manager + game vault for PC gamers
- **Platform:** Windows 10/11 desktop app (Tauri v2)
- **Tech Stack:** React 18 + TypeScript + Tailwind CSS frontend, Rust + Tauri v2 + SQLite backend
- **Current Version:** v0.1.0
- **Repo Root:** `D:\kache shader manager\kcache_game_launcher\`

---

## 2. Current Architecture (What Already Exists)

### Frontend
- **Router:** React Router v6
- **Pages:**
  - `/` — Dashboard (Game Library, grid/details/table views)
  - `/trash` — Trash page (soft-deleted caches, restorable)
  - `/settings` — Settings page
- **Components:** AppShell (sidebar nav), GameGridView, GameDetailsView, CacheActions, GpuCachesModal, LibraryScannerDialog, MetadataEditorModal, ScanProgressBar
- **State:** `src/hooks/useScanner.ts` — global scanner state, `localStorage` cache
- **Types:** `src/types/index.ts`

### Backend (Rust)
- **Entry:** `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- **Commands:** `src-tauri/src/commands.rs`
- **Scanners:**
  - `scanners/steam_cache.rs` — scans `steamapps/shadercache/<app_id>/`
  - `scanners/dxvk.rs` — scans `.dxvk-cache` / `.vkd3d-cache`
  - `scanners/gpu_drivers.rs` — NVIDIA DXCache, GLCache, AMD, Intel
  - `scanners/exe_scanner.rs` — finds game executables via walkdir or Everything MFT
- **Libraries:** `libraries/steam.rs`, `libraries/epic.rs`, `libraries/gog.rs`
- **Matcher:** `matcher.rs` — fuzzy matches caches to games (confidence scoring)
- **DB:** `db.rs` — SQLite via `rusqlite` (bundled)
- **Backup:** `backup.rs` — zstd + tar backups
- **Everything:** `everything.rs` — integrates Everything HTTP API for fast MFT scans
- **Steam API:** `steam_api.rs` — fetches Steam app details, artwork, search
- **Tauri Config:** `src-tauri/tauri.conf.json`
- **Capabilities:** `src-tauri/capabilities/default.json`

### Key Data Models
- `CacheEntry` — individual shader cache file (path, size, last_modified, source, associated_game_id, confidence)
- `DetectedGame` — discovered game (id, name, platform, install_path, app_id, playtime, cover_url, etc.)
- `GameCacheGroup` — game + its caches + total size
- `ScanResult` — full scan output (games, caches, grouped, unmatched, totals)
- `BackupRecord` / `TrashRecord` — soft-delete and backup tracking
- `ScanFolder` / `DiscoveredProgram` — custom folder scanning

### Existing Features
- Auto-detect Steam, Epic, GOG games
- Custom folder scanning (MFT via Everything or walkdir fallback)
- Shader cache detection: Steam Pre-Cache, DXVK, VKD3D, NVIDIA DX/GL, AMD DX/DXC, Intel, Unity, Unreal
- GPU driver cache inspection modal
- Backup / Restore caches (zstd compressed tar)
- Soft delete to Trash with restore
- Playtime tracking (background, 0% CPU idle)
- Custom executable paths per game
- Steam metadata fetch (artwork, name, etc.)
- Fuzzy matcher for cache → game association
- Settings backed by SQLite (`get_settings`, `set_setting`)

---

## 3. Auth System Design

### Goal
Allow users to optionally sign in to sync their game vault across devices. Sign-in should be **skippable** — the app works fully in local/guest mode.

### Modes
1. **Guest / Local Mode (default)**
   - No login required
   - All data stored in local SQLite
   - Full app functionality
   - User can upgrade to account later from Settings

2. **Signed-In Mode**
   - User has an account
   - Game library, playtime, settings, and vault stats sync to cloud
   - Cross-device progress

### Auth Flow
```
App Start
  → Check stored session (localStorage / keychain)
    → If valid session → auto-login, fetch latest cloud data
    → If no session → show Login / Sign Up screen with "Skip" button
```

### Login Page UI
- Clean centered card
- Email + Password fields
- "Sign In" button
- "Create Account" link
- "Skip for now" ghost button at bottom → goes straight to Dashboard
- Toggle to show/hide password
- Error states inline (wrong password, network error)

### Sign Up Page UI
- Name + Email + Password + Confirm Password
- "Create Account" button
- "Already have an account? Sign In" link
- "Skip for now" button

### Session Storage
- Store JWT or session token in **localStorage** for simplicity, or OS keychain if Tauri secure storage plugin is available
- If token expires, auto-refresh or prompt re-login

### Logout
- Settings page: "Sign Out" button
- Clears local session, keeps local data intact

### Backend Auth Endpoints (to be designed)
| Endpoint | Method | Purpose |
|---|---|---|
| `/auth/signup` | POST | Create account |
| `/auth/login` | POST | Email + password → JWT |
| `/auth/refresh` | POST | Refresh expired token |
| `/auth/me` | GET | Get current user profile |
| `/auth/logout` | POST | Invalidate session |
| `/users/me` | GET | Get full user profile |
| `/users/me` | PATCH | Update profile (name, avatar, preferences) |

---

## 4. Game Vault Features (The "Vault" Concept)

### What is the Vault?
A personal game tracker that goes beyond shader cache management:
- Your library of installed/custom games
- Playtime tracking per game (session + lifetime)
- Completion progress (% played, last played, etc.)
- Cache management per game
- Custom notes/tags per game

### Playtime Tracking
- Already partially implemented (`get_game_playtime`)
- Background monitor tracks when a game is running
- Data stored per game: `playtime_seconds`, `last_played`, `is_running`, `session_duration_secs`
- In signed-in mode, sync playtime to cloud

### Game Library
- Shows all detected + custom-added games
- Per game: name, platform, install path, exe path, app_id, cover art, playtime, cache size, disk size
- Sort by: name, platform, size, last played, playtime
- Filter by: platform, has cache, no cache

### Suggested Games (Future)
- Based on installed library, suggest popular games user might like
- Could use Steam API recommendations or a curated list
- Show in a "Discover" or "Suggestions" tab

---

## 5. Stats & Progress Tracking

### Per-Game Stats
- Total playtime (hours/minutes)
- Session count
- Last played date
- Cache size history (trend over time)
- Install size

### Global Stats
- Total games in library
- Total playtime across all games
- Total shader cache size
- Total disk usage (games + caches)
- Most played game
- Recently played games
- Cache cleanup history (how much space freed over time)

### Dashboard Stats Cards
- Show on Dashboard top bar or dedicated Stats page
- "This week you played X hours across Y games"
- "You have Z GB of old shader caches that can be cleaned"

### Progress System
- Track user's "vault completion" — how many games they've launched, how much they've played
- Gamify lightly: "You've played 15 of your 42 library games"
- Show streaks: "Played 3 days in a row"
- Milestones: "First 100 hours", "10 games launched"

---

## 6. Data Sync Design (Cloud)

### Sync Strategy
- **Optimistic local writes** — everything saves to SQLite first
- **Background sync** — push local changes to cloud when online
- **Pull on login** — merge cloud data with local
- **Conflict resolution:** last-write-wins with timestamp, or manual merge for critical data

### Sync Scope
| Data | Sync Direction | Notes |
|---|---|---|
| Game library | Both | Add/remove/edit games |
| Playtime | Both | Session data pushes up |
| Settings | Both | Theme, layout, preferences |
| Cache metadata | Cloud only | Paths don't sync (machine-specific) |
| Trash/Backups | Local only | Machine-specific paths |
| Custom folders | Both | Add/remove scan folders |

### Offline Mode
- Full app functionality offline
- Queue changes for sync when back online
- Show sync status indicator in sidebar

---

## 7. Database Schema (SQLite — Local)

### Existing Tables (likely)
- `games` — DetectedGame data
- `caches` — CacheEntry data
- `scan_folders` — ScanFolder data
- `backups` — BackupRecord data
- `trash` — TrashRecord data
- `settings` — key-value settings

### New Tables Needed
```sql
-- Users (if we add local user profiles even before cloud)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  avatar_url TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  token TEXT,
  expires_at INTEGER,
  created_at INTEGER
);

-- Playtime sessions (granular tracking)
CREATE TABLE playtime_sessions (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  duration_secs INTEGER,
  synced INTEGER DEFAULT 0
);

-- Sync queue
CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT,
  entity_id TEXT,
  action TEXT, -- 'create', 'update', 'delete'
  payload TEXT,
  created_at INTEGER,
  synced INTEGER DEFAULT 0
);

-- Game tags / notes
CREATE TABLE game_notes (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  note TEXT,
  tags TEXT, -- JSON array
  created_at INTEGER,
  updated_at INTEGER
);

-- Milestones / achievements
CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  type TEXT, -- 'hours_played', 'games_launched', 'streak'
  value INTEGER,
  achieved_at INTEGER,
  synced INTEGER DEFAULT 0
);
```

---

## 8. API Design (Cloud Backend)

### Assumed Stack
- Node.js / Express or Rust (Axum/Actix) backend
- PostgreSQL for user data
- JWT authentication
- File storage (S3 or similar) for avatars

### Base URL
```
https://api.kcache.app
```

### Key Endpoints
```
POST   /auth/signup
POST   /auth/login
POST   /auth/refresh
GET    /auth/me
POST   /auth/logout

GET    /users/me
PATCH  /users/me
GET    /users/me/library
GET    /users/me/stats
GET    /users/me/playtime
GET    /users/me/milestones

POST   /games/sync-batch        -- bulk sync game data
GET    /games/suggestions       -- suggested games based on library

GET    /sync/queue              -- get pending sync items
POST   /sync/ack                -- mark items as synced
```

### Sync Protocol
1. Client sends `POST /sync/queue` with array of pending changes
2. Server processes and returns `{ synced: [ids], failed: [{id, reason}] }`
3. Client marks synced items as done locally

---

## 9. Frontend Pages Needed (New)

### `/login` — Sign In
- Email, password, submit
- Link to Sign Up
- Skip button → Dashboard

### `/signup` — Create Account
- Name, email, password, confirm
- Link to Sign In
- Skip button → Dashboard

### Settings additions
- Account section (if logged in): avatar, name, email, logout
- Sync status indicator
- "Sign In to Sync" prompt if in guest mode

### Dashboard additions
- Stats bar at top (total playtime, games, cache size)
- "Suggestions" section (future)

### New: `/vault` or integrated into Dashboard
- Full game vault view
- Progress bars per game
- Milestones section

---

## 10. Implementation Priority (Suggested)

### Phase 1: Auth Foundation
1. Add login/signup pages with skip option
2. Store session locally
3. Add Settings account section
4. Show user avatar/name in sidebar when logged in

### Phase 2: Stats & Progress
1. Add playtime session tracking on backend
2. Build stats cards on Dashboard
3. Show per-game playtime in details view
4. Add milestones system

### Phase 3: Game Vault
1. Game notes/tags
2. Custom collections/folders
3. Completion tracking (% played)

### Phase 4: Suggestions & Social
1. Game suggestions based on library
2. Compare with friends (optional)
3. Share vault (optional)

### Phase 5: Cloud Sync
1. Build sync queue system
2. Implement cloud backend
3. Conflict resolution
4. Offline-first sync

---

## 11. Important Rules & Constraints

1. **Never break local mode** — app must work 100% without internet or account
2. **Skip login must be first-class** — not hidden, clearly visible
3. **Playtime is sacred** — track accurately even if app crashes/restarts
4. **Cache paths never leave the machine** — only metadata syncs
5. **Soft deletes always** — never permanently delete without user action
6. **No telemetry without consent** — respect privacy, especially for pirated/custom games
7. **Guest data must survive sign-up** — when a guest creates an account, their local data should merge, not reset

---

## 12. Key Files Reference

| File | Purpose |
|---|---|
| `src-tauri/src/commands.rs` | All Tauri command handlers |
| `src-tauri/src/db.rs` | SQLite database |
| `src-tauri/src/steam_api.rs` | Steam API client |
| `src/hooks/useScanner.ts` | Frontend scanner state + API calls |
| `src/types/index.ts` | TypeScript types |
| `src-tauri/Cargo.toml` | Rust dependencies |
| `src-tauri/tauri.conf.json` | App config, permissions |
| `package.json` | Node dependencies |

---

*Last updated: 2026-09-11*
