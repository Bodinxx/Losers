<?php
/**
 * NHL Losers Pool — Secure PHP Routing Controller
 * Handles all JSON file I/O operations.
 */

declare(strict_types=1);

// Security headers
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-XSS-Protection: 1; mode=block');
header('Cache-Control: no-store, no-cache, must-revalidate');

// Block cross-origin requests
if (isset($_SERVER['HTTP_ORIGIN'])) {
    $requestHost  = $_SERVER['HTTP_HOST'] ?? '';
    $originHost   = parse_url($_SERVER['HTTP_ORIGIN'], PHP_URL_HOST) ?? '';
    if ($originHost !== $requestHost) {
        http_response_code(403);
        echo json_encode(['error' => 'Forbidden']);
        exit;
    }
}

define('DATA_DIR', __DIR__ . '/data/');

// -------------------------------------------------------
// File helpers
// -------------------------------------------------------
function readJson(string $filename): ?array
{
    $path = DATA_DIR . basename($filename) . '.json';
    if (!file_exists($path)) {
        return null;
    }
    $content = file_get_contents($path);
    return json_decode($content, true);
}

function writeJson(string $filename, array $data): bool
{
    $path = DATA_DIR . basename($filename) . '.json';
    return file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
}

function ensureFile(string $filename, array $default = []): array
{
    $data = readJson($filename);
    if ($data === null) {
        writeJson($filename, $default);
        return $default;
    }
    return $data;
}

// -------------------------------------------------------
// Input
// -------------------------------------------------------
$method = $_SERVER['REQUEST_METHOD'];
$action = trim($_GET['action'] ?? '');

$body = [];
if ($method === 'POST') {
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw, true) ?? [];
}

// -------------------------------------------------------
// Routing
// -------------------------------------------------------
switch ($action) {
    case 'check_setup':   handleCheckSetup();           break;
    case 'get_settings':  handleGetSettings();          break;
    case 'get_users':     handleGetUsers();             break;
    case 'get_games':     handleGetGames();             break;
    case 'get_picks':     handleGetPicks();             break;
    case 'get_themes':    handleGetThemes();            break;
    case 'setup_admin':   handleSetupAdmin($body);      break;
    case 'get_user_salt': handleGetUserSalt();           break;
    case 'login':         handleLogin($body);           break;
    case 'create_user':   handleCreateUser($body);      break;
    case 'update_user':   handleUpdateUser($body);      break;
    case 'change_password': handleChangePassword($body); break;
    case 'admin_reset_password': handleAdminResetPassword($body); break;
    case 'delete_user':   handleDeleteUser($body);      break;
    case 'save_pick':     handleSavePick($body);        break;
    case 'sync_games':    handleSyncGames($body);       break;
    case 'save_settings': handleSaveSettings($body);    break;
    case 'admin_score':   handleAdminScore($body);      break;
    case 'get_scores':    handleGetScores();            break;
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
        break;
}

// -------------------------------------------------------
// Handlers
// -------------------------------------------------------

function handleCheckSetup(): void
{
    $users    = ensureFile('users', []);
    $hasAdmin = false;
    foreach ($users as $u) {
        if (($u['role'] ?? '') === 'admin') {
            $hasAdmin = true;
            break;
        }
    }
    echo json_encode(['setupRequired' => !$hasAdmin]);
}

function handleGetSettings(): void
{
    $settings = ensureFile('settings', [
        'poolName'     => 'NHL Losers Pool',
        'buyIn'        => 20,
        'seasonYear'   => (int) date('Y'),
        'lastSyncDate' => null,
    ]);
    echo json_encode($settings);
}

function handleGetUsers(): void
{
    $users = ensureFile('users', []);
    // Strip sensitive fields for public listing
    $public = array_map(fn($u) => [
        'id'       => $u['id'],
        'username' => $u['username'],
        'role'     => $u['role'],
        'isActive' => $u['isActive'] ?? true,
        'isFirstLogin' => $u['isFirstLogin'] ?? false,
        'hasPaid'  => $u['hasPaid'] ?? false,
        'paidAt'   => $u['paidAt'] ?? null,
    ], $users);
    echo json_encode(array_values($public));
}

function handleGetGames(): void
{
    echo json_encode(ensureFile('games', []));
}

function handleGetPicks(): void
{
    echo json_encode(ensureFile('picks', []));
}

function handleGetThemes(): void
{
    $themes = readJson('team_themes');
    if ($themes === null) {
        http_response_code(404);
        echo json_encode(['error' => 'team_themes.json not found']);
        return;
    }
    echo json_encode($themes);
}

// Return only the salt/iterations for a username — safe to expose (no secret data)
function handleGetUserSalt(): void
{
    $username = strtolower(trim($_GET['username'] ?? ''));
    if ($username === '') {
        http_response_code(400);
        echo json_encode(['error' => 'username required']);
        return;
    }
    $users = ensureFile('users', []);
    foreach ($users as $u) {
        if (strtolower($u['username']) === $username) {
            echo json_encode([
                'salt'       => $u['salt']       ?? '',
                'iterations' => $u['iterations'] ?? 100000,
            ]);
            return;
        }
    }
    // Return a dummy response to avoid username enumeration
    echo json_encode(['salt' => '', 'iterations' => 100000]);
}

function handleGetScores(): void
{
    $picks  = ensureFile('picks', []);
    $scores = [];
    foreach ($picks as $pick) {
        $uid = $pick['userId'] ?? null;
        if (!$uid) continue;
        if (!isset($scores[$uid])) {
            $scores[$uid] = ['userId' => $uid, 'penalties' => 0, 'safe' => 0, 'pending' => 0];
        }
        switch ($pick['result'] ?? null) {
            case 'penalty': $scores[$uid]['penalties']++; break;
            case 'safe':    $scores[$uid]['safe']++;      break;
            default:        $scores[$uid]['pending']++;   break;
        }
    }
    echo json_encode(array_values($scores));
}

function handleSetupAdmin(array $body): void
{
    $users = ensureFile('users', []);
    foreach ($users as $u) {
        if (($u['role'] ?? '') === 'admin') {
            http_response_code(400);
            echo json_encode(['error' => 'Admin already exists']);
            return;
        }
    }

    $username = trim($body['username'] ?? '');
    $hash     = $body['passwordHash'] ?? '';
    if ($username === '' || $hash === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Username and passwordHash required']);
        return;
    }

    $newUser = buildUserRecord($body, 'admin', false);
    $users[] = $newUser;
    writeJson('users', $users);

    // Bootstrap other files
    ensureFile('games', []);
    ensureFile('picks', []);

    $settings = ensureFile('settings', []);
    if (!empty($body['poolName']))  $settings['poolName']   = htmlspecialchars($body['poolName'], ENT_QUOTES, 'UTF-8');
    if (!empty($body['buyIn']))     $settings['buyIn']      = (float) $body['buyIn'];
    if (!empty($body['seasonYear'])) $settings['seasonYear'] = (int) $body['seasonYear'];
    writeJson('settings', $settings);

    echo json_encode(['success' => true]);
}

function handleLogin(array $body): void
{
    $username = strtolower(trim($body['username'] ?? ''));
    $hash     = $body['passwordHash'] ?? '';

    if ($username === '' || $hash === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Username and passwordHash required']);
        return;
    }

    $users = ensureFile('users', []);
    $found = null;
    foreach ($users as $u) {
        if (strtolower($u['username']) === $username) {
            $found = $u;
            break;
        }
    }

    if ($found === null || !hash_equals((string)($found['passwordHash'] ?? ''), $hash)) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid credentials']);
        return;
    }

    if (!($found['isActive'] ?? true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Account is disabled']);
        return;
    }

    echo json_encode([
        'success'        => true,
        'user'           => [
            'id'             => $found['id'],
            'username'       => $found['username'],
            'role'           => $found['role'],
            'preferences'    => $found['preferences'] ?? [],
            'isFirstLogin'   => $found['isFirstLogin'] ?? false,
            'encryptedEmail' => $found['encryptedEmail'] ?? null,
            'iv'             => $found['iv']             ?? null,
            'salt'           => $found['salt']           ?? null,
            'iterations'     => $found['iterations']     ?? 100000,
        ],
    ]);
}

function handleCreateUser(array $body): void
{
    $users    = ensureFile('users', []);
    $username = strtolower(trim($body['username'] ?? ''));
    if ($username === '' || ($body['passwordHash'] ?? '') === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Username and passwordHash required']);
        return;
    }

    foreach ($users as $u) {
        if (strtolower($u['username']) === $username) {
            http_response_code(409);
            echo json_encode(['error' => 'Username already exists']);
            return;
        }
    }

    $role    = in_array($body['role'] ?? 'player', ['admin', 'player'], true) ? $body['role'] : 'player';
    $newUser = buildUserRecord($body, $role, true);
    $users[] = $newUser;
    writeJson('users', $users);

    echo json_encode(['success' => true, 'userId' => $newUser['id']]);
}

function handleUpdateUser(array $body): void
{
    $users  = ensureFile('users', []);
    $userId = $body['id'] ?? '';
    if ($userId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'id required']);
        return;
    }

    $found = false;
    foreach ($users as &$u) {
        if ($u['id'] === $userId) {
            if (array_key_exists('preferences', $body)) $u['preferences'] = $body['preferences'];
            if (array_key_exists('isActive', $body))    $u['isActive']    = (bool) $body['isActive'];
            if (array_key_exists('hasPaid', $body)) {
                $u['hasPaid'] = (bool) $body['hasPaid'];
                $u['paidAt']  = $u['hasPaid'] ? date('c') : null;
            }
            if (array_key_exists('role', $body) && in_array($body['role'], ['admin','player'], true)) {
                $u['role'] = $body['role'];
            }
            $found = true;
            break;
        }
    }
    unset($u);

    if (!$found) {
        http_response_code(404);
        echo json_encode(['error' => 'User not found']);
        return;
    }

    writeJson('users', $users);
    echo json_encode(['success' => true]);
}

function handleChangePassword(array $body): void
{
    $users  = ensureFile('users', []);
    $userId = $body['id'] ?? '';
    $hash   = $body['passwordHash'] ?? '';
    if ($userId === '' || $hash === '') {
        http_response_code(400);
        echo json_encode(['error' => 'id and passwordHash required']);
        return;
    }

    $found = false;
    foreach ($users as &$u) {
        if ($u['id'] === $userId) {
            $u['passwordHash']   = $hash;
            $u['encryptedEmail'] = $body['encryptedEmail'] ?? $u['encryptedEmail'];
            $u['iv']             = $body['iv']             ?? $u['iv'];
            $u['salt']           = $body['salt']           ?? $u['salt'];
            $u['iterations']     = (int) ($body['iterations'] ?? $u['iterations'] ?? 100000);
            $u['isFirstLogin']   = false;
            if (!empty($body['securityAnswer'])) {
                $u['securityAnswer'] = hash('sha256', $body['securityAnswer']);
            }
            $found = true;
            break;
        }
    }
    unset($u);

    if (!$found) {
        http_response_code(404);
        echo json_encode(['error' => 'User not found']);
        return;
    }

    writeJson('users', $users);
    echo json_encode(['success' => true]);
}

function handleDeleteUser(array $body): void
{
    $users  = ensureFile('users', []);
    $userId = $body['id'] ?? '';
    if ($userId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'id required']);
        return;
    }

    function handleAdminResetPassword(array $body): void
    {
        $users      = ensureFile('users', []);
        $userId     = $body['id'] ?? '';
        $hash       = $body['passwordHash'] ?? '';
        $salt       = $body['salt'] ?? '';
        $iterations = (int) ($body['iterations'] ?? 100000);

        if ($userId === '' || $hash === '' || $salt === '' || $iterations < 10000) {
            http_response_code(400);
            echo json_encode(['error' => 'id, passwordHash, salt, and valid iterations required']);
            return;
        }

        $found = false;
        foreach ($users as &$u) {
            if (($u['id'] ?? '') === $userId) {
                $u['passwordHash'] = $hash;
                $u['salt']         = $salt;
                $u['iterations']   = $iterations;
                $u['isFirstLogin'] = true;
                $found = true;
                break;
            }
        }
        unset($u);

        if (!$found) {
            http_response_code(404);
            echo json_encode(['error' => 'User not found']);
            return;
        }

        writeJson('users', $users);
        echo json_encode(['success' => true]);
    }

    $filtered = array_values(array_filter($users, fn($u) => $u['id'] !== $userId));
    if (count($filtered) === count($users)) {
        http_response_code(404);
        echo json_encode(['error' => 'User not found']);
        return;
    }

    writeJson('users', $filtered);
    echo json_encode(['success' => true]);
}

function handleSavePick(array $body): void
{
    $userId            = $body['userId']            ?? '';
    $gameId            = $body['gameId']            ?? '';
    $selectedLoserTeam = $body['selectedLoserTeam'] ?? '';
    $weekendId         = $body['weekendId']         ?? '';

    if ($userId === '' || $gameId === '' || $selectedLoserTeam === '' || $weekendId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'userId, gameId, selectedLoserTeam, and weekendId required']);
        return;
    }

    // Picks lock at Friday 00:00 MST
    try {
        $now       = new DateTimeImmutable('now', new DateTimeZone('America/Denver'));
        $dayOfWeek = (int) $now->format('N'); // 1=Mon … 7=Sun
        if ($dayOfWeek === 5 || $dayOfWeek === 6 || $dayOfWeek === 7) {
            http_response_code(403);
            echo json_encode(['error' => 'Picks are locked from Friday through Sunday (MST)']);
            return;
        }
    } catch (Exception $e) {
        // Timezone unavailable — allow pick
    }

    $picks = ensureFile('picks', []);

    $existingIdx = -1;
    foreach ($picks as $i => $pick) {
        if ($pick['userId'] === $userId && $pick['weekendId'] === $weekendId) {
            $existingIdx = $i;
            break;
        }
    }

    $record = [
        'userId'            => $userId,
        'gameId'            => $gameId,
        'selectedLoserTeam' => strtoupper($selectedLoserTeam),
        'weekendId'         => $weekendId,
        'timestamp'         => date('c'),
        'result'            => null,
    ];

    if ($existingIdx >= 0) {
        $picks[$existingIdx] = $record;
    } else {
        $picks[] = $record;
    }

    writeJson('picks', $picks);
    echo json_encode(['success' => true]);
}

function handleSyncGames(array $body): void
{
    $games    = ensureFile('games', []);
    $incoming = $body['games'] ?? [];

    if (empty($incoming)) {
        echo json_encode(['success' => true, 'added' => 0, 'updated' => 0, 'total' => count($games)]);
        return;
    }

    // Index existing games by gameId
    $index = [];
    foreach ($games as $i => $g) {
        $index[$g['gameId'] ?? ''] = $i;
    }

    $added = $updated = 0;
    foreach ($incoming as $ng) {
        $gid = $ng['gameId'] ?? null;
        if (!$gid) continue;
        if (isset($index[$gid])) {
            $games[$index[$gid]] = array_merge($games[$index[$gid]], $ng);
            $updated++;
        } else {
            $games[]    = $ng;
            $index[$gid] = count($games) - 1;
            $added++;
        }
    }

    writeJson('games', $games);

    $settings               = ensureFile('settings', []);
    $settings['lastSyncDate'] = date('c');
    writeJson('settings', $settings);

    echo json_encode(['success' => true, 'added' => $added, 'updated' => $updated, 'total' => count($games)]);
}

function handleSaveSettings(array $body): void
{
    $settings = ensureFile('settings', []);
    $allowed  = ['poolName', 'buyIn', 'seasonYear'];
    foreach ($allowed as $key) {
        if (array_key_exists($key, $body)) {
            $settings[$key] = match($key) {
                'buyIn'      => (float) $body[$key],
                'seasonYear' => (int)   $body[$key],
                default      => htmlspecialchars((string) $body[$key], ENT_QUOTES, 'UTF-8'),
            };
        }
    }
    writeJson('settings', $settings);
    echo json_encode(['success' => true, 'settings' => $settings]);
}

function handleAdminScore(array $body): void
{
    $gameId     = $body['gameId']     ?? '';
    $winnerTeam = strtoupper($body['winnerTeam'] ?? '');

    if ($gameId === '' || $winnerTeam === '') {
        http_response_code(400);
        echo json_encode(['error' => 'gameId and winnerTeam required']);
        return;
    }

    $picks   = ensureFile('picks', []);
    $updated = 0;
    foreach ($picks as &$pick) {
        if (($pick['gameId'] ?? '') === $gameId && ($pick['result'] ?? null) === null) {
            $selectedTeam  = strtoupper($pick['selectedLoserTeam'] ?? '');
            $pick['result'] = ($selectedTeam !== $winnerTeam) ? 'safe' : 'penalty';
            $updated++;
        }
    }
    unset($pick);

    writeJson('picks', $picks);
    echo json_encode(['success' => true, 'updated' => $updated]);
}

// -------------------------------------------------------
// Helper
// -------------------------------------------------------
function buildUserRecord(array $body, string $role, bool $isFirstLogin): array
{
    return [
        'id'             => uniqid('u_', true),
        'username'       => htmlspecialchars(trim($body['username'] ?? ''), ENT_QUOTES, 'UTF-8'),
        'passwordHash'   => $body['passwordHash']   ?? '',
        'encryptedEmail' => $body['encryptedEmail'] ?? '',
        'iv'             => $body['iv']             ?? '',
        'salt'           => $body['salt']           ?? '',
        'iterations'     => (int) ($body['iterations'] ?? 100000),
        'role'           => $role,
        'preferences'    => ['theme' => 'dark-classic'],
        'isFirstLogin'   => $isFirstLogin,
        'isActive'       => true,
        'hasPaid'        => false,
        'paidAt'         => null,
        'createdAt'      => date('c'),
        'securityAnswer' => isset($body['securityAnswer'])
            ? hash('sha256', $body['securityAnswer'])
            : null,
    ];
}
