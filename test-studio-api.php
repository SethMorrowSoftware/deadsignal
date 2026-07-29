<?php
/**
 * Dead Signal Studio — API test suite (live server).
 *
 *   php tools/media-studio/test-studio-api.php [studio-url] [user:pass] [user2:pass2]
 *
 * Needs a LIVE server and a real MySQL/MariaDB with the studio's schema applied
 * and `server/config/studio.php` carrying `enabled => true`. Start one with:
 *
 *   php -S 127.0.0.1:8090 tools/media-studio/router.php
 *
 * That is why it is not in scripts/ci-gate.sh — the gate runs without a
 * database. This exercises what unit tests structurally cannot: real SQL
 * against a real schema, real HTTP with real auth, and a real multi-megabyte
 * chunked upload. Two bugs were found by exactly this and could not have been
 * found any other way — a column that does not exist on the users table, and a
 * premature `complete` deleting every chunk already uploaded.
 *
 * ACCOUNTS. There is no sign-up endpoint, by design, so the two accounts this
 * needs come from one of two places: passed in as `name:password` arguments
 * (the way to test a remote install), or created directly against the local
 * `server/env.php` and deleted again at the end. Nothing else is left behind.
 *
 * DELETE this file from production after testing.
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo 'Forbidden: this test suite can only be run from the command line.';
    exit(1);
}

/* The studio's URL, not the site's: the API ships inside the studio folder, so
   it is always <studio>/api — the same derivation the client makes. */
$studioUrl = rtrim($argv[1] ?? 'http://127.0.0.1:8090/tools/media-studio', '/');
$base = $studioUrl . '/api';
echo "Dead Signal Studio — API tests\n";
echo "Base: $base\n" . str_repeat('=', 60) . "\n";

$pass = 0; $fail = 0; $failures = [];

function check(string $name, bool $ok, string $detail = ''): void {
    global $pass, $fail, $failures;
    if ($ok) { $pass++; } else { $fail++; $failures[] = $name . ($detail ? " — $detail" : ''); }
    echo ($ok ? "  PASS  " : "  FAIL  ") . $name . ($detail ? " — $detail" : '') . "\n";
}
function section(string $t): void { echo "\n[$t]\n"; }

/**
 * One request. Returns [status, decoded body or raw string].
 *
 * @param array|null $form multipart fields; a [filename, bytes] pair becomes a file part
 */
function req(string $path, string $method = 'GET', $body = null, ?string $token = null,
             bool $raw = false, ?array $form = null) {
    global $base;
    $headers = ['X-Requested-With: XMLHttpRequest'];
    if ($token) $headers[] = 'Authorization: Bearer ' . $token;

    $payload = null;
    if ($form !== null) {
        $boundary = '----studiotest' . bin2hex(random_bytes(8));
        $parts = '';
        foreach ($form as $k => $v) {
            if (is_array($v)) {
                $parts .= "--$boundary\r\nContent-Disposition: form-data; name=\"$k\"; filename=\"{$v[0]}\"\r\n"
                        . "Content-Type: application/octet-stream\r\n\r\n{$v[1]}\r\n";
            } else {
                $parts .= "--$boundary\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n";
            }
        }
        $payload = $parts . "--$boundary--\r\n";
        $headers[] = 'Content-Type: multipart/form-data; boundary=' . $boundary;
    } elseif ($body !== null) {
        $payload = json_encode($body);
        $headers[] = 'Content-Type: application/json';
    }

    $ch = curl_init($base . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 30,
    ]);
    if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    $out = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw) return [$status, (string) $out];
    return [$status, json_decode((string) $out, true) ?? []];
}

/** Sign in, returning a session token. */
function signin(string $name, string $password): ?string {
    [, $l] = req('/auth/login', 'POST', ['displayName' => $name, 'password' => $password]);
    return $l['token'] ?? null;
}

/**
 * The two accounts this suite runs as.
 *
 * Given on the command line (a remote install), or made here against the local
 * configuration and removed again afterwards. Accounts created here are marked
 * so the cleanup at the end only ever deletes its own.
 *
 * @return array{0: array{0:string,1:string}, 1: array{0:string,1:string}, 2: bool}
 */
function testAccounts(array $argv, string $suffix): array {
    $parse = static function (?string $arg): ?array {
        if (!is_string($arg) || !str_contains($arg, ':')) return null;
        [$n, $p] = explode(':', $arg, 2);
        return ($n !== '' && $p !== '') ? [$n, $p] : null;
    };
    $a = $parse($argv[2] ?? null);
    $b = $parse($argv[3] ?? null);
    if ($a && $b) return [$a, $b, false];

    require_once __DIR__ . '/server/StudioInstall.php';
    if (!is_file(StudioInstall::envFile())) {
        echo "\nNo local server/env.php, and no accounts were passed.\n";
        echo "  php tools/media-studio/test-studio-api.php <studio-url> name:password name2:password2\n";
        exit(1);
    }
    $env = require StudioInstall::envFile();
    try {
        $pdo = StudioInstall::connect(StudioInstall::dbConfig(is_array($env) ? $env : []));
    } catch (Throwable $e) {
        echo "\nCould not connect using server/env.php: " . $e->getMessage() . "\n";
        exit(1);
    }
    $a = ['studio_a_' . $suffix, 'CorrectHorse1'];
    $b = ['studio_b_' . $suffix, 'CorrectHorse1'];
    StudioInstall::createAccount($pdo, $a[0], $a[1]);
    StudioInstall::createAccount($pdo, $b[0], $b[1]);
    $GLOBALS['_test_pdo'] = $pdo;
    return [$a, $b, true];
}

/** Remove accounts this suite created, and the assets they own. */
function cleanupAccounts(array $names): void {
    $pdo = $GLOBALS['_test_pdo'] ?? null;
    if (!$pdo instanceof PDO) return;
    require_once __DIR__ . '/server/StudioStorage.php';
    $storage = new StudioStorage();
    foreach ($names as $name) {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE display_name = ?');
        $stmt->execute([$name]);
        $id = (int) ($stmt->fetchColumn() ?: 0);
        if (!$id) continue;
        // Rows cascade from the user; the FILES do not, and are the only thing
        // that would silently accumulate across runs.
        $storage->deleteOwnerFiles($id);
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    }
}

[$hs, $health] = req('/system/health');
if ($hs !== 200) {
    // Same fallback the client makes: on a host that will not honour the
    // rewrite in api/.htaccess the front controller answers at its own
    // filename. Testing only the rewritten path would report a broken install
    // on a host where the studio itself works fine.
    $base = $studioUrl . '/api/index.php';
    [$hs, $health] = req('/system/health');
    if ($hs === 200) echo "(no rewrite on this host — using $base)\n";
}
if ($hs !== 200) {
    echo "\nNo API at $studioUrl/api — start one first:\n";
    echo "  php -S 127.0.0.1:8090 tools/media-studio/router.php\n";
    exit(1);
}
if (($health['database'] ?? '') !== 'connected') {
    echo "\nThe API is up but has no database. Configure server/env.php and run server/migrate.php.\n";
    exit(1);
}

$suffix = bin2hex(random_bytes(4));
[$aliceAcct, $bobAcct, $mine] = testAccounts($argv, $suffix);
if ($mine) {
    // Whatever happens below — a failed check, a fatal, Ctrl-C — the accounts
    // and their files go. A suite that litters is a suite people stop running.
    register_shutdown_function('cleanupAccounts', [$aliceAcct[0], $bobAcct[0]]);
}
$alice = signin($aliceAcct[0], $aliceAcct[1]);
$bob   = signin($bobAcct[0], $bobAcct[1]);
if (!$alice || !$bob) { echo "\nCould not sign in as the test accounts.\n"; exit(1); }

[$s, $cfg] = req('/studio/config', 'GET', null, $alice);
if ($s !== 200 || empty($cfg['enabled'])) {
    echo "\nThe studio backend is disabled. Set 'enabled' => true in server/config/studio.php.\n";
    exit(1);
}

/* ============================================================== projects == */
section('projects');
[$s, $r] = req('/studio/projects', 'POST',
    ['name' => 'Dead Air', 'document' => ['tabs' => ['video' => ['v-scan' => '50']]]], $alice);
check('create a project', $s === 201 && !empty($r['project']['id']), (string) $s);
$pid = $r['project']['id'] ?? 0;

[$s, $r] = req('/studio/projects/' . $pid, 'GET', null, $alice);
check('read it back with its document',
    $s === 200 && ($r['project']['document']['tabs']['video']['v-scan'] ?? '') === '50', (string) $s);
check('the owner is reported as owner', ($r['project']['access'] ?? '') === 'owner');

section('isolation');
[$s] = req('/studio/projects/' . $pid, 'GET', null, $bob);
check('another user gets 404, not 403 (existence is not disclosed)', $s === 404, (string) $s);
[$s] = req('/studio/projects/' . $pid, 'PUT', ['document' => ['x' => 1]], $bob);
check('…and cannot write it', $s === 404, (string) $s);
[, $r] = req('/studio/projects', 'GET', null, $bob);
check('…and it is not in their listing', ($r['total'] ?? -1) === 0, (string) ($r['total'] ?? -1));

section('versions');
[$s, $r] = req('/studio/projects/' . $pid, 'PUT',
    ['document' => ['tabs' => ['video' => ['v-scan' => '90']]]], $alice);
check('update the document', $s === 200, (string) $s);
[, $r] = req('/studio/projects/' . $pid . '/versions', 'GET', null, $alice);
check('the replaced document was auto-snapshotted', count($r['versions'] ?? []) === 1,
    (string) count($r['versions'] ?? []));
$vid = $r['versions'][0]['id'] ?? 0;
[$s, $r] = req('/studio/versions/' . $vid . '/restore', 'POST', [], $alice);
check('restoring brings the old document back',
    $s === 200 && ($r['project']['document']['tabs']['video']['v-scan'] ?? '') === '50', (string) $s);

section('named versions vs autosave volume');
// The regression this pins: every save autosaves, the server keeps 50, and the
// listing used to be a flat "newest 50" — so one ordinary editing session
// after a named snapshot pushed the permanent row out of the only listing that
// exists, making it unreachable through any UI or API path.
[$s, $r] = req('/studio/projects/' . $pid . '/versions', 'POST', ['label' => 'gold master'], $alice);
check('a named snapshot can be created',
    $s === 201 && ($r['version']['is_autosave'] ?? true) === false, (string) $s);
$namedId = $r['version']['id'] ?? 0;
for ($i = 0; $i < 51; $i++) {
    [$s] = req('/studio/projects/' . $pid, 'PUT', ['document' => ['n' => $i]], $alice);
    if ($s !== 200) { check("autosave-generating save #$i", false, (string) $s); break; }
}
[, $r] = req('/studio/projects/' . $pid . '/versions', 'GET', null, $alice);
$named = array_values(array_filter($r['versions'] ?? [],
    fn ($v) => ($v['is_autosave'] ?? true) === false));
check('the named snapshot is still listed after 51 autosaving saves',
    count($named) === 1 && ($named[0]['id'] ?? 0) === $namedId,
    count($r['versions'] ?? []) . ' rows, ' . count($named) . ' named');
[$s, $r] = req('/studio/versions/' . $namedId . '/restore', 'POST', [], $alice);
check('…and can still be restored',
    $s === 200 && ($r['project']['document']['tabs']['video']['v-scan'] ?? '') === '50', (string) $s);

section('sharing');
[$s] = req('/studio/projects/' . $pid . '/shares', 'POST',
    ['user' => $bobAcct[0], 'role' => 'viewer'], $alice);
check('share with a named user', $s === 201, (string) $s);
[$s, $r] = req('/studio/projects/' . $pid, 'GET', null, $bob);
check('the grantee can read it', $s === 200 && ($r['project']['access'] ?? '') === 'viewer', (string) $s);
[$s] = req('/studio/projects/' . $pid, 'PUT', ['document' => ['x' => 1]], $bob);
check('…but a viewer cannot write (403)', $s === 403, (string) $s);
req('/studio/projects/' . $pid . '/shares', 'POST', ['user' => $bobAcct[0], 'role' => 'editor'], $alice);
[$s] = req('/studio/projects/' . $pid, 'PUT', ['name' => 'Renamed'], $bob);
check('promoting to editor allows a write', $s === 200, (string) $s);
[$s] = req('/studio/projects/' . $pid, 'DELETE', null, $bob);
check('…but an editor still cannot delete', $s === 403, (string) $s);
// This is the listing query that a live schema caught: it joins users.
[$s, $r] = req('/studio/projects/' . $pid . '/shares', 'GET', null, $alice);
check('the share listing runs against the real schema', $s === 200, (string) $s);
check('…and names the grantee',
    in_array($bobAcct[0], array_column($r['shares'] ?? [], 'grantee_name'), true));
check('…without exposing any link token',
    !array_filter($r['shares'] ?? [], fn ($x) => array_key_exists('link_token', $x)));

section('share links');
[$s] = req('/studio/projects/' . $pid . '/shares', 'POST', ['role' => 'editor'], $alice);
check('a LINK can never grant editor', $s === 400, (string) $s);
[$s, $r] = req('/studio/projects/' . $pid . '/shares', 'POST', ['role' => 'viewer'], $alice);
check('a viewer link is minted', $s === 201 && strlen($r['token'] ?? '') === 64, (string) $s);
$linkToken = $r['token'] ?? '';
$linkShareId = $r['share']['id'] ?? 0;
// The point of a link: it works for someone with no account at all.
[$s, $r] = req('/studio/shared/' . $linkToken);
check('a share link works with NO account', $s === 200 && !empty($r['project']['document']), (string) $s);
check('…is flagged read-only', ($r['readOnly'] ?? false) === true);
check('…and does not disclose the owner',
    !isset($r['project']['owner_id']) && !isset($r['project']['owner_name']));
[$s] = req('/studio/shared/' . str_repeat('a', 64));
check('a wrong token is refused', $s === 404, (string) $s);
[$s] = req('/studio/shares/' . $linkShareId, 'DELETE', null, $alice);
check('a link can be revoked', $s === 200, (string) $s);
[$s] = req('/studio/shared/' . $linkToken);
check('…and stops working at once', $s === 404, (string) $s);

/* ========================================================= chunked upload = */
section('chunked upload');
// The payload must span SEVERAL chunks or the choreography below degenerates:
// the server dictates the chunk size from the host's own PHP limits, and this
// suite once used a fixed 200 KB payload — on a host whose computed chunk size
// exceeds that, "hold the last chunk back" held back the ONLY chunk, nothing
// was uploaded, and eight checks failed in cascade on a perfectly healthy
// install. 2.5 chunks → three chunks; capped at 4 MB per chunk so a generous
// host does not force a giant test upload (smaller-than-advertised chunks are
// always acceptable to the server).
$cs = min((int) ($cfg['chunkSize'] ?? 0), 4 * 1024 * 1024);
if ($cs < 65536) { echo "\nThe server did not advertise a usable chunk size.\n"; exit(1); }
$payload = random_bytes((int) ($cs * 2.5));
$sha = hash('sha256', $payload);
[$s, $init] = req('/studio/assets/init', 'POST',
    ['sha256' => $sha, 'size' => strlen($payload), 'name' => 'clip.webm', 'kind' => 'video'], $alice);
check('init an upload', $s === 200 && !empty($init['uploadId']), (string) $s);
$uid = $init['uploadId'] ?? '';
check('the server dictates the chunk size', (int) ($init['chunkSize'] ?? 0) >= 65536,
    (string) ($init['chunkSize'] ?? 0));

$chunks = str_split($payload, $cs);
$last = count($chunks) - 1;
foreach ($chunks as $i => $c) {
    if ($i === $last) continue;                       // hold one back on purpose
    [$s] = req('/studio/assets/chunk', 'POST', null, $alice, false,
        ['uploadId' => $uid, 'index' => (string) $i, 'chunk' => ['chunk', $c]]);
    if ($s !== 200) { check("chunk $i accepted", false, (string) $s); break; }
}
[, $again] = req('/studio/assets/init', 'POST',
    ['sha256' => $sha, 'size' => strlen($payload), 'uploadId' => $uid], $alice);
check('resume reports exactly what arrived', ($again['received'] ?? []) === range(0, $last - 1),
    implode(',', $again['received'] ?? []));

[$s, $r] = req('/studio/assets/complete', 'POST',
    ['uploadId' => $uid, 'sha256' => $sha, 'size' => strlen($payload)], $alice);
check('completing early is refused, and says how far it got',
    $s >= 400 && str_contains((string) ($r['error'] ?? ''), 'bytes have arrived'), (string) ($r['error'] ?? ''));
// The regression: a premature complete used to delete every chunk received.
[, $after] = req('/studio/assets/init', 'POST',
    ['sha256' => $sha, 'size' => strlen($payload), 'uploadId' => $uid], $alice);
check('the chunks already sent SURVIVE a premature complete',
    ($after['received'] ?? []) === range(0, $last - 1), implode(',', $after['received'] ?? []));

req('/studio/assets/chunk', 'POST', null, $alice, false,
    ['uploadId' => $uid, 'index' => (string) $last, 'chunk' => ['chunk', $chunks[$last]]]);
[$s, $r] = req('/studio/assets/complete', 'POST',
    ['uploadId' => $uid, 'sha256' => $sha, 'size' => strlen($payload),
     'name' => 'clip.webm', 'kind' => 'video'], $alice);
check('…and the upload then finishes', $s === 201 && !empty($r['asset']['id']), (string) $s);
$aid = $r['asset']['id'] ?? 0;
check('the recorded size is right', ($r['asset']['size'] ?? 0) === strlen($payload),
    (string) ($r['asset']['size'] ?? 0));
check('the on-disk path is not leaked to the client', !isset($r['asset']['storage_path']));

[$s, $bytes] = req('/studio/assets/' . $aid . '/raw', 'GET', null, $alice, true);
check('the bytes round-trip byte-for-byte', $s === 200 && hash('sha256', $bytes) === $sha, (string) $s);
[$s] = req('/studio/assets/' . $aid . '/raw', 'GET', null, $bob);
check('another user cannot download it', $s === 404, (string) $s);

[, $dedupe] = req('/studio/assets/init', 'POST',
    ['sha256' => $sha, 'size' => strlen($payload)], $alice);
check('identical bytes short-circuit the whole transfer',
    ($dedupe['alreadyUploaded'] ?? false) === true);

[$s, $r] = req('/studio/assets', 'GET', null, $alice);
check('the asset is listed with quota usage',
    $s === 200 && ($r['quota']['used'] ?? 0) === strlen($payload), (string) ($r['quota']['used'] ?? 0));

$bad = random_bytes(1000);
[, $i2] = req('/studio/assets/init', 'POST',
    ['sha256' => hash('sha256', $bad), 'size' => strlen($bad)], $alice);
req('/studio/assets/chunk', 'POST', null, $alice, false,
    ['uploadId' => $i2['uploadId'], 'index' => '0', 'chunk' => ['c', random_bytes(1000)]]);
[$s, $r] = req('/studio/assets/complete', 'POST',
    ['uploadId' => $i2['uploadId'], 'sha256' => hash('sha256', $bad), 'size' => strlen($bad)], $alice);
check('a corrupted upload is refused', $s >= 400 && str_contains((string) ($r['error'] ?? ''), 'hecksum'),
    (string) ($r['error'] ?? ''));
[, $i3] = req('/studio/assets/init', 'POST',
    ['sha256' => hash('sha256', $bad), 'size' => strlen($bad), 'uploadId' => $i2['uploadId']], $alice);
check('…and its poisoned chunks ARE discarded', ($i3['received'] ?? ['x']) === []);

/* =============================================================== listing == */
section('asset listing pagination');
// A second, tiny asset — with a non-ASCII name — so there is something to page
// over and a filename worth preserving on download.
$tiny = random_bytes(1000);
$tinySha = hash('sha256', $tiny);
[, $ti] = req('/studio/assets/init', 'POST',
    ['sha256' => $tinySha, 'size' => strlen($tiny)], $alice);
req('/studio/assets/chunk', 'POST', null, $alice, false,
    ['uploadId' => $ti['uploadId'], 'index' => '0', 'chunk' => ['c', $tiny]]);
[$s, $r] = req('/studio/assets/complete', 'POST',
    ['uploadId' => $ti['uploadId'], 'sha256' => $tinySha, 'size' => strlen($tiny),
     'name' => 'café-clip.webm', 'kind' => 'video'], $alice);
check('a second asset uploads', $s === 201 && !empty($r['asset']['id']), (string) $s);
$tinyId = $r['asset']['id'] ?? 0;

[$s, $r] = req('/studio/assets?limit=1', 'GET', null, $alice);
check('the listing honours ?limit and reports the total',
    $s === 200 && count($r['assets'] ?? []) === 1 && ($r['total'] ?? 0) === 2,
    'total ' . (string) ($r['total'] ?? 'missing'));
[, $r2] = req('/studio/assets?limit=1&offset=1', 'GET', null, $alice);
check('…and ?offset reaches the rows past the first page',
    count($r2['assets'] ?? []) === 1
    && ($r2['assets'][0]['id'] ?? 0) !== ($r['assets'][0]['id'] ?? -1));

// RFC 5987: the plain filename= is an ASCII fallback; filename*= carries the
// real name, so 'café-clip.webm' does not download as 'caf__clip.webm'.
$ch = curl_init($base . '/studio/assets/' . $tinyId . '/raw');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true,
    CURLOPT_HTTPHEADER => ['X-Requested-With: XMLHttpRequest', 'Authorization: Bearer ' . $alice],
]);
$resp = (string) curl_exec($ch);
curl_close($ch);
check('a non-ASCII name is carried as an RFC 5987 filename*',
    stripos($resp, "filename*=UTF-8''caf%C3%A9-clip.webm") !== false,
    preg_match('/Content-Disposition:[^\r\n]*/i', $resp, $m) ? trim($m[0]) : 'header missing');

/* ========================================================== upload bounds == */
section('upload bounds');
// Dedupe answers BEFORE the size/quota checks: re-initing bytes the server
// already stores must short-circuit even when the declared size alone would be
// refused — near quota, the old order double-counted the stored copy and
// refused a transfer that needed zero new bytes.
[$s, $r] = req('/studio/assets/init', 'POST',
    ['sha256' => $tinySha, 'size' => 999999999999], $alice);
check('re-initing stored bytes short-circuits before size and quota checks',
    $s === 200 && ($r['alreadyUploaded'] ?? false) === true, (string) $s);

// A session may never accumulate more than it declared (plus one chunk of
// slack) — without this bound, a session that never calls complete could hold
// 100000 × 2·chunkSize in tmp/, bypassing quota entirely.
$declared = 1000;
$boundSha = hash('sha256', 'bound-' . $suffix);
[, $bi] = req('/studio/assets/init', 'POST',
    ['sha256' => $boundSha, 'size' => $declared], $alice);
$serverChunk = (int) ($cfg['chunkSize'] ?? 0);
$lastStatus = 0; $lastErr = ''; $sent = 0;
for ($i = 0; $i < 16; $i++) {
    [$lastStatus, $rb] = req('/studio/assets/chunk', 'POST', null, $alice, false,
        ['uploadId' => $bi['uploadId'], 'index' => (string) $i, 'chunk' => ['c', random_bytes($cs)]]);
    if ($lastStatus !== 200) { $lastErr = (string) ($rb['error'] ?? ''); break; }
    $sent += $cs;
    if ($sent > $declared + $serverChunk) break; // should have been refused already
}
check('a session cannot accumulate more bytes than it declared',
    $lastStatus === 400 && str_contains($lastErr, 'declared'), $lastStatus . ' ' . $lastErr);
// A deliberate checksum mismatch discards the test session so nothing lingers.
req('/studio/assets/complete', 'POST',
    ['uploadId' => $bi['uploadId'], 'sha256' => $boundSha, 'size' => 0], $alice);

// Sessions that never complete are bounded per user too: their DECLARED bytes
// may not exceed the quota, so init-and-abandon cannot hold unbounded tmp/.
$maxAsset = (int) ($cfg['maxAssetSize'] ?? 0);
$quota = (int) ($cfg['quota']['quota'] ?? 0);
$budget = $quota > 0 ? $quota : $maxAsset * 4;
if ($maxAsset > 0 && intdiv($budget, $maxAsset) <= 20) {
    $okInits = 0; $refused = ''; $flight = [];
    for ($i = 0; $i < intdiv($budget, $maxAsset) + 2; $i++) {
        [$s, $r] = req('/studio/assets/init', 'POST',
            ['sha256' => hash('sha256', "flight-$i-$suffix"), 'size' => $maxAsset], $alice);
        if ($s === 200 && !empty($r['uploadId'])) { $okInits++; $flight[$i] = $r['uploadId']; continue; }
        $refused = (string) ($r['error'] ?? ''); break;
    }
    check('in-flight declared bytes are capped at the quota',
        $okInits >= 2 && str_contains($refused, 'in flight'), "$okInits ok, then: $refused");
    // Discard each flight session: one bogus byte, then a mismatching complete.
    foreach ($flight as $n => $fid) {
        req('/studio/assets/chunk', 'POST', null, $alice, false,
            ['uploadId' => $fid, 'index' => '0', 'chunk' => ['c', 'x']]);
        req('/studio/assets/complete', 'POST',
            ['uploadId' => $fid, 'sha256' => hash('sha256', "flight-$n-$suffix"), 'size' => 0], $alice);
    }
} else {
    echo "  SKIP  in-flight cap (quota/max_asset_size ratio too large to probe politely)\n";
}

/* ================================================================ guards == */
section('input guards');
[$s, $r] = req('/studio/projects', 'POST',
    ['name' => 'Evil', 'document' => ['a' => ['__proto__' => ['x' => 1]]]], $alice);
check('a prototype key anywhere in a document is refused',
    $s === 400 && str_contains((string) ($r['error'] ?? ''), 'reserved'), (string) $s);
// Sized from what the server ADVERTISES, not from a constant: the cap is a
// per-deployment setting, and a fixed 2 MB payload silently stopped testing
// anything the moment a host was configured with a larger one.
$docCap = max(1024, (int) ($cfg['maxDocumentSize'] ?? 4194304));
[$s] = req('/studio/projects', 'POST',
    ['name' => 'Big', 'document' => ['x' => str_repeat('y', $docCap + 1024)]], $alice);
check('a document over the advertised cap is refused (413)', $s === 413,
    $s . ' at ' . $docCap . ' bytes');
[$s] = req('/studio/projects', 'POST', ['name' => '', 'document' => []], $alice);
check('a nameless project is refused', $s === 400, (string) $s);
[$s] = req('/studio/projects', 'POST', ['name' => 'x', 'document' => 'not-an-object'], $alice);
check('a non-object document is refused', $s === 400, (string) $s);

// CSRF: the middleware requires X-Requested-With on every mutating request.
$ch = curl_init($base . '/studio/projects');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => 'POST',
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $alice],
    CURLOPT_POSTFIELDS => json_encode(['name' => 'csrf', 'document' => []]),
]);
curl_exec($ch);
$csrf = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
check('a mutating request without X-Requested-With is refused', $csrf === 403, (string) $csrf);

[$s] = req('/studio/projects/' . $pid, 'DELETE', null, $alice);
check('the owner can delete the project', $s === 200, (string) $s);

echo "\n" . str_repeat('=', 60) . "\n";
echo "Results: $pass/" . ($pass + $fail) . " passed" . ($fail ? " ($fail failed)" : '') . "\n";
if ($failures) { echo "\nNeeds attention:\n"; foreach ($failures as $f) echo "  - $f\n"; }
exit($fail > 0 ? 1 : 0);
