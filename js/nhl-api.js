/**
 * NHL Losers Pool — Automated NHL API Pipeline & Background-Sync Engine
 * nhl-api.js
 *
 * Event-Driven Auto-Sync Flow:
 *  1. Load app → read lastSyncDate from settings.json
 *  2. If threshold met → fetch https://api-web.nhle.com/v1/schedule/now
 *  3. Parse FINAL / OFF games → fetch boxscore for each
 *  4. POST parsed data to api.php?action=sync_games
 */

'use strict';

const NHLApi = (() => {

    const SCHEDULE_URL  = 'https://api-web.nhle.com/v1/schedule/now';
    const BOXSCORE_URL  = (id) => `https://api-web.nhle.com/v1/gamecenter/${id}/boxscore`;
    const FINAL_STATES  = new Set(['OFF', 'FINAL', 'OVER']);
    const SYNC_INTERVAL_HOURS = 3;   // re-sync if on a weekend and older than 3 h

    // -------------------------------------------------------
    // Public: check whether a sync is needed, then run it
    // -------------------------------------------------------
    async function checkAndSync() {
        const settings = App.state.data.settings;
        if (shouldSync(settings)) {
            await runSync();
        }
    }

    // -------------------------------------------------------
    // Sync decision logic
    // -------------------------------------------------------
    function shouldSync(settings) {
        const now          = new Date();
        const dayOfWeek    = now.getDay(); // 0=Sun,6=Sat
        const isWeekend    = dayOfWeek === 0 || dayOfWeek === 6;
        const lastSync     = settings.lastSyncDate ? new Date(settings.lastSyncDate) : null;
        const hoursSinceSyncRaw = lastSync ? (now - lastSync) / 36e5 : Infinity;

        if (!lastSync) return true;                                       // Never synced
        if (isWeekend && hoursSinceSyncRaw > SYNC_INTERVAL_HOURS) return true; // Weekend re-sync
        // Sync if we haven't synced today (new calendar day)
        const todayStr     = now.toDateString();
        const lastSyncStr  = lastSync.toDateString();
        if (todayStr !== lastSyncStr) return true;

        return false;
    }

    // -------------------------------------------------------
    // Main sync pipeline
    // -------------------------------------------------------
    async function runSync() {
        if (App.state.syncInProgress) return;
        App.state.syncInProgress = true;
        console.info('[NHLApi] Sync started…');
        Admin.setSyncStatus('syncing', 'Syncing with NHL API…');

        try {
            // Step 1 — Fetch schedule
            const scheduleData = await fetchSchedule();
            if (!scheduleData) {
                Admin.setSyncStatus('pending', 'Schedule fetch failed');
                return;
            }

            // Step 2 — Collect all games from the response
            const allGames = extractGames(scheduleData);
            if (allGames.length === 0) {
                Admin.setSyncStatus('synced', `No games found. Last sync: ${fmtNow()}`);
                return;
            }

            // Step 3 — Fetch boxscores for completed games
            const finalGames = allGames.filter(g => FINAL_STATES.has(g.gameState));
            const enriched   = await enrichWithBoxscores(finalGames);

            // Merge non-final games (scheduled/live) with enriched finals
            const pendingGames = allGames
                .filter(g => !FINAL_STATES.has(g.gameState))
                .map(normalizeGame);
            const allNormalized = [...enriched, ...pendingGames];

            // Step 4 — Write back to server
            const result = await App.api.post('sync_games', { games: allNormalized });

            // Update local state
            App.state.data.games = await App.api.get('get_games');
            App.state.data.settings.lastSyncDate = new Date().toISOString();
            Admin.setSyncStatus('synced', `Last sync: ${fmtNow()} · +${result.added} added, ${result.updated} updated`);
            console.info('[NHLApi] Sync complete.', result);

        } catch (err) {
            console.error('[NHLApi] Sync error:', err);
            Admin.setSyncStatus('pending', `Sync failed: ${err.message}`);
        } finally {
            App.state.syncInProgress = false;
        }
    }

    // -------------------------------------------------------
    // Fetch full schedule from NHL API
    // -------------------------------------------------------
    async function fetchSchedule() {
        try {
            const res = await fetch(SCHEDULE_URL, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error(`Schedule API ${res.status}`);
            return await res.json();
        } catch (err) {
            console.warn('[NHLApi] fetchSchedule error:', err);
            return null;
        }
    }

    // -------------------------------------------------------
    // Extract a flat list of game objects from the schedule payload
    // -------------------------------------------------------
    function extractGames(data) {
        const games = [];
        const weeks = data.gameWeek || [];
        for (const week of weeks) {
            for (const game of (week.games || [])) {
                games.push(game);
            }
        }
        return games;
    }

    // -------------------------------------------------------
    // Enrich completed games with boxscore stats
    // -------------------------------------------------------
    async function enrichWithBoxscores(games) {
        const results = [];
        // Fetch in small batches to avoid hammering the API
        const BATCH = 5;
        for (let i = 0; i < games.length; i += BATCH) {
            const batch = games.slice(i, i + BATCH);
            const settled = await Promise.allSettled(batch.map(g => fetchBoxscore(g)));
            for (const s of settled) {
                if (s.status === 'fulfilled' && s.value) results.push(s.value);
            }
        }
        return results;
    }

    async function fetchBoxscore(game) {
        try {
            const res = await fetch(BOXSCORE_URL(game.id), { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return normalizeGame(game);   // Fallback to base game data
            const box  = await res.json();
            return mergeBoxscore(game, box);
        } catch {
            return normalizeGame(game);
        }
    }

    // -------------------------------------------------------
    // Merge boxscore data into a normalized game record
    // -------------------------------------------------------
    function mergeBoxscore(game, box) {
        const base = normalizeGame(game);
        try {
            const home = box.homeTeam || {};
            const away = box.awayTeam || {};

            base.homeScore = home.score  ?? base.homeScore;
            base.awayScore = away.score  ?? base.awayScore;

            // Outcome period
            base.periodDescriptor = box.periodDescriptor?.periodType ?? null;
            base.gameOutcome      = deriveOutcome(box);

            // Stats
            base.stats = {
                home: extractTeamStats(home),
                away: extractTeamStats(away),
            };

            // Determine winner / loser
            if (base.homeScore !== null && base.awayScore !== null) {
                base.winnerTeam = base.homeScore > base.awayScore ? base.homeAbbr : base.awayAbbr;
                base.loserTeam  = base.homeScore > base.awayScore ? base.awayAbbr : base.homeAbbr;
            }
        } catch (err) {
            console.warn('[NHLApi] mergeBoxscore error for game', game.id, err);
        }
        return base;
    }

    function extractTeamStats(teamObj) {
        return {
            sog:            teamObj.sog                 ?? null,
            powerPlayGoals: teamObj.powerPlayGoals       ?? null,
            powerPlayConversions: teamObj.powerPlayConversions ?? null,
            hits:           teamObj.hits                ?? null,
            pim:            teamObj.pim                 ?? null,
            faceoffWinPct:  teamObj.faceoffWinningPctg  ?? null,
        };
    }

    function deriveOutcome(box) {
        const period = box.periodDescriptor?.periodType;
        if (period === 'SO')  return 'SO';
        if (period === 'OT')  return 'OT';
        return 'REG';
    }

    // -------------------------------------------------------
    // Build a normalized game object from the schedule entry
    // -------------------------------------------------------
    function normalizeGame(game) {
        const home = game.homeTeam || {};
        const away = game.awayTeam || {};
        return {
            gameId:           String(game.id),
            season:           game.season        ?? null,
            gameType:         game.gameType       ?? null,
            gameDate:         game.gameDate       ?? null,
            startTimeUTC:     game.startTimeUTC   ?? null,
            gameState:        game.gameState      ?? 'FUT',
            homeAbbr:         home.abbrev         ?? null,
            homeName:         home.commonName?.default ?? null,
            awayAbbr:         away.abbrev         ?? null,
            awayName:         away.commonName?.default ?? null,
            homeScore:        typeof home.score === 'number' ? home.score : null,
            awayScore:        typeof away.score === 'number' ? away.score : null,
            venue:            game.venue?.default  ?? null,
            winnerTeam:       null,
            loserTeam:        null,
            gameOutcome:      null,
            periodDescriptor: null,
            stats:            null,
        };
    }

    // -------------------------------------------------------
    // Manual sync trigger (called from admin panel)
    // -------------------------------------------------------
    async function manualSync() {
        App.state.syncInProgress = false; // allow re-trigger
        await runSync();
    }

    // -------------------------------------------------------
    // Utility
    // -------------------------------------------------------
    function fmtNow() {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Derive the current pool "weekendId" (YYYY-WW-Sat format)
    function getCurrentWeekendId() {
        const now  = new Date();
        const day  = now.getDay(); // 0=Sun,6=Sat
        // Find the Saturday of the current or upcoming weekend
        let sat    = new Date(now);
        if (day === 0) sat.setDate(now.getDate() - 1);   // Sunday → back to Saturday
        else if (day !== 6) sat.setDate(now.getDate() + (6 - day)); // Weekday → next Saturday
        const yyyy = sat.getFullYear();
        const mm   = String(sat.getMonth() + 1).padStart(2, '0');
        const dd   = String(sat.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    // Return games that fall on the current weekend (Sat–Sun)
    function getWeekendGames(games, weekendId) {
        // weekendId is "YYYY-MM-DD" of that Saturday
        const sat = new Date(weekendId + 'T00:00:00');
        const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
        const sunStr = `${sun.getFullYear()}-${String(sun.getMonth()+1).padStart(2,'0')}-${String(sun.getDate()).padStart(2,'0')}`;
        return games.filter(g => g.gameDate === weekendId || g.gameDate === sunStr);
    }

    return {
        checkAndSync,
        manualSync,
        getCurrentWeekendId,
        getWeekendGames,
        shouldSync,
    };

})();
