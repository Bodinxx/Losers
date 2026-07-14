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
    case 'check_setup':            handleCheckSetup();                break;
    case 'get_settings':           handleGetSettings();               break;
    case 'get_users':              handleGetUsers();                  break;
    case 'get_games':              handleGetGames();                  break;
    case 'get_picks':              handleGetPicks();                  break;
    case 'get_themes':             handleGetThemes();                 break;
    case 'setup_admin':            handleSetupAdmin($body);           break;
    case 'get_user_salt':          handleGetUserSalt();               break;
    case 'login':                  handleLogin($body);                break;
    case 'create_user':            handleCreateUser($body);           break;
    case 'send_invite':            handleSendInvite($body);           break;
    case 'update_user':            handleUpdateUser($body);           break;
    case 'change_password':        handleChangePassword($body);       break;
    case 'update_security':        handleUpdateSecurity($body);       break;
    case 'admin_reset_password':   handleAdminResetPassword($body);   break;
    case 'delete_user':            handleDeleteUser($body);           break;
    case 'save_pick':              handleSavePick($body);             break;
    case 'sync_games':             handleSyncGames($body);            break;
    case 'save_settings':          handleSaveSettings($body);         break;
    case 'admin_score':            handleAdminScore($body);           break;
    case 'get_scores':             handleGetScores();                 break;
    case 'get_security_question':  handleGetSecurityQuestion();       break;
    case 'reset_password':         handleResetPassword($body);        break;
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
        'id'           => $u['id'],
        'username'     => $u['username'],
        'role'         => $u['role'],
        'isActive'     => $u['isActive']     ?? true,
        'isFirstLogin' => $u['isFirstLogin'] ?? false,
        'hasPaid'      => $u['hasPaid']      ?? false,
        'paidAt'       => $u['paidAt']       ?? null,
        'emailOptOut'  => $u['emailOptOut']  ?? false,
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
            'securityQuestion' => $found['securityQuestion'] ?? null,
            'emailOptOut'    => $found['emailOptOut']    ?? false,
            'hasPaid'        => $found['hasPaid']        ?? false,
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
            if (array_key_exists('emailOptOut', $body)) $u['emailOptOut'] = (bool) $body['emailOptOut'];
            if (array_key_exists('hasPaid', $body)) {
                $wasPaid      = (bool) ($u['hasPaid'] ?? false);
                $u['hasPaid'] = (bool) $body['hasPaid'];
                if ($u['hasPaid']) {
                    if (!$wasPaid) {
                        $u['paidAt'] = date('c');
                    }
                } else {
                    $u['paidAt'] = null;
                }
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
            if (!empty($body['email'])) {
                $u['email'] = filter_var(trim($body['email']), FILTER_SANITIZE_EMAIL);
            }
            if (!empty($body['securityQuestion'])) {
                $u['securityQuestion'] = htmlspecialchars(trim($body['securityQuestion']), ENT_QUOTES, 'UTF-8');
            }
            if (!empty($body['securityAnswer'])) {
                $u['securityAnswer'] = hash('sha256', strtolower(trim($body['securityAnswer'])));
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

function handleUpdateSecurity(array $body): void
{
    $users            = ensureFile('users', []);
    $userId           = $body['id'] ?? '';
    $securityQuestion = trim((string)($body['securityQuestion'] ?? ''));
    $securityAnswer   = trim((string)($body['securityAnswer'] ?? ''));

    if ($userId === '' || $securityQuestion === '' || $securityAnswer === '') {
        http_response_code(400);
        echo json_encode(['error' => 'id, securityQuestion, and securityAnswer required']);
        return;
    }

    if (mb_strlen($securityQuestion) < 5 || mb_strlen($securityAnswer) < 3) {
        http_response_code(400);
        echo json_encode(['error' => 'Security question/answer too short']);
        return;
    }

    $found = false;
    foreach ($users as &$u) {
        if (($u['id'] ?? '') === $userId) {
            $u['securityQuestion'] = htmlspecialchars($securityQuestion, ENT_QUOTES, 'UTF-8');
            $u['securityAnswer']   = hash('sha256', strtolower($securityAnswer));
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

        if ($userId === '' || $hash === '' || $salt === '' || $iterations < 100000) {
            http_response_code(400);
            echo json_encode(['error' => 'id, passwordHash, and salt required; iterations must be at least 100000']);
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
        'email'          => isset($body['email'])
            ? filter_var(trim($body['email']), FILTER_SANITIZE_EMAIL)
            : '',
        'role'           => $role,
        'preferences'    => ['theme' => 'dark-classic'],
        'isFirstLogin'   => $isFirstLogin,
        'isActive'       => true,
        'hasPaid'        => false,
        'paidAt'         => null,
        'emailOptOut'    => false,
        'createdAt'      => date('c'),
        'securityQuestion' => isset($body['securityQuestion'])
            ? htmlspecialchars(trim((string) $body['securityQuestion']), ENT_QUOTES, 'UTF-8')
            : null,
        'securityAnswer' => isset($body['securityAnswer'])
            ? hash('sha256', strtolower(trim($body['securityAnswer'])))
            : null,
    ];
}

// -------------------------------------------------------
// Password / Email helpers
// -------------------------------------------------------

/**
 * Four-letter word list for generating memorable temporary passwords.
 * Two words are combined, e.g. "starcrab".
 */
const FOUR_LETTER_WORDS = [
    'acid','arch','army','arts','atom','aunt','auto','axle','baby','back',
    'bake','ball','band','bank','barn','base','bath','bead','beam','bean',
    'bear','beat','beef','beer','bell','belt','bend','best','bike','bill',
    'bird','bite','blog','blue','boat','body','bold','bolt','bond','bone',
    'book','boot','bore','born','both','bowl','burn','bush','cage','cake',
    'call','calm','came','camp','card','care','cart','case','cash','cast',
    'cave','chat','chip','chop','cite','city','clam','clap','clay','clip',
    'club','clue','coat','code','coil','coin','cold','come','cook','cool',
    'copy','cord','core','corn','cost','coup','cove','crab','crew','crop',
    'cure','curl','damp','dark','dart','data','date','dawn','dead','deal',
    'deck','deed','deep','demo','desk','dew','dial','dirt','disc','dish',
    'disk','dock','dome','door','down','drag','draw','drip','drop','drum',
    'dual','dune','dusk','dust','each','earn','ease','east','echo','edge',
    'emit','euro','even','exam','exit','face','fact','fade','fail','fair',
    'fall','fame','farm','fast','fear','feat','feed','feel','feet','fell',
    'felt','fern','file','fill','film','find','fine','fire','firm','fish',
    'fist','flag','flat','flaw','flew','flip','flow','foam','folk','font',
    'food','fool','form','fort','frog','from','fuel','full','fund','fuse',
    'gain','game','gate','gave','gaze','gear','germ','gift','give','glow',
    'glue','goal','gold','golf','good','gore','grab','grit','grip','grow',
    'gulf','gust','hack','hail','half','hall','halt','hand','hang','hard',
    'harm','have','head','heal','heap','heat','heel','help','herb','here',
    'hide','high','hill','hint','hold','hole','home','hook','hope','horn',
    'host','hour','hull','hung','hunt','hurt','icon','idea','idle','inch',
    'into','iris','iron','item','jack','jade','jazz','join','jump','just',
    'keen','keep','kick','kind','king','knit','knot','know','lake','lamp',
    'land','lane','lava','lawn','lead','leaf','lean','leap','left','lens',
    'lift','lime','line','link','lion','list','live','load','lock','loft',
    'long','look','loop','lord','lore','lure','made','mail','main','make',
    'mall','malt','mare','mark','mask','mast','mate','maze','meal','mean',
    'meat','meet','melt','memo','mesh','mild','mile','milk','mill','mine',
    'mint','mist','mode','mold','mole','moon','moor','more','moss','move',
    'much','mule','nail','navy','neck','need','nest','newt','next','node',
    'none','noon','norm','nose','note','nova','oars','oval','oven','over',
    'pace','page','pain','pair','pale','palm','park','part','pass','past',
    'path','pave','peak','pear','peel','pier','pile','pill','pine','pink',
    'pipe','plan','plum','plus','poll','polo','pond','pool','pore','port',
    'pour','prey','prod','pull','pump','pure','push','race','rack','rage',
    'rail','rain','ramp','rank','rare','rash','rate','read','real','reap',
    'reef','reel','rely','rent','rest','rice','rich','ride','ring','riot',
    'rise','risk','road','roam','roar','rock','role','roll','roof','room',
    'root','rope','rose','ruin','rule','rust','safe','sage','sail','salt',
    'sand','sane','seam','seed','seek','seem','self','sell','send','shed',
    'ship','shop','shot','show','side','sift','sign','silk','sill','sing',
    'sink','site','size','skin','skip','slab','slam','slim','slip','slot',
    'slow','slug','snap','snow','soar','sock','soil','sole','song','soon',
    'sort','soul','sour','span','spar','spun','spur','star','stem','step',
    'stew','stir','stop','stub','such','suit','surf','swan','swim','tale',
    'tall','tank','tape','task','teal','tear','teen','tent','term','test',
    'text','than','that','them','then','they','this','thud','tick','tide',
    'tile','till','time','tiny','tire','toad','tomb','tone','tool','tour',
    'town','tray','tree','trek','trim','trio','trip','trod','true','tuck',
    'tune','turf','turn','tusk','twin','type','unit','upon','user','vane',
    'vary','vast','veil','vein','verb','very','vest','view','vine','void',
    'vote','wade','wage','wake','walk','wall','wand','ward','warm','wart',
    'wave','wear','weed','week','well','went','west','wide','wild','will',
    'wind','wine','wing','wire','wise','wish','wolf','wood','wool','word',
    'wore','work','worn','wren','yell','year','zone','zoom',
];

function generateTempPassword(): string
{
    $words = FOUR_LETTER_WORDS;
    $a = $words[random_int(0, count($words) - 1)];
    $b = $words[random_int(0, count($words) - 1)];
    return $a . $b;
}

/**
 * Replicates the JS client-side PBKDF2 + SHA-256 hash used for authentication.
 * Returns [ 'hash' => base64string, 'salt' => base64string ].
 */
function computePasswordHash(string $password, int $iterations = 100000): array
{
    $saltBytes = random_bytes(32);
    $saltB64   = base64_encode($saltBytes);

    // PBKDF2-SHA256 → 32-byte raw key (matches AES-256 length from Web Crypto)
    $keyRaw = hash_pbkdf2('sha256', $password, $saltBytes, $iterations, 32, true);

    // SHA-256(keyBytes || 'nhl_pool_auth_v1') → matches hashForAuth() in app.js
    $suffix     = 'nhl_pool_auth_v1';
    $hashRaw    = hash('sha256', $keyRaw . $suffix, true);
    $hashB64    = base64_encode($hashRaw);

    return ['hash' => $hashB64, 'salt' => $saltB64];
}

/**
 * Send an email using PHP's mail() function.
 * Returns true on success, false on failure.
 */
function sendPoolEmail(string $to, string $subject, string $body): bool
{
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    $settings   = ensureFile('settings', []);
    $poolName   = $settings['poolName'] ?? 'NHL Losers Pool';
    $fromDomain = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $fromEmail  = 'noreply@' . $fromDomain;
    $headers    = implode("\r\n", [
        'From: ' . $poolName . ' <' . $fromEmail . '>',
        'Reply-To: ' . $fromEmail,
        'Content-Type: text/plain; charset=UTF-8',
        'MIME-Version: 1.0',
        'X-Mailer: NHL-Losers-Pool/1.0',
    ]);
    return mail($to, '[' . $poolName . '] ' . $subject, $body, $headers);
}

function buildInviteEmailBody(string $username, string $tempPassword, string $poolName, string $loginUrl): string
{
    return "Welcome to {$poolName}!\n\n"
        . "You have been invited to join the pool. Here are your login credentials:\n\n"
        . "  Username:          {$username}\n"
        . "  Temporary Password: {$tempPassword}\n\n"
        . "How to log in:\n"
        . "  1. Visit: {$loginUrl}\n"
        . "  2. Enter your username and the temporary password above.\n"
        . "  3. You will be prompted to set a permanent password and a security question\n"
        . "     (used for future password resets).\n\n"
        . "How to play:\n"
        . "  Each weekend, pick ONE NHL game and choose which team you think will LOSE.\n"
        . "  A correct loser pick = safe (0 points). A wrong pick = +1 penalty.\n"
        . "  The player with the fewest penalties at season end wins the pool!\n"
        . "  Picks lock every Friday at midnight MST.\n\n"
        . "If you did not request this invite, please ignore this email.\n\n"
        . "Good luck!\n"
        . "— {$poolName}\n";
}

// -------------------------------------------------------
// Handler: Send Invite (admin creates a user + emails credentials)
// -------------------------------------------------------
function handleSendInvite(array $body): void
{
    $users    = ensureFile('users', []);
    $username = strtolower(trim($body['username'] ?? ''));
    $email    = filter_var(trim($body['email'] ?? ''), FILTER_SANITIZE_EMAIL);
    $role     = in_array($body['role'] ?? 'player', ['admin', 'player'], true) ? $body['role'] : 'player';

    if ($username === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Username is required']);
        return;
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo json_encode(['error' => 'A valid email address is required to send the invite']);
        return;
    }

    foreach ($users as $u) {
        if (strtolower($u['username']) === $username) {
            http_response_code(409);
            echo json_encode(['error' => 'Username already exists']);
            return;
        }
    }

    // Auto-generate temporary password
    $tempPassword = generateTempPassword();
    $pwData       = computePasswordHash($tempPassword);

    $newUser = buildUserRecord([
        'username'     => $body['username'],
        'passwordHash' => $pwData['hash'],
        'salt'         => $pwData['salt'],
        'iterations'   => 100000,
        'email'        => $email,
        'role'         => $role,
    ], $role, true);

    $users[] = $newUser;
    writeJson('users', $users);

    // Build login URL
    $scheme   = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host     = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $script   = dirname($_SERVER['SCRIPT_NAME'] ?? '');
    $loginUrl = rtrim("{$scheme}://{$host}{$script}", '/') . '/';

    $settings = ensureFile('settings', []);
    $poolName = $settings['poolName'] ?? 'NHL Losers Pool';

    $emailBody = buildInviteEmailBody($body['username'], $tempPassword, $poolName, $loginUrl);
    $sent      = sendPoolEmail($email, 'Your invitation to ' . $poolName, $emailBody);

    echo json_encode([
        'success'      => true,
        'userId'       => $newUser['id'],
        'tempPassword' => $tempPassword,   // returned so admin can note it down
        'emailSent'    => $sent,
    ]);
}

// -------------------------------------------------------
// Handler: Get Security Question for a username
// -------------------------------------------------------
function handleGetSecurityQuestion(): void
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
            $question = $u['securityQuestion'] ?? null;
            if (!$question) {
                // User has no security question set — cannot self-serve reset
                http_response_code(404);
                echo json_encode(['error' => 'No security question set for this account. Contact the administrator.']);
                return;
            }
            echo json_encode(['securityQuestion' => $question]);
            return;
        }
    }

    // Return a generic message to avoid username enumeration
    http_response_code(404);
    echo json_encode(['error' => 'No security question found for this account.']);
}

// -------------------------------------------------------
// Handler: Self-Service Password Reset
// -------------------------------------------------------
function handleResetPassword(array $body): void
{
    $username = strtolower(trim($body['username'] ?? ''));
    $answer   = strtolower(trim($body['securityAnswer'] ?? ''));

    if ($username === '' || $answer === '') {
        http_response_code(400);
        echo json_encode(['error' => 'username and securityAnswer required']);
        return;
    }

    $users = ensureFile('users', []);
    $found = false;
    foreach ($users as &$u) {
        if (strtolower($u['username']) !== $username) continue;

        if (!($u['isActive'] ?? true)) {
            http_response_code(403);
            echo json_encode(['error' => 'Account is disabled']);
            return;
        }

        $storedAnswer = $u['securityAnswer'] ?? '';
        if ($storedAnswer === '' || !hash_equals($storedAnswer, hash('sha256', $answer))) {
            http_response_code(401);
            echo json_encode(['error' => 'Security answer is incorrect']);
            return;
        }

        $email = $u['email'] ?? '';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            http_response_code(422);
            echo json_encode(['error' => 'No email address on file. Contact the administrator to reset your password.']);
            return;
        }

        // Generate new temp password and hash it
        $tempPassword = generateTempPassword();
        $pwData       = computePasswordHash($tempPassword);

        $u['passwordHash'] = $pwData['hash'];
        $u['salt']         = $pwData['salt'];
        $u['iterations']   = 100000;
        $u['isFirstLogin'] = true;   // Force password change on next login
        $found = true;

        writeJson('users', $users);

        // Send the new temp password by email
        $settings = ensureFile('settings', []);
        $poolName = $settings['poolName'] ?? 'NHL Losers Pool';
        $scheme   = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host     = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $script   = dirname($_SERVER['SCRIPT_NAME'] ?? '');
        $loginUrl = rtrim("{$scheme}://{$host}{$script}", '/') . '/';

        $emailBody = "Hi {$u['username']},\n\n"
            . "A password reset was requested for your {$poolName} account.\n\n"
            . "Your new temporary password is:\n\n"
            . "  {$tempPassword}\n\n"
            . "Please log in at {$loginUrl} and set a new permanent password.\n\n"
            . "If you did not request this reset, contact your administrator immediately.\n\n"
            . "— {$poolName}\n";

        $sent = sendPoolEmail($email, 'Password Reset — ' . $poolName, $emailBody);

        echo json_encode(['success' => true, 'emailSent' => $sent]);
        return;
    }
    unset($u);

    if (!$found) {
        // Generic error to avoid username enumeration
        http_response_code(401);
        echo json_encode(['error' => 'Security answer is incorrect']);
    }
}
