/**
 * NHL Losers Pool — Core SPA Application
 * app.js
 *
 * Handles: theme management, PBKDF2/AES-GCM auth, SPA routing, all view rendering.
 */

'use strict';

const App = (() => {

    // ═══════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════
    const state = {
        currentUser:    null,    // { id, username, role, preferences, isFirstLogin, … }
        cryptoKey:      null,    // CryptoKey — in-memory only, never persisted
        currentView:    null,
        theme:          localStorage.getItem('nhl_pool_theme') || 'dark-classic',
        syncInProgress: false,
        data: {
            settings: {},
            users:    [],
            games:    [],
            picks:    [],
            teamThemes: {},
        },
    };

    // ═══════════════════════════════════════════════════
    // API helpers
    // ═══════════════════════════════════════════════════
    const api = {
        async get(action, params = {}) {
            const url = new URL('api.php', window.location.href);
            url.searchParams.set('action', action);
            for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
            const res = await fetch(url.toString(), {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
            return json;
        },

        async post(action, data = {}) {
            const res = await fetch(`api.php?action=${encodeURIComponent(action)}`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
            return json;
        },
    };

    // ═══════════════════════════════════════════════════
    // Crypto (PBKDF2 + AES-GCM)
    // ═══════════════════════════════════════════════════
    const crypto = {
        generateSalt() {
            return btoa(String.fromCharCode(...window.crypto.getRandomValues(new Uint8Array(32))));
        },

        async deriveKey(password, saltB64, iterations = 100000) {
            const enc  = new TextEncoder();
            const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
            const raw  = await window.crypto.subtle.importKey(
                'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
            );
            return window.crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
                raw,
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );
        },

        async hashForAuth(key) {
            const rawKey = await window.crypto.subtle.exportKey('raw', key);
            const suffix = new TextEncoder().encode('nhl_pool_auth_v1');
            const buf    = new Uint8Array(rawKey.byteLength + suffix.length);
            buf.set(new Uint8Array(rawKey)); buf.set(suffix, rawKey.byteLength);
            const hash   = await window.crypto.subtle.digest('SHA-256', buf);
            return btoa(String.fromCharCode(...new Uint8Array(hash)));
        },

        async encryptEmail(email, key) {
            const iv  = window.crypto.getRandomValues(new Uint8Array(12));
            const enc = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv }, key, new TextEncoder().encode(email)
            );
            return {
                encrypted: btoa(String.fromCharCode(...new Uint8Array(enc))),
                iv:        btoa(String.fromCharCode(...iv)),
            };
        },

        async decryptEmail(encB64, ivB64, key) {
            const enc = Uint8Array.from(atob(encB64), c => c.charCodeAt(0));
            const iv  = Uint8Array.from(atob(ivB64),  c => c.charCodeAt(0));
            const dec = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
            return new TextDecoder().decode(dec);
        },
    };

    // ═══════════════════════════════════════════════════
    // Themes
    // ═══════════════════════════════════════════════════
    const themes = {
        list: [
            { id: 'light-classic', name: 'Classic',  type: 'Light', prevClass: 'prev-lc' },
            { id: 'light-ice',     name: 'Ice',      type: 'Light', prevClass: 'prev-li' },
            { id: 'light-gold',    name: 'Gold',      type: 'Light', prevClass: 'prev-lg' },
            { id: 'dark-classic',  name: 'Classic',  type: 'Dark',  prevClass: 'prev-dc' },
            { id: 'dark-ice',      name: 'Ice',      type: 'Dark',  prevClass: 'prev-di' },
            { id: 'dark-midnight', name: 'Midnight', type: 'Dark',  prevClass: 'prev-dm' },
        ],

        apply(id) {
            const valid = this.list.map(t => t.id);
            if (!valid.includes(id)) id = 'dark-classic';
            document.body.classList.remove(...valid.map(t => `theme-${t}`));
            document.body.classList.add(`theme-${id}`);
            localStorage.setItem('nhl_pool_theme', id);
            state.theme = id;
        },

        async saveForUser(id) {
            this.apply(id);
            if (state.currentUser) {
                state.currentUser.preferences = { ...(state.currentUser.preferences || {}), theme: id };
                sessionStorage.setItem('nhl_pool_user', JSON.stringify(state.currentUser));
                await api.post('update_user', { id: state.currentUser.id, preferences: state.currentUser.preferences });
            }
        },

        renderSelector(container) {
            container.innerHTML = this.list.map(t => `
                <div class="theme-option ${state.theme === t.id ? 'active' : ''}" data-theme="${t.id}">
                    <div class="theme-preview ${t.prevClass}">
                        <div class="theme-preview-header"></div>
                        <div class="theme-preview-body">
                            <div class="theme-preview-sidebar"></div>
                            <div class="theme-preview-content">
                                <div class="theme-preview-card"></div>
                                <div class="theme-preview-card"></div>
                            </div>
                        </div>
                    </div>
                    <div class="theme-name">${t.name}</div>
                    <div class="theme-type">${t.type}</div>
                </div>
            `).join('');

            container.querySelectorAll('.theme-option').forEach(el => {
                el.addEventListener('click', async () => {
                    await themes.saveForUser(el.dataset.theme);
                    // Refresh selector active state
                    container.querySelectorAll('.theme-option').forEach(o => {
                        o.classList.toggle('active', o.dataset.theme === el.dataset.theme);
                    });
                    ui.toast('Theme applied!', 'success');
                });
            });
        },
    };

    // ═══════════════════════════════════════════════════
    // Router
    // ═══════════════════════════════════════════════════
    const router = {
        navigate(view) {
            state.currentView = view;
            const AUTH_VIEWS = ['login', 'setup', 'first-login'];

            // Toggle app layout visibility
            document.getElementById('app-layout').classList.toggle('hidden', AUTH_VIEWS.includes(view));

            // Hide all views, show target
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            const target = document.getElementById(`view-${view}`);
            if (target) target.classList.remove('hidden');

            // Update nav active states
            document.querySelectorAll('.nav-link').forEach(l => {
                l.classList.toggle('active', l.dataset.view === view);
            });

            // Render
            views.render(view);
        },
    };

    // ═══════════════════════════════════════════════════
    // UI Helpers
    // ═══════════════════════════════════════════════════
    const ui = {
        showLoading(msg = 'Loading…') {
            const el = document.getElementById('loading-overlay');
            if (el) { el.querySelector('p').textContent = msg; el.classList.remove('hidden'); }
        },
        hideLoading() {
            const el = document.getElementById('loading-overlay');
            if (el) el.classList.add('hidden');
        },

        alertHTML(msg, type = 'danger') {
            const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '❌';
            return `<div class="alert alert-${type}">${icon} ${escHtml(msg)}</div>`;
        },

        showModal(title, bodyHTML) {
            this.closeModal();
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.id        = 'active-modal';
            overlay.innerHTML = `
                <div class="modal" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
                    <div class="modal-header">
                        <h3>${escHtml(title)}</h3>
                        <button class="modal-close" aria-label="Close" onclick="App.ui.closeModal()">✕</button>
                    </div>
                    <div class="modal-body">${bodyHTML}</div>
                </div>`;
            document.body.appendChild(overlay);
            // Close on overlay click
            overlay.addEventListener('click', e => { if (e.target === overlay) this.closeModal(); });
            // Trap focus
            overlay.querySelector('.modal').querySelector('input, button, select, textarea')?.focus();
        },

        closeModal() {
            document.getElementById('active-modal')?.remove();
        },

        toast(msg, type = 'success', duration = 3000) {
            const t = document.createElement('div');
            t.className = `alert alert-${type}`;
            Object.assign(t.style, {
                position: 'fixed', bottom: '1.5rem', right: '1.5rem',
                zIndex: '9999', minWidth: '260px', boxShadow: 'var(--shadow-lg)',
                animation: 'slideUp .25s ease',
            });
            t.innerHTML = `${type === 'success' ? '✅' : '❌'} ${escHtml(msg)}`;
            document.body.appendChild(t);
            setTimeout(() => t.remove(), duration);
        },
    };

    // ═══════════════════════════════════════════════════
    // Views
    // ═══════════════════════════════════════════════════
    const views = {
        render(view) {
            switch (view) {
                case 'setup':       renderSetup();       break;
                case 'login':       renderLogin();       break;
                case 'first-login': renderFirstLogin();  break;
                case 'dashboard':   renderDashboard();   break;
                case 'picks':       renderPicks();       break;
                case 'leaderboard': renderLeaderboard(); break;
                case 'profile':     renderProfile();     break;
                case 'admin':
                    if (state.currentUser?.role === 'admin') Admin.renderAdmin();
                    break;
            }
        },
    };

    // ─────────────────────────────────────────────────
    // View: Setup (first-time admin creation)
    // ─────────────────────────────────────────────────
    function renderSetup() {
        document.getElementById('view-setup').innerHTML = `
            <div class="auth-page">
              <div class="auth-container">
                <div class="auth-logo">
                    <span class="logo-icon">🏒</span>
                    <h1>NHL Losers Pool</h1>
                    <p>First-time setup</p>
                </div>
                <div class="auth-card">
                    <h2>Create Admin Account</h2>
                    <p>Let's get your pool set up. Fill in the details below to create the administrator account.</p>
                    <div id="setup-alert"></div>
                    <form id="setup-form" novalidate>
                        <div class="form-group">
                            <label class="form-label">Admin Username</label>
                            <input id="s-user" type="text" class="form-input" placeholder="adminUsername" autocomplete="username" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Email Address</label>
                            <input id="s-email" type="email" class="form-input" placeholder="admin@example.com" autocomplete="email">
                            <p class="form-hint">Stored encrypted — only you can view it.</p>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Password</label>
                            <input id="s-pass" type="password" class="form-input" placeholder="Minimum 8 characters" autocomplete="new-password" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Confirm Password</label>
                            <input id="s-confirm" type="password" class="form-input" placeholder="Re-enter password" autocomplete="new-password" required>
                        </div>
                        <hr class="divider">
                        <div class="form-group">
                            <label class="form-label">Pool Name</label>
                            <input id="s-pool" type="text" class="form-input" value="NHL Losers Pool" required>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Buy-In ($)</label>
                                <input id="s-buyin" type="number" class="form-input" value="20" min="1" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Season Year</label>
                                <input id="s-year" type="number" class="form-input" value="${new Date().getFullYear()}" min="2020" required>
                            </div>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block btn-lg" id="s-btn">
                            Create Pool &amp; Admin Account
                        </button>
                    </form>
                </div>
              </div>
            </div>`;

        document.getElementById('setup-form').addEventListener('submit', async e => {
            e.preventDefault();
            const btn      = document.getElementById('s-btn');
            const alertEl  = document.getElementById('setup-alert');
            const username = document.getElementById('s-user').value.trim();
            const email    = document.getElementById('s-email').value.trim();
            const pass     = document.getElementById('s-pass').value;
            const confirm  = document.getElementById('s-confirm').value;
            const poolName = document.getElementById('s-pool').value.trim();
            const buyIn    = parseFloat(document.getElementById('s-buyin').value);
            const year     = parseInt(document.getElementById('s-year').value, 10);

            alertEl.innerHTML = '';
            if (pass !== confirm)  { alertEl.innerHTML = ui.alertHTML('Passwords do not match.'); return; }
            if (pass.length < 8)   { alertEl.innerHTML = ui.alertHTML('Password must be at least 8 characters.'); return; }
            if (!username)         { alertEl.innerHTML = ui.alertHTML('Username is required.'); return; }

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Setting up…';
            try {
                const salt   = crypto.generateSalt();
                const key    = await crypto.deriveKey(pass, salt);
                const pHash  = await crypto.hashForAuth(key);
                let encEmail = '', iv = '';
                if (email) { const enc = await crypto.encryptEmail(email, key); encEmail = enc.encrypted; iv = enc.iv; }

                await api.post('setup_admin', {
                    username, passwordHash: pHash, encryptedEmail: encEmail, iv, salt, iterations: 100000,
                    poolName, buyIn, seasonYear: year,
                });

                // Cache salt so the admin can log in immediately after setup
                localStorage.setItem(`nhl_salt_${username.toLowerCase()}`,
                    JSON.stringify({ salt, iterations: 100000 }));

                alertEl.innerHTML = ui.alertHTML('Pool created! Redirecting to login…', 'success');
                setTimeout(() => router.navigate('login'), 1400);
            } catch (err) {
                alertEl.innerHTML = ui.alertHTML(err.message || 'Setup failed.');
                btn.disabled = false; btn.textContent = 'Create Pool & Admin Account';
            }
        });
    }

    // ─────────────────────────────────────────────────
    // View: Login
    // ─────────────────────────────────────────────────
    function renderLogin() {
        const s = state.data.settings;
        document.getElementById('view-login').innerHTML = `
            <div class="auth-page">
              <div class="auth-container">
                <div class="auth-logo">
                    <span class="logo-icon">🏒</span>
                    <h1>${escHtml(s.poolName || 'NHL Losers Pool')}</h1>
                    <p>${s.seasonYear || new Date().getFullYear()} Season</p>
                </div>
                <div class="auth-card">
                    <h2>Sign In</h2>
                    <p>Enter your credentials to access the pool.</p>
                    <div id="login-alert"></div>
                    <form id="login-form" novalidate>
                        <div class="form-group">
                            <label class="form-label">Username</label>
                            <input id="l-user" type="text" class="form-input" placeholder="Your username" autocomplete="username" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Password</label>
                            <input id="l-pass" type="password" class="form-input" placeholder="Your password" autocomplete="current-password" required>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block btn-lg" id="l-btn">Sign In</button>
                    </form>
                </div>
              </div>
            </div>`;

        document.getElementById('login-form').addEventListener('submit', async e => {
            e.preventDefault();
            const btn     = document.getElementById('l-btn');
            const alertEl = document.getElementById('login-alert');
            const username = document.getElementById('l-user').value.trim();
            const pass     = document.getElementById('l-pass').value;

            alertEl.innerHTML = '';
            if (!username || !pass) { alertEl.innerHTML = ui.alertHTML('Username and password are required.'); return; }

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Signing in…';

            try {
                // Fetch PBKDF2 salt for this username, then derive key and authenticate
                const saltRes = await fetchSaltForUser(username);
                if (!saltRes) {
                    alertEl.innerHTML = ui.alertHTML('Invalid username or password.');
                    btn.disabled = false; btn.textContent = 'Sign In'; return;
                }

                const key    = await crypto.deriveKey(pass, saltRes.salt, saltRes.iterations);
                const pHash  = await crypto.hashForAuth(key);

                const loginRes = await api.post('login', { username, passwordHash: pHash });
                const user     = loginRes.user;

                // Store session
                state.currentUser = user;
                state.cryptoKey   = key;
                sessionStorage.setItem('nhl_pool_user', JSON.stringify(user));

                // Apply user's preferred theme
                const userTheme = user.preferences?.theme || state.theme;
                themes.apply(userTheme);

                // Load app data
                ui.showLoading('Loading pool data…');
                await loadAppData();
                ui.hideLoading();

                if (user.isFirstLogin) {
                    router.navigate('first-login');
                } else {
                    showAuthNav();
                    router.navigate('dashboard');
                    setTimeout(() => NHLApi.checkAndSync(), 2000);
                }
            } catch (err) {
                alertEl.innerHTML = ui.alertHTML(err.message || 'Sign in failed.');
                btn.disabled = false; btn.textContent = 'Sign In';
                ui.hideLoading();
            }
        });
    }

    // Fetch just the PBKDF2 salt/iterations for a username so we can derive the key before login.
    // The server's get_user_salt endpoint exposes only non-secret derivation parameters.
    async function fetchSaltForUser(username) {
        // Check localStorage cache first (populated on successful login or setup)
        const cacheKey = `nhl_salt_${username.toLowerCase()}`;
        const cached   = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed.salt) return { salt: parsed.salt, iterations: parsed.iterations || 100000 };
            } catch { /* ignore corrupted cache */ }
        }
        // Fetch from dedicated salt endpoint (safe — exposes only derivation params)
        try {
            const data = await api.get('get_user_salt', { username });
            if (data.salt) {
                localStorage.setItem(cacheKey, JSON.stringify({ salt: data.salt, iterations: data.iterations || 100000 }));
                return { salt: data.salt, iterations: data.iterations || 100000 };
            }
        } catch { /* fall through */ }
        return null;
    }

    // ─────────────────────────────────────────────────
    // View: First Login (force password change)
    // ─────────────────────────────────────────────────
    function renderFirstLogin() {
        document.getElementById('view-first-login').innerHTML = `
            <div class="auth-page">
              <div class="auth-container">
                <div class="auth-logo">
                    <span class="logo-icon">🔑</span>
                    <h1>Set Your Password</h1>
                    <p>Welcome, ${escHtml(state.currentUser?.username || '')}! Please set a permanent password.</p>
                </div>
                <div class="auth-card">
                    <h2>Change Password</h2>
                    <p>This temporary password must be replaced before you can continue.</p>
                    <div id="fl-alert"></div>
                    <form id="fl-form" novalidate>
                        <div class="form-group">
                            <label class="form-label">New Password</label>
                            <input id="fl-pass" type="password" class="form-input" placeholder="Minimum 8 characters" autocomplete="new-password" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Confirm Password</label>
                            <input id="fl-confirm" type="password" class="form-input" placeholder="Re-enter password" autocomplete="new-password" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Security Answer</label>
                            <input id="fl-security" type="text" class="form-input" placeholder="e.g. favourite team or city" autocomplete="off" required>
                            <p class="form-hint">Alphanumeric answer used for account recovery. Store this safely.</p>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Email Address (optional)</label>
                            <input id="fl-email" type="email" class="form-input" placeholder="you@example.com" autocomplete="email">
                        </div>
                        <button type="submit" class="btn btn-primary btn-block btn-lg" id="fl-btn">Set Password &amp; Continue</button>
                    </form>
                </div>
              </div>
            </div>`;

        document.getElementById('fl-form').addEventListener('submit', async e => {
            e.preventDefault();
            const alertEl  = document.getElementById('fl-alert');
            const btn      = document.getElementById('fl-btn');
            const pass     = document.getElementById('fl-pass').value;
            const confirm  = document.getElementById('fl-confirm').value;
            const security = document.getElementById('fl-security').value.trim();
            const email    = document.getElementById('fl-email').value.trim();

            alertEl.innerHTML = '';
            if (pass !== confirm)       { alertEl.innerHTML = ui.alertHTML('Passwords do not match.'); return; }
            if (pass.length < 8)        { alertEl.innerHTML = ui.alertHTML('Password must be at least 8 characters.'); return; }
            if (security.length < 3)    { alertEl.innerHTML = ui.alertHTML('Please provide a security answer (3+ characters).'); return; }

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Saving…';
            try {
                const salt   = crypto.generateSalt();
                const key    = await crypto.deriveKey(pass, salt);
                const pHash  = await crypto.hashForAuth(key);
                let encEmail = '', iv = '';
                if (email) { const enc = await crypto.encryptEmail(email, key); encEmail = enc.encrypted; iv = enc.iv; }

                await api.post('change_password', {
                    id: state.currentUser.id, passwordHash: pHash,
                    encryptedEmail: encEmail, iv, salt, iterations: 100000, securityAnswer: security,
                });

                // Cache salt for future logins
                localStorage.setItem(`nhl_salt_${state.currentUser.username.toLowerCase()}`,
                    JSON.stringify({ salt, iterations: 100000 }));

                state.cryptoKey = key;
                state.currentUser.isFirstLogin = false;
                sessionStorage.setItem('nhl_pool_user', JSON.stringify(state.currentUser));

                ui.toast('Password set! Welcome to the pool.', 'success');
                showAuthNav();
                router.navigate('dashboard');
                setTimeout(() => NHLApi.checkAndSync(), 2000);
            } catch (err) {
                alertEl.innerHTML = ui.alertHTML(err.message || 'Failed to set password.');
                btn.disabled = false; btn.textContent = 'Set Password & Continue';
            }
        });
    }

    // ─────────────────────────────────────────────────
    // View: Dashboard
    // ─────────────────────────────────────────────────
    function renderDashboard() {
        const u          = state.currentUser;
        const settings   = state.data.settings;
        const users      = state.data.users;
        const picks      = state.data.picks;
        const games      = state.data.games;

        const playerCount = users.filter(u => u.role === 'player').length;
        const poolTotal   = playerCount * (settings.buyIn || 0);
        const weekendId   = NHLApi.getCurrentWeekendId();
        const myPick      = picks.find(p => p.userId === u.id && p.weekendId === weekendId);

        // Compute my score
        const myPicks   = picks.filter(p => p.userId === u.id);
        const penalties = myPicks.filter(p => p.result === 'penalty').length;
        const safe      = myPicks.filter(p => p.result === 'safe').length;
        const pending   = myPicks.filter(p => p.result === null).length;

        // Recent 5 picks
        const recentPicks = myPicks.slice(-5).reverse();

        document.getElementById('view-dashboard').innerHTML = `
            <div class="app-content">
                <div class="page-header">
                    <h2>👋 Welcome back, ${escHtml(u.username)}!</h2>
                    <p>${settings.poolName || 'NHL Losers Pool'} · ${settings.seasonYear || ''} Season</p>
                </div>

                <!-- Pool banner -->
                <div class="pool-banner">
                    <h2>💰 Current Pool Value</h2>
                    <div class="pool-value">$${poolTotal.toFixed(0)}</div>
                    <p>${playerCount} player${playerCount !== 1 ? 's' : ''} × $${settings.buyIn || 0} buy-in</p>
                </div>

                <!-- Stats -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value text-danger">${penalties}</div>
                        <div class="stat-label">My Penalties</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value text-success">${safe}</div>
                        <div class="stat-label">Safe Picks</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${pending}</div>
                        <div class="stat-label">Pending</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${myPicks.length}</div>
                        <div class="stat-label">Total Picks</div>
                    </div>
                </div>

                <div class="dashboard-grid">
                    <!-- This week's pick status -->
                    <div class="card">
                        <div class="card-header"><h3>🎯 This Weekend</h3></div>
                        <div class="card-body">
                            ${myPick
                                ? `<div class="pick-status">
                                    <div class="ps-icon">✅</div>
                                    <div>
                                        <h4>Pick Submitted</h4>
                                        <p>Selected: <strong>${escHtml(myPick.selectedLoserTeam)}</strong> to lose · ${formatDate(myPick.timestamp)}</p>
                                    </div>
                                  </div>
                                  <button class="btn btn-secondary btn-block" onclick="App.router.navigate('picks')">Change Pick</button>`
                                : `<div class="pick-status">
                                    <div class="ps-icon">⏰</div>
                                    <div>
                                        <h4>No Pick Yet</h4>
                                        <p>Weekend: ${escHtml(weekendId)} · Locks Friday 00:00 MST</p>
                                    </div>
                                  </div>
                                  <button class="btn btn-primary btn-block" onclick="App.router.navigate('picks')">Make My Pick</button>`}
                        </div>
                    </div>

                    <!-- Recent results -->
                    <div class="card">
                        <div class="card-header"><h3>📋 Recent Results</h3></div>
                        <div class="card-body">
                            ${recentPicks.length === 0
                                ? '<p class="text-secondary">No pick history yet.</p>'
                                : recentPicks.map(p => {
                                    const game = games.find(g => g.gameId === p.gameId);
                                    const label = game
                                        ? `${game.awayAbbr} @ ${game.homeAbbr}`
                                        : p.gameId;
                                    return `<div class="result-row">
                                        <div>
                                            <div class="result-teams">${escHtml(label)}</div>
                                            <div class="result-pick">Picked: ${escHtml(p.selectedLoserTeam)}</div>
                                        </div>
                                        <div>${resultBadge(p.result)}</div>
                                    </div>`;
                                }).join('')}
                        </div>
                        <div class="card-footer">
                            <button class="btn btn-ghost btn-sm" onclick="App.router.navigate('leaderboard')">
                                View Full Leaderboard →
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    // ─────────────────────────────────────────────────
    // View: Picks
    // ─────────────────────────────────────────────────
    function renderPicks() {
        const weekendId  = NHLApi.getCurrentWeekendId();
        const games      = NHLApi.getWeekendGames(state.data.games, weekendId);
        const myPick     = state.data.picks.find(p => p.userId === state.currentUser.id && p.weekendId === weekendId);

        // Is picking locked? (Friday 00:00 MST through Sunday end)
        const locked     = isPickingLocked();

        const container  = document.getElementById('view-picks');
        container.innerHTML = `
            <div class="app-content">
                <div class="page-header">
                    <h2>🏒 Make Your Pick</h2>
                    <p>Select one team per weekend to lose. You can change your pick until Friday 00:00 MST.</p>
                </div>

                ${locked ? `<div class="alert alert-warning">🔒 Picks are locked for this weekend (Friday–Sunday). Check back Monday.</div>` : ''}
                ${myPick ? `<div class="alert alert-success">✅ Your current pick: <strong>${escHtml(myPick.selectedLoserTeam)}</strong> to lose. ${locked ? '' : 'You can still change it below.'}</div>` : ''}

                <div class="picks-header">
                    <span class="weekend-label">📅 Weekend: ${escHtml(weekendId)}</span>
                    <span class="deadline-badge">⏰ Locks Friday 00:00 MST</span>
                </div>

                ${games.length === 0
                    ? `<div class="card"><div class="card-body text-center">
                           <p style="font-size:2rem;margin-bottom:.75rem;">📭</p>
                           <p class="text-secondary">No games scheduled for this weekend yet.<br>
                               Check back after the schedule syncs.</p>
                           <button class="btn btn-primary" style="margin-top:1rem;" onclick="NHLApi.manualSync()">🔄 Sync Now</button>
                       </div></div>`
                    : `<div class="games-grid">${games.map(g => buildGameCard(g, myPick, locked)).join('')}</div>`}

                <div id="pick-alert" style="margin-top:1rem;"></div>
            </div>`;

        // Attach game card click handlers
        if (!locked) {
            container.querySelectorAll('.game-card:not(.locked)').forEach(card => {
                card.addEventListener('click', () => showPickModal(
                    card.dataset.gameId, card.dataset.home, card.dataset.away, weekendId
                ));
            });
        }
    }

    function buildGameCard(game, myPick, locked) {
        const selected = myPick?.gameId === game.gameId;
        const teamThemes = state.data.teamThemes;
        const homeColor = teamThemes[game.homeAbbr]?.primary || 'var(--bg-secondary)';
        const awayColor = teamThemes[game.awayAbbr]?.primary || 'var(--bg-secondary)';

        return `<div class="game-card ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}"
                     data-game-id="${game.gameId}"
                     data-home="${escHtml(game.homeAbbr || '')}"
                     data-away="${escHtml(game.awayAbbr || '')}">
            <div class="gc-header">
                <span>📅 ${game.gameDate || '—'}</span>
                <span class="badge">${game.gameState || 'SCH'}</span>
            </div>
            <div class="gc-body">
                <div class="matchup">
                    <div class="team-block">
                        <div class="team-abbr" style="color:${awayColor}">${escHtml(game.awayAbbr || '?')}</div>
                        <div class="team-name">${escHtml(game.awayName || '')}</div>
                    </div>
                    <div class="vs-sep">@</div>
                    <div class="team-block">
                        <div class="team-abbr" style="color:${homeColor}">${escHtml(game.homeAbbr || '?')}</div>
                        <div class="team-name">${escHtml(game.homeName || '')}</div>
                    </div>
                </div>
            </div>
            <div class="gc-footer">
                ${selected ? `✅ Your pick: <strong>${escHtml(myPick.selectedLoserTeam)}</strong>` : (locked ? '🔒 Locked' : '👆 Click to pick')}
            </div>
        </div>`;
    }

    function showPickModal(gameId, homeAbbr, awayAbbr, weekendId) {
        const teamThemes = state.data.teamThemes;
        const homePrimary = teamThemes[homeAbbr]?.primary || '#333';
        const awayPrimary = teamThemes[awayAbbr]?.primary || '#333';
        const homeSecondary = teamThemes[homeAbbr]?.secondary || '#fff';
        const awaySecondary = teamThemes[awayAbbr]?.secondary || '#fff';
        const homeName  = teamThemes[homeAbbr]?.name || homeAbbr;
        const awayName  = teamThemes[awayAbbr]?.name || awayAbbr;

        ui.showModal(`Pick Your Loser`, `
            <p class="text-secondary" style="margin-bottom:.875rem;">Select the team you think will <strong>lose</strong> this game.</p>
            <div id="pick-modal-alert"></div>
            <div class="team-picker">
                <button class="team-pick-btn" id="pick-away" data-team="${escHtml(awayAbbr)}"
                    style="--primary:${awayPrimary};--secondary:${awaySecondary};">
                    <span class="tpb-abbr" style="color:${awayPrimary}">${escHtml(awayAbbr)}</span>
                    <span class="tpb-name">${escHtml(awayName)}</span>
                    <span style="font-size:.72rem;color:var(--text-muted);">Away</span>
                </button>
                <button class="team-pick-btn" id="pick-home" data-team="${escHtml(homeAbbr)}"
                    style="--primary:${homePrimary};--secondary:${homeSecondary};">
                    <span class="tpb-abbr" style="color:${homePrimary}">${escHtml(homeAbbr)}</span>
                    <span class="tpb-name">${escHtml(homeName)}</span>
                    <span style="font-size:.72rem;color:var(--text-muted);">Home</span>
                </button>
            </div>
            <div class="modal-footer" style="padding:0;border:none;margin-top:.5rem;">
                <button class="btn btn-ghost" onclick="App.ui.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="confirm-pick-btn" disabled>Confirm Pick</button>
            </div>
        `);

        let selectedTeam = null;
        document.querySelectorAll('.team-pick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedTeam = btn.dataset.team;
                document.querySelectorAll('.team-pick-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                document.getElementById('confirm-pick-btn').disabled = false;
            });
        });

        document.getElementById('confirm-pick-btn').addEventListener('click', async () => {
            if (!selectedTeam) return;
            const alertEl = document.getElementById('pick-modal-alert');
            alertEl.innerHTML = '';
            try {
                await api.post('save_pick', {
                    userId: state.currentUser.id,
                    gameId,
                    selectedLoserTeam: selectedTeam,
                    weekendId,
                });
                state.data.picks = await api.get('get_picks');
                ui.closeModal();
                ui.toast(`Pick saved: ${selectedTeam} to lose!`, 'success');
                renderPicks();
            } catch (err) {
                alertEl.innerHTML = ui.alertHTML(err.message, 'danger');
            }
        });
    }

    // ─────────────────────────────────────────────────
    // View: Leaderboard
    // ─────────────────────────────────────────────────
    function renderLeaderboard() {
        const users  = state.data.users;
        const picks  = state.data.picks;

        // Build score map
        const scoreMap = {};
        picks.forEach(p => {
            if (!scoreMap[p.userId]) scoreMap[p.userId] = { penalties: 0, safe: 0, pending: 0 };
            if (p.result === 'penalty') scoreMap[p.userId].penalties++;
            else if (p.result === 'safe') scoreMap[p.userId].safe++;
            else scoreMap[p.userId].pending++;
        });

        // Sort players: fewer penalties first, then more safe picks (tiebreaker)
        const sorted = users
            .filter(u => u.role === 'player' || u.role === 'admin')
            .map(u => ({
                ...u,
                ...(scoreMap[u.id] || { penalties: 0, safe: 0, pending: 0 }),
            }))
            .sort((a, b) => a.penalties !== b.penalties ? a.penalties - b.penalties : b.safe - a.safe);

        const rows = sorted.map((p, i) => {
            const rank = i + 1;
            const rankClass = rank <= 3 ? `rank-${rank}` : '';
            const myRow = p.id === state.currentUser.id ? 'style="background-color:color-mix(in srgb, var(--accent) 8%, transparent);"' : '';
            return `<tr ${myRow}>
                <td class="rank-cell ${rankClass}">${rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}</td>
                <td><div class="player-cell">
                    <div class="player-avatar">${p.username.charAt(0).toUpperCase()}</div>
                    <span>${escHtml(p.username)}${p.id === state.currentUser.id ? ' <span class="badge" style="font-size:.65rem;">You</span>' : ''}</span>
                </div></td>
                <td class="penalty-cell">${p.penalties}</td>
                <td class="score-cell text-success">${p.safe}</td>
                <td class="text-muted">${p.pending}</td>
            </tr>`;
        }).join('');

        document.getElementById('view-leaderboard').innerHTML = `
            <div class="app-content">
                <div class="page-header">
                    <h2>🏆 Leaderboard</h2>
                    <p>Fewer penalties = better. Tiebreaker: most correct loser picks.</p>
                </div>
                <div class="table-wrapper">
                    <table class="leaderboard-table">
                        <thead><tr>
                            <th style="text-align:center;">#</th>
                            <th>Player</th>
                            <th>Penalties</th>
                            <th>Safe Picks</th>
                            <th>Pending</th>
                        </tr></thead>
                        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-secondary);">No players yet.</td></tr>'}</tbody>
                    </table>
                </div>
                <p class="text-muted" style="margin-top:1rem;font-size:.78rem;">
                    📌 Scoring: Correct loser pick = 0 pts (safe). Wrong pick (selected winner) = +1 penalty.
                </p>
            </div>`;
    }

    // ─────────────────────────────────────────────────
    // View: Profile / Settings
    // ─────────────────────────────────────────────────
    function renderProfile() {
        const u = state.currentUser;
        const container = document.getElementById('view-profile');
        container.innerHTML = `
            <div class="app-content">
                <div class="page-header">
                    <h2>👤 My Profile</h2>
                    <p>Manage your account preferences and appearance.</p>
                </div>
                <div class="profile-grid">
                    <!-- Account info -->
                    <div class="card">
                        <div class="card-header"><h3>Account Info</h3></div>
                        <div class="card-body">
                            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem;">
                                <div class="user-avatar" style="width:3.5rem;height:3.5rem;font-size:1.5rem;">
                                    ${u.username.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div class="font-bold" style="font-size:1.1rem;">${escHtml(u.username)}</div>
                                    <div class="badge ${u.role === 'admin' ? 'badge-warning' : ''}">${u.role}</div>
                                </div>
                            </div>
                            <hr class="divider">
                            <button class="btn btn-secondary btn-block" id="btn-change-password">🔑 Change Password</button>
                        </div>
                    </div>

                    <!-- Theme selector -->
                    <div class="card">
                        <div class="card-header"><h3>🎨 Appearance</h3></div>
                        <div class="card-body">
                            <p class="text-secondary mb-4" style="font-size:.875rem;margin-bottom:1rem;">
                                Choose your preferred theme (3 light, 3 dark).
                            </p>
                            <div id="theme-selector-grid" class="theme-selector"></div>
                        </div>
                    </div>
                </div>
            </div>`;

        themes.renderSelector(document.getElementById('theme-selector-grid'));

        document.getElementById('btn-change-password').addEventListener('click', () => showChangePasswordModal());
    }

    function showChangePasswordModal() {
        ui.showModal('Change Password', `
            <div id="cp-alert"></div>
            <form id="cp-form" novalidate>
                <div class="form-group">
                    <label class="form-label">Current Password</label>
                    <input id="cp-current" type="password" class="form-input" placeholder="Current password" required>
                </div>
                <div class="form-group">
                    <label class="form-label">New Password</label>
                    <input id="cp-new" type="password" class="form-input" placeholder="Minimum 8 characters" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Confirm New Password</label>
                    <input id="cp-confirm" type="password" class="form-input" placeholder="Re-enter new password" required>
                </div>
                <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                    <button type="button" class="btn btn-ghost" onclick="App.ui.closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="cp-btn">Update Password</button>
                </div>
            </form>
        `);

        document.getElementById('cp-form').addEventListener('submit', async e => {
            e.preventDefault();
            const alertEl = document.getElementById('cp-alert');
            const currentPass = document.getElementById('cp-current').value;
            const newPass     = document.getElementById('cp-new').value;
            const confirm     = document.getElementById('cp-confirm').value;
            const btn         = document.getElementById('cp-btn');

            alertEl.innerHTML = '';
            if (newPass !== confirm)   { alertEl.innerHTML = ui.alertHTML('Passwords do not match.'); return; }
            if (newPass.length < 8)    { alertEl.innerHTML = ui.alertHTML('Password must be at least 8 characters.'); return; }

            btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

            try {
                // Verify current password
                const u = state.currentUser;
                const cachedSalt = localStorage.getItem(`nhl_salt_${u.username.toLowerCase()}`);
                if (!cachedSalt) throw new Error('Session salt not found. Please log out and back in.');
                const { salt: oldSalt, iterations: oldIter } = JSON.parse(cachedSalt);
                const oldKey  = await crypto.deriveKey(currentPass, oldSalt, oldIter);
                const oldHash = await crypto.hashForAuth(oldKey);

                // Quick server check
                await api.post('login', { username: u.username, passwordHash: oldHash });

                // Now apply new password
                const newSalt = crypto.generateSalt();
                const newKey  = await crypto.deriveKey(newPass, newSalt);
                const newHash = await crypto.hashForAuth(newKey);

                await api.post('change_password', {
                    id: u.id, passwordHash: newHash,
                    salt: newSalt, iv: '', encryptedEmail: '', iterations: 100000,
                });

                localStorage.setItem(`nhl_salt_${u.username.toLowerCase()}`,
                    JSON.stringify({ salt: newSalt, iterations: 100000 }));
                state.cryptoKey = newKey;

                ui.closeModal();
                ui.toast('Password updated successfully!', 'success');
            } catch (err) {
                alertEl.innerHTML = ui.alertHTML(err.message || 'Failed to update password.');
                btn.disabled = false; btn.textContent = 'Update Password';
            }
        });
    }

    // ═══════════════════════════════════════════════════
    // Auth helpers
    // ═══════════════════════════════════════════════════
    function showAuthNav() {
        const u = state.currentUser;
        const s = state.data.settings;
        document.getElementById('nav-username').textContent = u.username;
        document.getElementById('nav-role').textContent     = u.role;
        document.getElementById('nav-initial').textContent  = u.username.charAt(0).toUpperCase();
        const label = document.getElementById('nav-season-label');
        if (label) label.textContent = `${s.poolName || 'NHL Losers Pool'} · ${s.seasonYear || ''}`;

        // Show/hide admin nav items
        document.querySelectorAll('.nav-admin').forEach(el => {
            el.style.display = u.role === 'admin' ? '' : 'none';
        });
    }

    function handleLogout() {
        state.currentUser = null;
        state.cryptoKey   = null;
        sessionStorage.removeItem('nhl_pool_user');
        themes.apply(localStorage.getItem('nhl_pool_theme') || 'dark-classic');
        router.navigate('login');
    }

    async function loadAppData() {
        const [users, games, picks, teamThemes] = await Promise.all([
            api.get('get_users'),
            api.get('get_games'),
            api.get('get_picks'),
            api.get('get_themes'),
        ]);
        state.data.users      = users;
        state.data.games      = games;
        state.data.picks      = picks;
        state.data.teamThemes = teamThemes;
    }

    // ═══════════════════════════════════════════════════
    // Utilities
    // ═══════════════════════════════════════════════════
    function escHtml(str) {
        const d = document.createElement('div');
        d.appendChild(document.createTextNode(String(str ?? '')));
        return d.innerHTML;
    }

    function resultBadge(result) {
        if (result === 'safe')    return '<span class="badge badge-success">✅ Safe</span>';
        if (result === 'penalty') return '<span class="badge badge-danger">❌ Penalty</span>';
        return '<span class="badge">⏳ Pending</span>';
    }

    function formatDate(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function isPickingLocked() {
        // Picks lock at Friday 00:00 MST and stay locked through Sunday.
        // Use Intl.DateTimeFormat parts to reliably read the day in MST/MDT.
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Denver',
                weekday: 'short',
            }).formatToParts(new Date());
            const weekday = parts.find(p => p.type === 'weekday')?.value;
            return weekday === 'Fri' || weekday === 'Sat' || weekday === 'Sun';
        } catch { return false; }
    }

    // ═══════════════════════════════════════════════════
    // Bootstrap / Init
    // ═══════════════════════════════════════════════════
    async function init() {
        // Apply theme immediately
        themes.apply(state.theme);

        // Wire up nav events
        document.querySelectorAll('.nav-link[data-view]').forEach(link => {
            link.addEventListener('click', () => {
                const target = link.dataset.view;
                if (target === 'admin' && state.currentUser?.role !== 'admin') return;
                router.navigate(target);
                // Close sidebar on mobile
                document.getElementById('app-nav')?.classList.remove('open');
            });
        });

        // Hamburger toggle
        document.getElementById('nav-toggle')?.addEventListener('click', () => {
            document.getElementById('app-nav')?.classList.toggle('open');
        });

        // Logout
        document.getElementById('btn-logout')?.addEventListener('click', handleLogout);

        ui.showLoading('Starting up…');
        try {
            const [setup, settings] = await Promise.all([
                api.get('check_setup'),
                api.get('get_settings'),
            ]);
            state.data.settings = settings;

            if (setup.setupRequired) {
                ui.hideLoading();
                router.navigate('setup');
                return;
            }

            // Try to restore session
            const saved = sessionStorage.getItem('nhl_pool_user');
            if (saved) {
                try {
                    state.currentUser = JSON.parse(saved);
                    await loadAppData();
                    showAuthNav();
                    ui.hideLoading();
                    router.navigate('dashboard');
                    setTimeout(() => NHLApi.checkAndSync(), 2500);
                    return;
                } catch {
                    sessionStorage.removeItem('nhl_pool_user');
                }
            }

            ui.hideLoading();
            router.navigate('login');
        } catch (err) {
            ui.hideLoading();
            console.error('Init error:', err);
            document.getElementById('view-login').innerHTML =
                `<div class="auth-page"><div class="auth-container"><div class="auth-card">
                 <div class="alert alert-danger">⚠️ Failed to connect to server. Please refresh.<br><small>${escHtml(err.message)}</small></div>
                 </div></div></div>`;
            router.navigate('login');
        }
    }

    // Public surface
    return { state, api, crypto, themes, router, views, ui, init };

})();

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());
