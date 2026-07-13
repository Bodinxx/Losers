# Project Requirements: NHL Losers Pool
## 1. Project Overview
The NHL Losers Pool is a web-based application designed to manage a season-long betting pool where participants predict the losing team of NHL games. The application is built using vanilla JavaScript, HTML5, and CSS3, relying on local JSON files for persistent data storage.

## 2. Technical Architecture & Data Storage
The application will act as a client-side application where all data persistence is handled via JSON files.
- `games.json`: A persistent "Season Database" that stores the full schedule, game statuses, final scores, and outcomes (winner/loser). It is appended to over time and never cleared.
- `users.json`: Stores user objects, including username, password hash, encrypted email, role (Admin/Player), preferences, and `isFirstLogin` status.
- `picks.json`: Maps individual `userID` to `gameID` and the `selectedTeam`.
- `settings.json`: Stores global pool configuration, including the `buyIn` value and the `seasonName`.

## 3. Core Mechanics & Gameplay
- **Objective**: Players must select the loser of every NHL game occurring on a designated weekend.
- **Scoring**: A player earns 1 point for every game they predict incorrectly (if the team they selected wins or ties).
- **Deadline**: Selection forms are automatically locked at midnight (00:00) local time on the day of the first scheduled game of the weekend.
- **Leaderboard**:
  - Displays participants and their current point totals.
  - Features a toggle-able view for "*Season-to-Date*" (full historical points) and "*Last Weekend*" (current period points).
  - Includes drill-down functionality to view specific user picks against game results.

## 4. User Authentication & Security
- **Access Control**: Role-Based Access Control (RBAC) separates standard "*Players*" from "*Admins*."
- **First-Login Flow**:
  - Admin creates a user with an auto-generated temporary password.
  - Upon the first login, the user is required to change their password and set a security question/answer pair.
- **Data Privacy**: Email addresses stored in `users.json` are encrypted using the Web Crypto API (e.g., AES-GCM) to ensure privacy.
- **Password Recovery**: Users may reset their passwords by providing the correct answer to their predefined security question.

## 5. Admin Dashboard
Since the application does not utilize automated Cron jobs, the following operations are triggered manually by the Admin:
1. **Schedule Ingestion**: Fetch game schedules from an official API and append them to `games.json`.
2. **Scoring Engine**: Compare `user_picks.json` against actual results in `games.json`, calculate points, and update the leaderboard.
3. **Communication**: Trigger emails to users (via `mailto:` links) for results distribution, filtered by users who have opted-in.
4. **User Management**:
    - **Invite/Add User**: Create new user accounts and send an email containing the username and a temporary password to the user.
    - **Reset passwords** and toggle `isFirstLogin` flags if a user is locked out.
5. **Financials: Set the "Buy In" price.**
    - The application automatically calculates the Pool Total as $(\text{Total Users} \times \text{Buy In})$.
    - This total is displayed on the Player Dashboard.
6. **Backup Utility**: A tool to export `games.json` locally to prevent data loss.

## 6. Financial Tracking
- **Buy-In**: Configured via the Admin Dashboard.
- **Pool Total**: Calculated dynamically and displayed on the Player's main dashboard to ensure transparency regarding the prize pool.

## 7. Directory Layout
```
/ (Root Directory)
├── index.php         (Main entry point and HTML shell for the Single Page App)
├── css/
│   └── styles.css    (Core stylesheet)
├── js/
│   ├── app.js        (Core UI logic, user auth state, and view switching)
│   ├── admin.js      (Admin dashboard operations, scoring calculations)
│   └── nhl-api.js    (Dedicated functions for fetching and parsing the NHL JSON feed)
└── data/
    ├── settings.json (Global configuration, "Buy In" price, season name)
    ├── users.json    (User credentials, encrypted emails, roles, firstLogin flags)
    ├── games.json    (Persistent historical database of schedule and scores)
    └── picks.json    (Mapping of userID to gameID and selected loser)
```

## 8. Visual Styles
- Add a custom theme for each team in the NHL. Colours and text.
