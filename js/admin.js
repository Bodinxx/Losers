/**
 * NHL Losers Pool — Admin Dashboard Utilities
 * admin.js
 *
 * Handles:
 *  - Admin panel view rendering
 *  - Manual scoring overrides
 *  - User management (create / edit / delete)
 *  - Settings management
 *  - Sync status indicator
 */

'use strict';

const Admin = (() => {

    // -------------------------------------------------------
    // Sync status indicator (shown in admin panel)
    // -------------------------------------------------------
    function setSyncStatus(state, message) {
        const el = document.getElementById('sync-status-text');
        const dot = document.getElementById('sync-dot');
        if (!el || !dot) return;
        el.textContent = message;
        dot.className  = `sync-dot ${state}`;
    }

    // -------------------------------------------------------
    // Render the full Admin view
    // -------------------------------------------------------
    function renderAdmin() {
        const container = document.getElementById('view-admin');
        const settings  = App.state.data.settings;
        const users     = App.state.data.users;
        const games     = App.state.data.games;
        const picks     = App.state.data.picks;

        // Count players (role === 'player')
        const playerCount  = users.filter(u => u.role === 'player').length;
        const paidPlayers  = users.filter(u => u.role === 'player' && u.hasPaid).length;
        const pendingPicks = picks.filter(p => p.result === null).length;
        const totalPicks   = picks.length;

        const lastSync     = settings.lastSyncDate
            ? new Date(settings.lastSyncDate).toLocaleString()
            : 'Never';

        container.innerHTML = `
            <div class="app-content">
                <div class="page-header">
                    <h2>⚙️ Admin Panel</h2>
                    <p>Manage pool settings, users, and scoring.</p>
                </div>

                <!-- Stats row -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">${playerCount}</div>
                        <div class="stat-label">Players</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">$${(playerCount * (settings.buyIn || 0)).toFixed(0)}</div>
                        <div class="stat-label">Pool Total</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${paidPlayers}/${playerCount}</div>
                        <div class="stat-label">Paid Players</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">$${(paidPlayers * (settings.buyIn || 0)).toFixed(0)}</div>
                        <div class="stat-label">Collected</div>
                    </div>
                </div>

                <div class="admin-grid">
                    <!-- Quick actions -->
                    <div class="card">
                        <div class="card-header"><h3>⚡ Quick Actions</h3></div>
                        <div class="card-body" style="display:flex;flex-direction:column;gap:.75rem;">
                            <button class="admin-action-btn" id="btn-manual-sync">
                                <span class="action-icon">🔄</span>
                                <div>
                                    <div class="action-title">Sync NHL Schedule</div>
                                    <div class="action-desc">Fetch latest games & scores from NHL API</div>
                                </div>
                            </button>
                            <button class="admin-action-btn" id="btn-add-user">
                                <span class="action-icon">➕</span>
                                <div>
                                    <div class="action-title">Invite User</div>
                                    <div class="action-desc">Create a user and issue a temporary password</div>
                                </div>
                            </button>
                            <button class="admin-action-btn" id="btn-reset-user-password">
                                <span class="action-icon">🔑</span>
                                <div>
                                    <div class="action-title">Reset User Password</div>
                                    <div class="action-desc">Force password reset on next login</div>
                                </div>
                            </button>
                            <button class="admin-action-btn" id="btn-score-game">
                                <span class="action-icon">🏒</span>
                                <div>
                                    <div class="action-title">Manual Score Override</div>
                                    <div class="action-desc">Resolve picks for a specific game</div>
                                </div>
                            </button>
                            <button class="admin-action-btn" id="btn-pool-settings">
                                <span class="action-icon">💰</span>
                                <div>
                                    <div class="action-title">Pool Settings</div>
                                    <div class="action-desc">Buy-in amount, pool name, season</div>
                                </div>
                            </button>
                        </div>
                    </div>

                    <!-- Sync status -->
                    <div class="card">
                        <div class="card-header"><h3>📡 Sync Status</h3></div>
                        <div class="card-body" style="display:flex;flex-direction:column;gap:.875rem;">
                            <div class="sync-status">
                                <div class="sync-dot ${settings.lastSyncDate ? 'synced' : 'pending'}" id="sync-dot"></div>
                                <span id="sync-status-text">Last sync: ${lastSync}</span>
                            </div>
                            <div class="text-secondary" style="font-size:.8rem;">
                                <p>🗓️ Season: <strong>${settings.seasonYear || '—'}</strong></p>
                                <p class="mt-2">📦 Games in database: <strong>${games.length}</strong></p>
                                <p class="mt-2">📝 Picks recorded: <strong>${totalPicks}</strong></p>
                                <p class="mt-2">⏳ Pending picks: <strong>${pendingPicks}</strong></p>
                                <p class="mt-2">💳 Players paid: <strong>${paidPlayers}</strong></p>
                            </div>
                            <div id="sync-alert"></div>
                        </div>
                    </div>
                </div>

                <!-- User management table -->
                <div class="card mt-4" style="margin-top:1.5rem;">
                    <div class="card-header">
                        <h3>👥 User Management</h3>
                        <button class="btn btn-primary btn-sm" id="btn-add-user-2">+ Invite User</button>
                    </div>
                    <div class="table-wrapper">
                        ${buildUserTable(users)}
                    </div>
                </div>

                <!-- Recent games -->
                <div class="card" style="margin-top:1.5rem;">
                    <div class="card-header">
                        <h3>🎮 Recent Games</h3>
                        <span class="text-secondary" style="font-size:.8rem;">${games.length} total</span>
                    </div>
                    <div class="table-wrapper">
                        ${buildGamesTable(games.slice(-20).reverse())}
                    </div>
                </div>
            </div>
        `;

        // Event listeners
        document.getElementById('btn-manual-sync').addEventListener('click', async () => {
            await NHLApi.manualSync();
        });
        document.getElementById('btn-add-user').addEventListener('click',   () => showAddUserModal());
        document.getElementById('btn-add-user-2').addEventListener('click', () => showAddUserModal());
        document.getElementById('btn-reset-user-password').addEventListener('click', () => showAdminResetPasswordModal());
        document.getElementById('btn-score-game').addEventListener('click', () => showScoreModal());
        document.getElementById('btn-pool-settings').addEventListener('click', () => showSettingsModal());

        // User table actions (delegated)
        container.addEventListener('click', (e) => {
            const editBtn   = e.target.closest('.btn-edit-user');
            const deleteBtn = e.target.closest('.btn-delete-user');
            const toggleBtn = e.target.closest('.btn-toggle-user');
            const paidBtn   = e.target.closest('.btn-paid-user');
            const resetBtn  = e.target.closest('.btn-reset-password-user');
            if (editBtn)   showEditUserModal(editBtn.dataset.userId);
            if (deleteBtn) confirmDeleteUser(deleteBtn.dataset.userId, deleteBtn.dataset.username);
            if (toggleBtn) toggleUserActive(toggleBtn.dataset.userId, toggleBtn.dataset.active === 'true');
            if (paidBtn)   toggleUserPaid(paidBtn.dataset.userId, paidBtn.dataset.paid === 'true');
            if (resetBtn)  showAdminResetPasswordModal(resetBtn.dataset.userId);
        });
    }

    // -------------------------------------------------------
    // User table HTML
    // -------------------------------------------------------
    function buildUserTable(users) {
        if (users.length === 0) {
            return '<p style="padding:1.5rem;color:var(--text-secondary);">No users found.</p>';
        }
        const rows = users.map(u => `
            <tr>
                <td><div class="player-cell">
                    <div class="player-avatar">${u.username.charAt(0).toUpperCase()}</div>
                    <span>${escHtml(u.username)}</span>
                </div></td>
                <td><span class="badge ${u.role === 'admin' ? 'badge-warning' : ''}">${escHtml(u.role)}</span></td>
                <td>${u.isActive
                    ? '<span class="badge badge-success">Active</span>'
                    : '<span class="badge badge-danger">Inactive</span>'}</td>
                <td>${u.isFirstLogin
                    ? '<span class="badge">Password Reset Required</span>'
                    : '<span class="badge badge-success">Ready</span>'}</td>
                <td>${u.hasPaid
                    ? `<span class="badge badge-success">Paid${u.paidAt ? ` · ${escHtml(new Date(u.paidAt).toLocaleDateString())}` : ''}</span>`
                    : '<span class="badge badge-warning">Unpaid</span>'}</td>
                <td style="text-align:right;white-space:nowrap;">
                    <button class="btn btn-ghost btn-sm btn-edit-user" data-user-id="${u.id}" title="Edit">✏️</button>
                    <button class="btn btn-ghost btn-sm btn-reset-password-user" data-user-id="${u.id}" title="Reset Password">🔑</button>
                    <button class="btn btn-ghost btn-sm btn-toggle-user"
                        data-user-id="${u.id}" data-active="${u.isActive}"
                        title="${u.isActive ? 'Deactivate' : 'Activate'}">
                        ${u.isActive ? '🔒' : '🔓'}
                    </button>
                    ${u.role === 'player' ? `<button class="btn btn-ghost btn-sm btn-paid-user"
                        data-user-id="${u.id}" data-paid="${u.hasPaid ? 'true' : 'false'}"
                        title="${u.hasPaid ? 'Mark unpaid' : 'Mark paid'}">
                        ${u.hasPaid ? '💸' : '💳'}
                    </button>` : ''}
                    ${u.role !== 'admin' ? `<button class="btn btn-ghost btn-sm btn-delete-user"
                        data-user-id="${u.id}" data-username="${escHtml(u.username)}" title="Delete">🗑️</button>` : ''}
                </td>
            </tr>
        `).join('');
        return `<table>
            <thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Login State</th><th>Payment</th><th style="text-align:right;">Actions</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    // -------------------------------------------------------
    // Games table HTML
    // -------------------------------------------------------
    function buildGamesTable(games) {
        if (games.length === 0) {
            return '<p style="padding:1.5rem;color:var(--text-secondary);">No games synced yet.</p>';
        }
        const rows = games.map(g => {
            const score   = (g.homeScore !== null && g.awayScore !== null)
                ? `${g.awayScore} – ${g.homeScore}` : '—';
            const outcome = g.gameOutcome || '';
            const state   = g.gameState  || 'FUT';
            return `<tr>
                <td>${escHtml(g.gameDate || '—')}</td>
                <td><strong>${escHtml(g.awayAbbr||'?')}</strong> @ <strong>${escHtml(g.homeAbbr||'?')}</strong></td>
                <td>${score} ${outcome ? `<span class="badge">${outcome}</span>` : ''}</td>
                <td><span class="badge ${state === 'OFF' || state === 'FINAL' ? 'badge-success' : ''}">${state}</span></td>
                <td>
                    ${(state === 'OFF' || state === 'FINAL') && !g.winnerTeam
                        ? `<button class="btn btn-sm btn-primary" onclick="Admin.promptScoreGame('${g.gameId}','${g.homeAbbr}','${g.awayAbbr}')">Score</button>`
                        : (g.winnerTeam ? `<span class="text-success">W: ${escHtml(g.winnerTeam)}</span>` : '')}
                </td>
            </tr>`;
        }).join('');
        return `<table>
            <thead><tr><th>Date</th><th>Matchup</th><th>Score</th><th>State</th><th>Scoring</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    // -------------------------------------------------------
    // Modal: Add User
    // -------------------------------------------------------
    function showAddUserModal() {
        App.ui.showModal('Invite User', `
            <div id="add-user-alert"></div>
            <form id="add-user-form">
                <div class="form-group">
                    <label class="form-label">Username</label>
                    <input type="text" id="au-username" class="form-input" placeholder="e.g. hockeyFan99" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Temporary Password</label>
                    <input type="password" id="au-password" class="form-input" placeholder="Temporary password" required>
                    <p class="form-hint">Player must change this on first login.</p>
                </div>
                <div class="form-group">
                    <label class="form-label">Email (optional)</label>
                    <input type="email" id="au-email" class="form-input" placeholder="player@example.com">
                </div>
                <div class="form-group">
                    <label class="form-label">Role</label>
                    <select id="au-role" class="form-select">
                        <option value="player">Player</option>
                        <option value="admin">Admin</option>
                    </select>
                </div>
                <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                    <button type="button" class="btn btn-ghost" onclick="App.ui.closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="au-submit">Invite User</button>
                </div>
            </form>
        `);

        document.getElementById('add-user-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn      = document.getElementById('au-submit');
            const alertEl  = document.getElementById('add-user-alert');
            const username = document.getElementById('au-username').value.trim();
            const password = document.getElementById('au-password').value;
            const email    = document.getElementById('au-email').value.trim();
            const role     = document.getElementById('au-role').value;

            alertEl.innerHTML = '';
            if (password.length < 8) {
                alertEl.innerHTML = App.ui.alertHTML('Password must be at least 8 characters.', 'danger');
                return;
            }

            btn.disabled    = true;
            btn.innerHTML   = '<span class="spinner"></span> Creating…';

            try {
                const salt   = App.crypto.generateSalt();
                const key    = await App.crypto.deriveKey(password, salt);
                const pHash  = await App.crypto.hashForAuth(key);
                let encEmail = '', iv = '';
                if (email) {
                    const enc = await App.crypto.encryptEmail(email, key);
                    encEmail  = enc.encrypted;
                    iv        = enc.iv;
                }

                const res = await App.api.post('create_user', {
                    username, passwordHash: pHash, encryptedEmail: encEmail,
                    iv, salt, iterations: 100000, role,
                });

                alertEl.innerHTML = App.ui.alertHTML(`Invite created for "${username}".`, 'success');
                // Refresh user list
                App.state.data.users = await App.api.get('get_users');
                setTimeout(() => { App.ui.closeModal(); renderAdmin(); }, 1200);
            } catch (err) {
                alertEl.innerHTML = App.ui.alertHTML(err.message || 'Failed to create user.', 'danger');
                btn.disabled = false;
                btn.textContent = 'Invite User';
            }
        });
    }

    // -------------------------------------------------------
    // Modal: Edit User
    // -------------------------------------------------------
    function showEditUserModal(userId) {
        const user = App.state.data.users.find(u => u.id === userId);
        if (!user) return;

        App.ui.showModal('Edit User', `
            <div id="eu-alert"></div>
            <div class="form-group">
                <label class="form-label">Username</label>
                <input type="text" class="form-input" value="${escHtml(user.username)}" disabled>
            </div>
            <div class="form-group">
                <label class="form-label">Role</label>
                <select id="eu-role" class="form-select">
                    <option value="player" ${user.role === 'player' ? 'selected' : ''}>Player</option>
                    <option value="admin"  ${user.role === 'admin'  ? 'selected' : ''}>Admin</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Status</label>
                <select id="eu-active" class="form-select">
                    <option value="1" ${user.isActive ? 'selected' : ''}>Active</option>
                    <option value="0" ${!user.isActive ? 'selected' : ''}>Inactive</option>
                </select>
            </div>
            <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                <button type="button" class="btn btn-ghost" onclick="App.ui.closeModal()">Cancel</button>
                <button type="button" class="btn btn-primary" id="eu-save">Save Changes</button>
            </div>
        `);

        document.getElementById('eu-save').addEventListener('click', async () => {
            const alertEl = document.getElementById('eu-alert');
            alertEl.innerHTML = '';
            const role   = document.getElementById('eu-role').value;
            const active = document.getElementById('eu-active').value === '1';
            try {
                await App.api.post('update_user', { id: userId, role, isActive: active });
                App.state.data.users = await App.api.get('get_users');
                App.ui.closeModal();
                renderAdmin();
            } catch (err) {
                alertEl.innerHTML = App.ui.alertHTML(err.message, 'danger');
            }
        });
    }

    // -------------------------------------------------------
    // Confirm + delete user
    // -------------------------------------------------------
    function confirmDeleteUser(userId, username) {
        App.ui.showModal('Delete User', `
            <p>Are you sure you want to permanently delete <strong>${escHtml(username)}</strong>?
               This cannot be undone.</p>
            <div id="del-alert" style="margin-top:.75rem;"></div>
            <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                <button class="btn btn-ghost" onclick="App.ui.closeModal()">Cancel</button>
                <button class="btn btn-danger" id="del-confirm">Delete</button>
            </div>
        `);
        document.getElementById('del-confirm').addEventListener('click', async () => {
            try {
                await App.api.post('delete_user', { id: userId });
                App.state.data.users = await App.api.get('get_users');
                App.ui.closeModal();
                renderAdmin();
            } catch (err) {
                document.getElementById('del-alert').innerHTML = App.ui.alertHTML(err.message, 'danger');
            }
        });
    }

    // -------------------------------------------------------
    // Toggle user active state quickly
    // -------------------------------------------------------
    async function toggleUserActive(userId, currentlyActive) {
        try {
            await App.api.post('update_user', { id: userId, isActive: !currentlyActive });
            App.state.data.users = await App.api.get('get_users');
            renderAdmin();
        } catch (err) {
            App.ui.toast(err.message, 'danger');
        }
    }

    async function toggleUserPaid(userId, currentlyPaid) {
        try {
            await App.api.post('update_user', { id: userId, hasPaid: !currentlyPaid });
            App.state.data.users = await App.api.get('get_users');
            renderAdmin();
        } catch (err) {
            App.ui.toast(err.message, 'danger');
        }
    }

    function showAdminResetPasswordModal(initialUserId = null) {
        const users = App.state.data.users.filter(u => u.isActive);
        if (users.length === 0) {
            App.ui.showModal('Reset User Password', `
                <p class="text-secondary">No active users found.</p>
                <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                    <button class="btn btn-ghost" onclick="App.ui.closeModal()">Close</button>
                </div>
            `);
            return;
        }

        const options = users.map(u => `
            <option value="${u.id}" ${u.id === initialUserId ? 'selected' : ''}>
                ${escHtml(u.username)} (${escHtml(u.role)})
            </option>
        `).join('');

        App.ui.showModal('Reset User Password', `
            <div id="arp-alert"></div>
            <div class="form-group">
                <label class="form-label">User</label>
                <select id="arp-user" class="form-select">${options}</select>
            </div>
            <div class="form-group">
                <label class="form-label">Temporary Password</label>
                <input id="arp-password" type="password" class="form-input" placeholder="Minimum 8 characters" required>
                <p class="form-hint">User will be forced to set a new password at next login.</p>
            </div>
            <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                <button class="btn btn-ghost" onclick="App.ui.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="arp-submit">Reset Password</button>
            </div>
        `);

        document.getElementById('arp-submit').addEventListener('click', async () => {
            const alertEl = document.getElementById('arp-alert');
            const btn = document.getElementById('arp-submit');
            const userId = document.getElementById('arp-user').value;
            const password = document.getElementById('arp-password').value;

            alertEl.innerHTML = '';
            if (password.length < 8) {
                alertEl.innerHTML = App.ui.alertHTML('Temporary password must be at least 8 characters.', 'danger');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Resetting…';
            try {
                const salt = App.crypto.generateSalt();
                const key = await App.crypto.deriveKey(password, salt);
                const pHash = await App.crypto.hashForAuth(key);
                await App.api.post('admin_reset_password', {
                    id: userId,
                    passwordHash: pHash,
                    salt,
                    iterations: 100000,
                });
                App.state.data.users = await App.api.get('get_users');
                alertEl.innerHTML = App.ui.alertHTML('Password reset. User must set a new password on next login.', 'success');
                setTimeout(() => { App.ui.closeModal(); renderAdmin(); }, 900);
            } catch (err) {
                alertEl.innerHTML = App.ui.alertHTML(err.message || 'Password reset failed.', 'danger');
                btn.disabled = false;
                btn.textContent = 'Reset Password';
            }
        });
    }

    // -------------------------------------------------------
    // Modal: Manual score override
    // -------------------------------------------------------
    function showScoreModal() {
        const games = App.state.data.games.filter(
            g => (g.gameState === 'OFF' || g.gameState === 'FINAL') && !g.winnerTeam
        );

        if (games.length === 0) {
            App.ui.showModal('Manual Score Override', `
                <p class="text-secondary">No unscored final games found. Run a sync first.</p>
                <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                    <button class="btn btn-ghost" onclick="App.ui.closeModal()">Close</button>
                </div>
            `);
            return;
        }

        const options = games.map(g =>
            `<option value="${g.gameId}|${g.homeAbbr}|${g.awayAbbr}">
                ${g.awayAbbr} @ ${g.homeAbbr} — ${g.gameDate || ''}
             </option>`
        ).join('');

        App.ui.showModal('Manual Score Override', `
            <div id="score-alert"></div>
            <div class="form-group">
                <label class="form-label">Select Game</label>
                <select id="score-game-select" class="form-select">${options}</select>
            </div>
            <div class="form-group">
                <label class="form-label">Winning Team Abbreviation</label>
                <input type="text" id="score-winner" class="form-input"
                    placeholder="e.g. TOR" maxlength="4" style="text-transform:uppercase;">
                <p class="form-hint">Enter the 3-letter abbreviation of the team that WON.</p>
            </div>
            <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                <button class="btn btn-ghost" onclick="App.ui.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="score-submit">Apply Score</button>
            </div>
        `);

        document.getElementById('score-winner').addEventListener('input', function() {
            this.value = this.value.toUpperCase();
        });

        // Pre-fill winner when game selected
        document.getElementById('score-game-select').addEventListener('change', function() {
            const [, homeAbbr, awayAbbr] = this.value.split('|');
            document.getElementById('score-winner').placeholder = `e.g. ${homeAbbr} or ${awayAbbr}`;
        });

        document.getElementById('score-submit').addEventListener('click', async () => {
            const alertEl   = document.getElementById('score-alert');
            const gameValue = document.getElementById('score-game-select').value;
            const winner    = document.getElementById('score-winner').value.trim().toUpperCase();
            const gameId    = gameValue.split('|')[0];

            if (!winner) {
                alertEl.innerHTML = App.ui.alertHTML('Please enter the winning team abbreviation.', 'danger');
                return;
            }
            try {
                const result = await App.api.post('admin_score', { gameId, winnerTeam: winner });
                alertEl.innerHTML = App.ui.alertHTML(`Scored! ${result.updated} picks updated.`, 'success');
                App.state.data.picks = await App.api.get('get_picks');
                setTimeout(() => { App.ui.closeModal(); renderAdmin(); }, 1200);
            } catch (err) {
                alertEl.innerHTML = App.ui.alertHTML(err.message, 'danger');
            }
        });
    }

    // -------------------------------------------------------
    // Prompt score for a specific game (called from games table)
    // -------------------------------------------------------
    function promptScoreGame(gameId, homeAbbr, awayAbbr) {
        App.ui.showModal(`Score: ${awayAbbr} @ ${homeAbbr}`, `
            <div id="ps-alert"></div>
            <div class="form-group">
                <label class="form-label">Winning Team</label>
                <select id="ps-winner" class="form-select">
                    <option value="${homeAbbr}">${homeAbbr} (Home)</option>
                    <option value="${awayAbbr}">${awayAbbr} (Away)</option>
                </select>
            </div>
            <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                <button class="btn btn-ghost" onclick="App.ui.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="ps-submit">Apply Score</button>
            </div>
        `);
        document.getElementById('ps-submit').addEventListener('click', async () => {
            const winner  = document.getElementById('ps-winner').value;
            const alertEl = document.getElementById('ps-alert');
            try {
                const result = await App.api.post('admin_score', { gameId, winnerTeam: winner });
                alertEl.innerHTML = App.ui.alertHTML(`${result.updated} picks scored.`, 'success');
                App.state.data.picks = await App.api.get('get_picks');
                setTimeout(() => { App.ui.closeModal(); renderAdmin(); }, 1200);
            } catch (err) {
                alertEl.innerHTML = App.ui.alertHTML(err.message, 'danger');
            }
        });
    }

    // -------------------------------------------------------
    // Modal: Pool Settings
    // -------------------------------------------------------
    function showSettingsModal() {
        const s = App.state.data.settings;
        App.ui.showModal('Pool Settings', `
            <div id="ps2-alert"></div>
            <div class="form-group">
                <label class="form-label">Pool Name</label>
                <input type="text" id="ps2-name" class="form-input"
                    value="${escHtml(s.poolName || 'NHL Losers Pool')}" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Buy-In ($)</label>
                    <input type="number" id="ps2-buyin" class="form-input"
                        value="${s.buyIn || 20}" min="1" max="10000" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Season Year</label>
                    <input type="number" id="ps2-year" class="form-input"
                        value="${s.seasonYear || new Date().getFullYear()}" min="2020" max="2035" required>
                </div>
            </div>
            <div class="modal-footer" style="padding:0;border:none;margin-top:1rem;">
                <button class="btn btn-ghost" onclick="App.ui.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="ps2-save">Save Settings</button>
            </div>
        `);
        document.getElementById('ps2-save').addEventListener('click', async () => {
            const alertEl  = document.getElementById('ps2-alert');
            const poolName = document.getElementById('ps2-name').value.trim();
            const buyIn    = parseFloat(document.getElementById('ps2-buyin').value);
            const year     = parseInt(document.getElementById('ps2-year').value, 10);
            try {
                const result = await App.api.post('save_settings', { poolName, buyIn, seasonYear: year });
                App.state.data.settings = result.settings;
                alertEl.innerHTML = App.ui.alertHTML('Settings saved!', 'success');
                setTimeout(() => { App.ui.closeModal(); renderAdmin(); }, 1000);
            } catch (err) {
                alertEl.innerHTML = App.ui.alertHTML(err.message, 'danger');
            }
        });
    }

    // -------------------------------------------------------
    // Utility
    // -------------------------------------------------------
    function escHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

    return {
        renderAdmin,
        setSyncStatus,
        showAddUserModal,
        showAdminResetPasswordModal,
        promptScoreGame,
        showSettingsModal,
    };

})();
