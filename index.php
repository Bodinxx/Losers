<?php
/**
 * NHL Losers Pool — Main SPA Entry Point
 * index.php
 */

// Prevent direct inclusion of sensitive files
if (basename($_SERVER['PHP_SELF']) !== 'index.php') {
    http_response_code(403);
    exit('Forbidden');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="NHL Losers Pool — Season-long NHL game prediction pool">
    <meta name="theme-color" content="#0f172a">
    <title>NHL Losers Pool</title>

    <!-- Core styles -->
    <link rel="stylesheet" href="css/styles.css">

    <!-- Favicon (emoji fallback) -->
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏒</text></svg>">
</head>
<body class="theme-dark-classic">

<!-- ╔══════════════════════════════════════╗ -->
<!-- ║  Loading Overlay                     ║ -->
<!-- ╚══════════════════════════════════════╝ -->
<div id="loading-overlay">
    <div class="spinner"></div>
    <p>Loading…</p>
</div>

<!-- ╔══════════════════════════════════════╗ -->
<!-- ║  Mobile Nav Toggle                   ║ -->
<!-- ╚══════════════════════════════════════╝ -->
<button id="nav-toggle" aria-label="Toggle navigation">☰</button>

<!-- ╔══════════════════════════════════════╗ -->
<!-- ║  Auth Views (no sidebar)             ║ -->
<!-- ╚══════════════════════════════════════╝ -->
<div id="view-setup"       class="view hidden"></div>
<div id="view-login"       class="view hidden"></div>
<div id="view-first-login" class="view hidden"></div>

<!-- ╔══════════════════════════════════════╗ -->
<!-- ║  Authenticated App Layout            ║ -->
<!-- ╚══════════════════════════════════════╝ -->
<div id="app-layout" class="hidden">

    <!-- ── Sidebar Navigation ─────────────── -->
    <nav id="app-nav" role="navigation" aria-label="Main navigation">

        <div class="nav-brand">
            <h1>🏒 NHL Losers Pool</h1>
            <p id="nav-season-label">Loading…</p>
        </div>

        <ul class="nav-links" role="list">
            <li>
                <button class="nav-link" data-view="dashboard" aria-label="Dashboard">
                    <span class="nav-icon">🏠</span> Dashboard
                </button>
            </li>
            <li>
                <button class="nav-link" data-view="picks" aria-label="My Picks">
                    <span class="nav-icon">🎯</span> My Picks
                </button>
            </li>
            <li>
                <button class="nav-link" data-view="leaderboard" aria-label="Leaderboard">
                    <span class="nav-icon">🏆</span> Leaderboard
                </button>
            </li>
            <li>
                <button class="nav-link" data-view="profile" aria-label="Profile">
                    <span class="nav-icon">👤</span> Profile
                </button>
            </li>
            <!-- Admin-only items -->
            <li class="nav-admin" style="display:none;">
                <button class="nav-link" data-view="admin" aria-label="Admin Panel">
                    <span class="nav-icon">⚙️</span> Admin Panel
                </button>
            </li>
        </ul>

        <div class="nav-footer">
            <div class="nav-user">
                <div class="user-avatar" id="nav-initial">?</div>
                <div>
                    <div class="user-name" id="nav-username">—</div>
                    <div class="user-role" id="nav-role">—</div>
                </div>
            </div>
            <button id="btn-logout" aria-label="Sign out">
                <span>🚪</span> Sign Out
            </button>
        </div>
    </nav>

    <!-- ── Main Content ────────────────────── -->
    <main id="app-main" role="main">

        <!-- Dashboard -->
        <div id="view-dashboard" class="view hidden"></div>

        <!-- Picks -->
        <div id="view-picks" class="view hidden"></div>

        <!-- Leaderboard -->
        <div id="view-leaderboard" class="view hidden"></div>

        <!-- Profile / Settings -->
        <div id="view-profile" class="view hidden"></div>

        <!-- Admin Panel -->
        <div id="view-admin" class="view hidden"></div>

    </main>
</div><!-- /#app-layout -->

<!-- ╔══════════════════════════════════════╗ -->
<!-- ║  Scripts (order matters)             ║ -->
<!-- ╚══════════════════════════════════════╝ -->
<script src="js/nhl-api.js"></script>
<script src="js/admin.js"></script>
<script src="js/app.js"></script>

<!-- Nav season label is updated by showAuthNav() in app.js after login -->

</body>
</html>
