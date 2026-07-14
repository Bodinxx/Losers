# Project Requirements: NHL Losers Pool

## 1. Project Overview
The NHL Losers Pool is a web-based application designed to manage a season-long betting pool where participants predict the losing team of NHL games. The application is built using vanilla JavaScript, HTML5, and CSS3, utilizing a simple PHP server-side gateway to safely write to and persist local JSON files.

## 2. Technical Architecture & Data Storage
The application behaves as a Single Page Application (SPA). Because it does not run server-side Cron jobs, all "automated" tasks (fetching schedules, importing statistics, and processing scoring) are event-driven and client-triggered.
```
/ (Root Directory)
├── index.php             (Main entry point and SPA HTML/CSS container)
├── api.php               (Secure PHP routing controller for JSON file I/O operations)
├── css/
│   └── styles.css        (Core stylesheet with modular layout rules and NHL team themes)
├── js/
│   ├── app.js            (Core SPA router, Auth state, local cryptography handler)
│   ├── admin.js          (Manual dashboard overrides, scoring utilities)
│   └── nhl-api.js        (Automated NHL API pipeline & background-sync engine)
└── data/
    ├── settings.json     (Global variables: Buy In, season configurations, lastSyncDate)
    ├── users.json        (User database: hashes, PBKDF2 parameters, encrypted emails)
    ├── games.json        (Master historical schedule database + imported game statistics)
    ├── picks.json        (Historical records mapping player userIDs to selections)
    └── team_themes.json  (RGB, Hex, and styling attributes for all 32 NHL franchises)
```
### JSON File Management
- `games.json`: Stores full schedules, scores, game status, and game stats. It is an append-only archive.
- `users.json`: Stores user objects, including `username`, `passwordHash`, `encryptedEmail`, `iv` (Initialization Vector for crypto), `role`, `preferences`, and `isFirstLogin`.
- `picks.json`: Maps unique `userID` to a specific `gameID` and the `selectedLoserTeam` for that match.
- `settings.json`: Stores configuration details (`buyIn`, `seasonYear`, `lastSyncDate`).

## 3. Core Mechanics & Gameplay
- **Objective**: Players select one team per designated game to lose on any given weekend (Saturday through Sunday).
- **Scoring Rules:**
  - If the player's selected team loses the game (in Regulation, OT, or SO), the player earns **0 points** (safe).
  - If the player's selected team wins or ties (historically speaking, or if a game is canceled/postponed), the player is penalized **1 point**.
  - **Tie-Breaker**: Accumulation of total correctly predicted losers.
- **Deadlines**: Selections are automatically locked at midnight (00:00) MST on Friday (the beginning of the weekend game series).

## 4. Automated Weekend Ingestion & Game Stats Import
Because server-level cron utilities are restricted, schedule imports and statistical updates run on an **Event-Driven Auto-Sync Pipeline** initiated silently in the background by clients.

### The Client-Triggered Event Flow
1. **The Handshake Trigger**: Upon a user loading `index.php`, `app.js` reads the local `settings.json` via a `GET api.php?action=get_settings` request.
2. **Sync Assessment**: The client compares the `lastSyncDate` inside `settings.json` against the current system date.
3. **The API Sync Query**: If the current date is past `lastSyncDate` (or if it is currently a weekend and the last sync occurred more than 3 hours ago), `nhl-api.js` automatically fires a background fetch request to the **Official NHL API**:
    - **Schedule API**: `https://api-web.nhle.com/v1/schedule/now` (returns the active week's schedule).
4. **Data Aggregation**: For games marked with a state of `"OFF"` or `"FINAL"`, the app calls the Gamecenter Boxscore API:
    - **Stats API**: `https://api-web.nhle.com/v1/gamecenter/{gameId}/boxscore`
5. **Stats Tracked**: The client parses the JSON to extract key game details:
    - **Final Score** (Home/Away Goals)
    - **Outcome Details** (Won in Regulation, OT, or SO)
    - **Team Statistics** (*Shots on Goal*, *Power Play Conversions*, *Hits*, and *Penalty Minutes*)
6. **Backend Writeback**: The parsed data is sent via a `POST` request to `api.php?action=sync_games`. The PHP controller merges new games into `games.json`, updates `lastSyncDate` in `settings.json`, and outputs the updated database without reloading the player's browser.
```
[User Browser]
      │
      ├─► 1. Load App ──► Checks lastSyncDate in settings.json
      │
      ├─► 2. Threshold Met? ──► GET https://api-web.nhle.com/v1/schedule/now
      │
      ├─► 3. Parse Final Games ──► GET https://api-web.nhle.com/v1/gamecenter/{gameId}/boxscore
      │
      └─► 4. Save to Disk ──► POST api.php?action=sync_games ──► Writes data/games.json
```

## 5. Security & Authentication
- **Data Privacy**: Players' emails are encrypted with AES-GCM (256-bit) using the browser's native Web Crypto API.
- **Key Derivation**: Rather than storing a static decryption key on the server, a user's password is ran through **PBKDF2** (Password-Based Key Derivation Function 2) on login to generate a cryptographic key. This key is stored temporarily in session memory to decrypt the email inside the user's dashboard view.
- **First-Time Users**: Temporary passwords expire instantly. Upon logging in, `isFirstLogin` prompts a mandatory form to establish a custom password and an alphanumeric security answer.

## 6. Financial Tracking
- **Buy-In**: Configured via the Admin Panel.
- **Total Pool Value**: Dynamic calculation displayed in the UI:

$$\text{Pool Total} = (\text{Total Users with Role: "Player"}) \times (\text{Buy In Value})$$

## 7. Visual Styles & Dynamic Team Themes
To make the dashboard fully responsive and immersive, `css/styles.css` relies on dynamic CSS variables mapped directly to the teams involved in a selected matchup. A complete palette definition exists inside `data/team_themes.json` containing each team's primary and secondary brand colors.

### Core CSS Theme Injection Structure:
**CSS**
```
/* Dynamic CSS Variable Mapping */
.team-theme-container {
  background-color: var(--primary-color, #111111);
  color: var(--text-color, #ffffff);
  border-left: 5px solid var(--secondary-color, #e41111);
}
```
JSON
```
{
  "EDM": {
    "name": "Edmonton Oilers",
    "primary": "#041E42",
    "secondary": "#FF4C00",
    "text": "#FFFFFF"
  },
  "TOR": {
    "name": "Toronto Maple Leafs",
    "primary": "#00205B",
    "secondary": "#FFFFFF",
    "text": "#FFFFFF"
  }
}
```
When a player drills down into a game's details, `app.js` reads the team abbreviation from `team_themes.json` and updates the container's inline styling attributes:
**JAVASCRIPT**
```
container.style.setProperty('--primary-color', team.primary);
container.style.setProperty('--secondary-color', team.secondary);
container.style.setProperty('--text-color', team.text);
```
