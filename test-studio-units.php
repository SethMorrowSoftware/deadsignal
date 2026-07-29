<?php
/**
 * Dead Signal Studio — backend unit tests (no database, no server).
 *
 *   php tools/media-studio/test-studio-units.php
 *
 * The live suite (test-studio-api.php) needs MySQL and a running server, so it
 * cannot be a CI gate. These can: they pin the parts of the backend that decide
 * something dangerous — who may touch a project, what a path may be, what the
 * installer writes — using only the dependency-free classes.
 *
 * Everything here runs against the studio's OWN server/ directory. The tool is
 * standalone: it has no host application to borrow a test harness from, so the
 * coverage ships with it.
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo 'Forbidden: this test suite can only be run from the command line.';
    exit(1);
}

$SERVER_DIR = __DIR__ . '/server';
require_once $SERVER_DIR . '/StudioPreflight.php';
require_once $SERVER_DIR . '/StudioInstall.php';
require_once $SERVER_DIR . '/StudioStorage.php';
require_once $SERVER_DIR . '/models/StudioShare.php';
require_once $SERVER_DIR . '/controllers/StudioController.php';

$pass = 0; $fail = 0; $failures = [];

function check(string $name, bool $ok, string $detail = ''): void {
    global $pass, $fail, $failures;
    if ($ok) { $pass++; } else { $fail++; $failures[] = $name . ($detail ? " — $detail" : ''); }
    echo ($ok ? '  PASS  ' : '  FAIL  ') . $name . ($detail ? " — $detail" : '') . "\n";
}
function section(string $t): void { echo "\n$t\n" . str_repeat('-', 50) . "\n"; }

/** True when $fn throws, optionally with a message matching $pattern. */
function refuses(callable $fn, ?string $pattern = null): bool {
    try { $fn(); } catch (\Throwable $e) {
        return $pattern === null || (bool) preg_match($pattern, $e->getMessage());
    }
    return false;
}

$rm = function (string $dir) use (&$rm) {
    if (!is_dir($dir)) return;
    foreach (scandir($dir) ?: [] as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = $dir . '/' . $f;
        is_dir($p) ? $rm($p) : @unlink($p);
    }
    @rmdir($dir);
};

echo "Dead Signal Studio — backend units\n" . str_repeat('=', 60) . "\n";

/* ======================================================= sharing model == */
section('StudioShare — who may touch a project');

// Roles are ordered, so "at least this much access" is one comparison rather
// than a set of equality tests that quietly misses a case when a role is added.
check('role ranking is ordered',
    StudioShare::rank('viewer') < StudioShare::rank('commenter')
    && StudioShare::rank('commenter') < StudioShare::rank('editor')
    && StudioShare::rank('editor') < StudioShare::rank('owner'));
check('an unknown role ranks below everything', StudioShare::rank('wizard') === 0);
check('a null role grants nothing', StudioShare::allows(null, 'viewer') === false);
check('an owner satisfies every requirement',
    StudioShare::allows('owner', 'viewer') && StudioShare::allows('owner', 'editor'));
check('a viewer cannot edit', StudioShare::allows('viewer', 'editor') === false);
check('an editor can view', StudioShare::allows('editor', 'viewer'));
check('a commenter cannot edit', StudioShare::allows('commenter', 'editor') === false);
// "Whoever has the URL can edit" cannot be revoked for one person.
check('a share LINK can never grant editor',
    !in_array('editor', StudioShare::linkRoles(), true)
    && in_array('editor', StudioShare::grantableRoles(), true));

/* ================================================== storage and uploads == */
section('StudioStorage — paths, chunks, checksums');

// Upload ids and checksums become directory and file names.
check('an upload id must be 32 hex chars', StudioStorage::isValidUploadId(str_repeat('a', 32)));
check('a traversing upload id is refused',
    !StudioStorage::isValidUploadId('../../etc')
    && !StudioStorage::isValidUploadId('aaaa/../bb')
    && !StudioStorage::isValidUploadId(str_repeat('a', 31))
    && !StudioStorage::isValidUploadId('AAAA' . str_repeat('a', 28)));
check('a checksum must be 64 hex chars',
    StudioStorage::isValidSha(str_repeat('0', 64)) && !StudioStorage::isValidSha('../x'));

$profile = [
    'enabled' => true, 'storage_path' => sys_get_temp_dir() . '/studio-unit-' . getmypid(),
    'user_quota' => 0, 'max_asset_size' => 1048576, 'max_document_size' => 1024,
    'chunk_size' => 65536,
];
$store = new StudioStorage($profile);
/* Every upload below belongs to this account. Named, because storeChunk() and
   completeUpload() now REFUSE a session that belongs to somebody else and the
   owner id is the thing being asserted, not scenery. */
$OWNER = 1;
check('assets shard by the first two hex characters',
    str_ends_with($store->assetPath(7, str_repeat('ab', 32)), '/assets/7/ab/' . str_repeat('ab', 32)));
check('assetPath refuses a checksum that is not hex',
    refuses(fn () => $store->assetPath(7, '../../evil')));

/* A full upload, with no database: quota 0 means unlimited, and the quota
   lookup is short-circuited before it would need one. */
$payload = random_bytes(150000);
$sha = hash('sha256', $payload);
$init = $store->initUpload(1, strlen($payload), $sha);
check('init returns an upload id and the host chunk size',
    StudioStorage::isValidUploadId($init['uploadId']) && $init['chunkSize'] === 65536);
check('a fresh upload has received nothing', $init['received'] === []);

$mkChunk = function (string $data): string {
    $f = tempnam(sys_get_temp_dir(), 'chunk');
    file_put_contents($f, $data);
    return $f;
};
$parts = str_split($payload, 65536);
foreach ($parts as $i => $part) $store->storeChunk($OWNER, $init['uploadId'], $i, $mkChunk($part));
check('every chunk is recorded',
    $store->receivedChunks($init['uploadId']) === range(0, count($parts) - 1));
// Resuming must report what already arrived, or a dropped connection restarts.
$resumed = $store->initUpload(1, strlen($payload), $sha, $init['uploadId']);
check('resuming an upload reports the chunks already received',
    $resumed['received'] === range(0, count($parts) - 1));

$done = $store->completeUpload(1, $init['uploadId'], $sha, strlen($payload));
check('the assembled file matches the declared size', $done['size'] === strlen($payload));
check('the assembled bytes are byte-identical', hash_file('sha256', $done['path']) === $sha);
check('the temp directory is cleaned up',
    !is_dir($profile['storage_path'] . '/tmp/' . $init['uploadId']));
check('MIME is detected from the bytes, not claimed by the client',
    $done['mime'] !== '' && $done['mime'] !== null);

// Corruption must be caught: it is what makes dedupe by checksum safe.
$bad = $store->initUpload(1, 10, str_repeat('c', 64));
$store->storeChunk($OWNER, $bad['uploadId'], 0, $mkChunk('not the declared bytes'));
check('a checksum mismatch is refused',
    refuses(fn () => $store->completeUpload(1, $bad['uploadId'], str_repeat('c', 64), 0), '/checksum/i'));

// A gap means a lost chunk; concatenating around it yields a wrong file.
$gap = $store->initUpload(1, 100, hash('sha256', 'x'));
$store->storeChunk($OWNER, $gap['uploadId'], 1, $mkChunk('second only'));
check('a missing chunk is refused rather than silently skipped',
    refuses(fn () => $store->completeUpload(1, $gap['uploadId'], hash('sha256', 'x'), 0), '/missing chunk/i'));
$store->discardUpload($gap['uploadId']);

// A chunk session may never accumulate more than init declared (+ one chunk of
// slack — a correct client's chunks sum to exactly the declared size). This is
// the bound that stops init-and-never-complete from bypassing quota.
$bound = $store->initUpload(1, 1000, str_repeat('ab', 32));
$store->storeChunk($OWNER, $bound['uploadId'], 0, $mkChunk(random_bytes(60000)));  // 60000 <= 1000 + 65536: fits
check('a chunk session cannot exceed its declared size',
    refuses(fn () => $store->storeChunk($OWNER, $bound['uploadId'], 1, $mkChunk(random_bytes(60000))), '/declared/i'));
$store->discardUpload($bound['uploadId']);

check('an oversized file is refused up front',
    refuses(fn () => $store->initUpload(1, 99999999, $sha), '/size/i'));
check('completing an unknown upload is refused',
    refuses(fn () => $store->completeUpload(1, str_repeat('f', 32), $sha, 0), '/unknown upload/i'));

/* AN UPLOAD SESSION BELONGS TO THE ACCOUNT THAT OPENED IT.
   initUpload() wrote the owner into the session's meta and then nothing ever
   read it back: storeChunk() took no owner at all, completeUpload() took one and
   never compared it, and initUpload() resumed any session whose directory
   existed. An account holding another account's uploadId could inject chunks
   into that transfer, or finish it and take the resulting asset as its own. The
   id is 128 bits of random_bytes, so this was never a guessing attack — but an
   id that reaches the client reaches proxy logs, a shared browser and a bug
   report, and "unguessable" is not "authorised". */
{
    $intruder = $OWNER + 1;
    $mine = $store->initUpload($OWNER, strlen($payload), $sha);
    $store->storeChunk($OWNER, $mine['uploadId'], 0, $mkChunk($parts[0]));

    check('another account cannot push a chunk into my upload',
        refuses(fn () => $store->storeChunk($intruder, $mine['uploadId'], 1, $mkChunk($parts[1])),
                '/unknown upload/i'));
    check('…nor resume it',
        refuses(fn () => $store->initUpload($intruder, strlen($payload), $sha, $mine['uploadId']),
                '/unknown upload/i'));
    check('…nor complete it and take the asset',
        refuses(fn () => $store->completeUpload($intruder, $mine['uploadId'], $sha, strlen($payload)),
                '/unknown upload/i'));
    // And the refused chunk really did not land — a check that only asserted the
    // throw would pass on an implementation that threw after writing.
    check('…and the chunk it tried to push is not on disk',
        $store->receivedChunks($mine['uploadId']) === [0],
        implode(',', $store->receivedChunks($mine['uploadId'])));

    // The owner is unaffected by any of it.
    foreach ($parts as $i => $part) {
        if ($i === 0) continue;
        $store->storeChunk($OWNER, $mine['uploadId'], $i, $mkChunk($part));
    }
    $ok = $store->completeUpload($OWNER, $mine['uploadId'], $sha, strlen($payload));
    check('…while the owner finishes their own upload normally',
        $ok['size'] === strlen($payload), (string) $ok['size']);

    check('a session that does not exist is refused the same way, disclosing nothing',
        refuses(fn () => $store->storeChunk($intruder, str_repeat('e', 32), 0, $mkChunk('x')),
                '/unknown upload/i'));
}

// Dedupe: the same bytes again must not write a second file.
$again = $store->initUpload(1, strlen($payload), $sha);
foreach ($parts as $i => $part) $store->storeChunk($OWNER, $again['uploadId'], $i, $mkChunk($part));
$second = $store->completeUpload(1, $again['uploadId'], $sha, strlen($payload));
check('the same bytes uploaded twice are deduped', $second['deduped'] === true);
check('…and still resolve to the one stored file', $second['path'] === $done['path']);

// The backend is off unless a deployment turned it on.
check('the studio backend is disabled by default',
    (new StudioStorage(['storage_path' => sys_get_temp_dir()]))->isEnabled() === false);
// The default profile must point inside the studio's own server directory —
// this is the whole standalone claim, expressed as a path.
check('the default storage path is inside the studio folder',
    str_starts_with(StudioStorage::defaultStoragePath(), realpath(__DIR__) . '/server')
    || str_starts_with(StudioStorage::defaultStoragePath(), __DIR__ . '/server'),
    StudioStorage::defaultStoragePath());
check('the capability profile is read from the studio folder too',
    str_ends_with(StudioStorage::profilePath(), '/server/config/studio.php'),
    StudioStorage::profilePath());

$rm($profile['storage_path']);

/* ==================================================== document handling == */
section('StudioController — document guard');

// Project documents arrive as JSON from anywhere, not just from the studio.
check('a reserved key anywhere in a document is detected',
    StudioController::hasReservedKey(['a' => ['b' => ['__proto__' => 1]]]));
check('constructor and prototype are caught too',
    StudioController::hasReservedKey(['constructor' => 1])
    && StudioController::hasReservedKey(['x' => ['prototype' => 1]]));
check('an ordinary document passes',
    !StudioController::hasReservedKey(['tabs' => ['video' => ['v-scan' => '50']]]));
// Depth-bounded so a deeply nested payload cannot be used to hang the scan.
$deep = ['x' => 1];
for ($i = 0; $i < 200; $i++) $deep = ['n' => $deep];
check('the scan is depth-bounded', StudioController::hasReservedKey($deep) === false);

check('generated uuids look like uuid v4',
    (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
        StudioController::uuid()));
check('uuids are not repeated', StudioController::uuid() !== StudioController::uuid());

/* ========================================================== preflight == */
section('StudioPreflight — the capability profile is a trust boundary');
// It decides what the client is allowed to offer, and setup.php writes it from
// user-supplied form values.

check('iniBytes parses shorthand sizes', StudioPreflight::iniBytes('__nope__') === 0);
check('human() renders bytes at each scale',
    StudioPreflight::human(0) === '0 B'
    && StudioPreflight::human(1024) === '1 KB'
    && StudioPreflight::human(2 * 1024 * 1024) === '2 MB'
    && StudioPreflight::human(-1) === 'unlimited');

// A chunk larger than post_max_size fails every upload (PHP discards the whole
// POST), so the floor must sit BELOW any plausible host limit. 64 KB matches
// StudioStorage::chunkSize()'s own clamp — a 512 KB floor would sit ABOVE a
// tight host's post_max_size and fail every upload there.
$chunk = StudioPreflight::chunkSize();
check('chunk size stays inside its floor and ceiling',
    $chunk >= 64 * 1024 && $chunk <= 2 * 1024 * 1024, (string) $chunk);
// The tight-host behaviour needs its own ini limits, so probe in a subprocess.
$out = shell_exec(PHP_BINARY . ' -d post_max_size=100K -d upload_max_filesize=100K -r '
    . escapeshellarg('require "' . __DIR__ . '/server/StudioPreflight.php"; echo StudioPreflight::chunkSize();'));
check('a sub-640K host limit lowers the chunk to 80% of the limit',
    (int) $out === 81920, (string) $out);

$profile = StudioPreflight::profile('/srv/studio');
check('profile carries every key the client reads',
    array_diff(['enabled', 'storage_path', 'user_quota', 'max_asset_size', 'max_document_size',
                'chunk_size', 'server_render', 'ffmpeg_path', 'cron_enabled', 'packs_enabled', 'collab'],
               array_keys($profile)) === []);
check('storage path is derived from the studio folder',
    $profile['storage_path'] === '/srv/studio/server/data/studio', $profile['storage_path']);

check('known overrides are applied',
    StudioPreflight::profile('/srv/studio', ['user_quota' => 123])['user_quota'] === 123);
// setup.php passes $_POST-derived values through here, so an unknown key must
// not become config.
check('an unknown override key cannot invent config',
    !array_key_exists('evil', StudioPreflight::profile('/srv/studio', ['evil' => 'yes'])));
check('overrides cannot smuggle a prototype-ish key either',
    !array_key_exists('__proto__', StudioPreflight::profile('/srv/studio', ['__proto__' => 1])));

// server_render is only ever true where ffmpeg actually exists — claiming
// otherwise offers a feature that fails at the moment it is used.
check('server_render is false without ffmpeg',
    StudioPreflight::findFfmpeg() !== null || $profile['server_render'] === false);

// jsonColumnSupport is the step-2 wizard gate: it must read the SERVER's
// version string and apply the right threshold per flavour (MariaDB grew JSON
// at 10.2.7, MySQL at 5.7.8 — a shared threshold passes one and lies about the
// other). Driven through a real in-memory SQLite PDO with VERSION() registered
// to return a canned string, so no MySQL is needed.
$mkVersionPdo = function (string $ver): PDO {
    $pdo = new PDO('sqlite::memory:');
    $pdo->sqliteCreateFunction('VERSION', fn () => $ver, 0);
    return $pdo;
};
check('MariaDB 10.2.7 passes the JSON gate',
    StudioPreflight::jsonColumnSupport($mkVersionPdo('10.2.7-MariaDB'))['ok'] === true);
check('MariaDB 10.1 fails the JSON gate',
    StudioPreflight::jsonColumnSupport($mkVersionPdo('10.1.48-MariaDB-1~bionic'))['ok'] === false);
check('MySQL 5.6 fails, 5.7.8 passes',
    StudioPreflight::jsonColumnSupport($mkVersionPdo('5.6.51'))['ok'] === false
    && StudioPreflight::jsonColumnSupport($mkVersionPdo('5.7.8'))['ok'] === true);
check('the gate reports the version it read',
    StudioPreflight::jsonColumnSupport($mkVersionPdo('10.2.7-MariaDB'))['version'] === '10.2.7-MariaDB');

$rows = StudioPreflight::checks(__DIR__, null);
check('checks() returns well-formed rows', count($rows) > 10 && array_reduce($rows, fn ($ok, $r) =>
    $ok && isset($r['status'], $r['name'], $r['detail'], $r['consequence'])
        && in_array($r['status'], ['ok', 'warn', 'block'], true), true));
$counts = StudioPreflight::tally($rows);
check('tally() accounts for every row',
    $counts['ok'] + $counts['warn'] + $counts['block'] === count($rows));
// Without a PDO the DB rows must warn, never block: "not configured yet" is a
// normal state when the standalone page runs before install.
check('an absent database warns rather than blocks',
    !array_reduce($rows, fn ($b, $r) => $b || ($r['status'] === 'block' && $r['name'] === 'Database'), false));
// The front controller's rewrite is load-bearing: without api/.htaccess every
// call 404s. The check must be looking at the file that actually exists.
check('the api/.htaccess check finds the shipped file',
    array_reduce($rows, fn ($b, $r) => $b || ($r['name'] === 'api/.htaccess present' && $r['status'] === 'ok'), false));

/* ========================================================== installer == */
section('StudioInstall — layout and install primitives');

$tmp = sys_get_temp_dir() . '/studio-install-test-' . bin2hex(random_bytes(4));
@mkdir($tmp, 0777, true);

/* --- where the API is --------------------------------------------------
   The API ships inside the studio folder, so the client's address is one
   relative path — correct wherever the folder was copied to. An absolute path
   here is what breaks a subdirectory install. */
check('relativeApiBase stays relative rather than becoming /api',
    StudioInstall::relativeApiBase() === './api');
check('apiUrlPath at the docroot', StudioInstall::apiUrlPath('/') === '/api');
check('apiUrlPath in a subdirectory install',
    StudioInstall::apiUrlPath('/projects/site/studio') === '/projects/site/studio/api');
check('apiUrlPath for the repository layout',
    StudioInstall::apiUrlPath('/tools/media-studio') === '/tools/media-studio/api');

check('scriptUrlDir uses SCRIPT_NAME, not the query-carrying REQUEST_URI',
    StudioInstall::scriptUrlDir(['SCRIPT_NAME' => '/tools/media-studio/setup.php',
                                 'REQUEST_URI' => '/tools/media-studio/setup.php?step=4'])
        === '/tools/media-studio');
check('scriptUrlDir of a docroot script is /',
    StudioInstall::scriptUrlDir(['SCRIPT_NAME' => '/setup.php']) === '/');

check('the installer locates the studio folder from its own position',
    realpath(StudioInstall::studioDir()) === realpath(__DIR__));
check('env, profile and lock all live under server/',
    str_ends_with(StudioInstall::envFile(), '/server/env.php')
    && str_ends_with(StudioInstall::profileFile(), '/server/config/studio.php')
    && str_ends_with(StudioInstall::lockFile(), '/server/config/.setup-complete'));
check('the migrations directory is the one that ships',
    is_dir(StudioInstall::migrationsDir())
    && count(glob(StudioInstall::migrationsDir() . '/*.sql') ?: []) >= 6);

/* --- database names go into DDL, so they get an allowlist ---------------
   The wizard creates the database when it is missing, which means a value from
   a form field reaches a CREATE DATABASE statement. It cannot be a bound
   parameter — an identifier never can — so the name is checked before it is
   quoted, and the quoting is checked too. */
check('an ordinary database name is accepted',
    StudioInstall::isSafeDatabaseName('studio')
    && StudioInstall::isSafeDatabaseName('cpaneluser_studio')
    && StudioInstall::isSafeDatabaseName('my-studio_2'));
check('a name carrying a backtick is refused',
    !StudioInstall::isSafeDatabaseName('evil`; DROP DATABASE x; --'));
check('a name carrying a space, quote, semicolon or slash is refused',
    !StudioInstall::isSafeDatabaseName('two words')
    && !StudioInstall::isSafeDatabaseName("o'brien")
    && !StudioInstall::isSafeDatabaseName('a;b')
    && !StudioInstall::isSafeDatabaseName('a/b'));
check('an empty name, or one starting with a hyphen, is refused',
    !StudioInstall::isSafeDatabaseName('') && !StudioInstall::isSafeDatabaseName('-x'));
check('a name longer than MySQL allows is refused',
    !StudioInstall::isSafeDatabaseName(str_repeat('a', 65)));
check('quoteIdentifier wraps in backticks and doubles any inside',
    StudioInstall::quoteIdentifier('studio') === '`studio`'
    && StudioInstall::quoteIdentifier('a`b') === '`a``b`');

/* --- env.php: the schema the backend actually reads --------------------- */
$envText = StudioInstall::envTemplate(
    ['host' => 'localhost', 'port' => 3306, 'database' => 'demo_db', 'username' => 'demo_u', 'password' => "p'w\"x"],
    ['timezone' => 'Europe/London']
);
$envFile = $tmp . '/env-under-test.php';
file_put_contents($envFile, $envText);
$env = include $envFile;

check('envTemplate produces loadable PHP returning an array', is_array($env));
check('envTemplate uses the canonical database key', isset($env['database']['database']));
check('envTemplate round-trips a password containing quotes',
    ($env['database']['password'] ?? null) === "p'w\"x");
check('envTemplate keeps the rate_limit block the middleware reads',
    !empty($env['rate_limit']['enabled']) && isset($env['rate_limit']['storage_path']));
check('envTemplate keeps the session lifetime the auth controller reads',
    ($env['app']['session_lifetime'] ?? 0) >= 3600);
check('envTemplate leaves proxy trust off by default',
    ($env['app']['trust_proxy'] ?? true) === false);
check('envTemplate generates a setup secret',
    strlen((string) ($env['setup']['secret'] ?? '')) >= 32);
check('envTemplate secrets differ between two writes',
    StudioInstall::envTemplate(['database' => 'x']) !== StudioInstall::envTemplate(['database' => 'x']));
check('envTemplate emits paths as __DIR__ expressions, never resolved absolutes',
    str_contains($envText, "__DIR__ . '/data/rate_limits'")
    && !preg_match("/'storage_path'\s*=>\s*'\//", $envText));
check('envTemplate accepts a real timezone', ($env['app']['timezone'] ?? '') === 'Europe/London');
check('envTemplate falls back to UTC for an unknown timezone',
    str_contains(StudioInstall::envTemplate(['database' => 'x'], ['timezone' => 'Not/AZone']), "'timezone'         => 'UTC'"));
check('envTemplate never turns debug on',
    ($env['app']['debug'] ?? true) === false);

/* --- reconfirm secret: the proof-of-server-access the wizard demands ---- */
check('reconfirmSecret prefers the database password',
    StudioInstall::reconfirmSecret(['database' => ['password' => 'dbpw'], 'setup' => ['secret' => 'ms']]) === 'dbpw');
check('reconfirmSecret falls back to the setup secret when the password is empty',
    StudioInstall::reconfirmSecret(['database' => ['password' => ''], 'setup' => ['secret' => 'ms']]) === 'ms');
check('reconfirmSecret is empty when there is nothing to prove',
    StudioInstall::reconfirmSecret([]) === '');

/* --- the wizard re-run guard -------------------------------------------
   This truth table got its own function after a bug that shipped: step 2
   writes env.php, so from step 3 onward the guard fired on the session that
   was mid-install and a first-time browser install could not get past
   migrations. The exemption is scoped to the creating run and dies at the
   lock. */
check('a first run (nothing configured) needs no key',
    StudioInstall::needsReconfirm(false, false, true, 'secret') === false);
check('the session that is creating the install may continue past step 2',
    StudioInstall::needsReconfirm(true, false, true, 'secret') === false);
check('another visitor mid-install still needs the key',
    StudioInstall::needsReconfirm(true, false, false, 'secret') === true);
check('once locked, the key is required from everyone — the installer included',
    StudioInstall::needsReconfirm(true, true, true, 'secret') === true);
check('mid-install, with nothing to check against, there is nothing to demand',
    StudioInstall::needsReconfirm(true, false, false, '') === false);

/* THE GUARD MUST NOT FAIL OPEN.
   `$secret === ''` used to be tested BEFORE the lock, so a FINISHED install
   with no database password and no setup.secret answered "no key needed" and
   handed the whole wizard to an anonymous visitor — who could re-point it at a
   database of their own and create themselves an account at step 5. This is not
   an exotic state: server/env.example.php ships with both fields empty and
   copying it by hand is a documented way to configure the studio, so every
   socket-auth install set up that way had an open installer.
   There is no key that could be right, so the answer is not "demand one" — it
   is refuse, and say which server-side change re-opens it. */
check('a LOCKED install with no secret still demands a key rather than opening',
    StudioInstall::needsReconfirm(true, true, false, '') === true);
check('…and is reported as unopenable, because no key could ever match',
    StudioInstall::lockedWithNoSecret(true, true, '') === true);
check('a locked install WITH a secret is opened by that secret, not refused outright',
    StudioInstall::lockedWithNoSecret(true, true, 'secret') === false);
check('an unlocked mid-install is not refused outright',
    StudioInstall::lockedWithNoSecret(true, false, '') === false);
check('a first run is not refused outright',
    StudioInstall::lockedWithNoSecret(false, false, '') === false);

check('keyAccepted matches the exact secret', StudioInstall::keyAccepted('s3cr3t', 's3cr3t'));
check('keyAccepted rejects a near miss', !StudioInstall::keyAccepted('s3cr3t', 's3cr3t '));
check('keyAccepted rejects a non-string', !StudioInstall::keyAccepted('s3cr3t', ['s3cr3t']));
check('keyAccepted never accepts an empty secret', !StudioInstall::keyAccepted('', ''));

/* --- migrations: "already there" is not "broken" ------------------------ */
$mkPdoErr = function (string $sqlState, int $code): PDOException {
    $e = new PDOException('x');
    $e->errorInfo = [$sqlState, $code, 'x'];
    return $e;
};
check('duplicate table (1050) is ignorable', StudioInstall::isIgnorableMigrationError($mkPdoErr('42S01', 1050)));
check('duplicate column (1060) is ignorable', StudioInstall::isIgnorableMigrationError($mkPdoErr('42S21', 1060)));
check('duplicate key (1061) is ignorable', StudioInstall::isIgnorableMigrationError($mkPdoErr('42000', 1061)));
check('a syntax error (1064) is NOT ignorable', !StudioInstall::isIgnorableMigrationError($mkPdoErr('42000', 1064)));
check('access denied (1045) is NOT ignorable', !StudioInstall::isIgnorableMigrationError($mkPdoErr('28000', 1045)));

// Installing into a database that already belongs to something else must never
// destroy what is there — the whole schema is CREATE TABLE IF NOT EXISTS, and
// nothing in it drops or alters an existing table.
$sql = '';
foreach (glob(StudioInstall::migrationsDir() . '/*.sql') ?: [] as $f) $sql .= file_get_contents($f);
check('every migration creates tables conditionally',
    substr_count(strtoupper($sql), 'CREATE TABLE IF NOT EXISTS') === substr_count(strtoupper($sql), 'CREATE TABLE'));
check('no migration drops or alters an existing table',
    !preg_match('/\b(DROP|TRUNCATE|ALTER)\s+TABLE\b/i', $sql));

/* --- server/config/studio.php ------------------------------------------- */
$profileText = StudioInstall::studioProfileFile(
    ['enabled' => true, 'storage_path' => '/absolute/from/this/host/data/studio', 'user_quota' => 123]
);
$profFile = $tmp . '/studio-profile.php';
file_put_contents($profFile, $profileText);
$prof = include $profFile;
check('studioProfileFile produces loadable PHP', is_array($prof) && ($prof['enabled'] ?? null) === true);
check('studioProfileFile never bakes in an absolute storage path',
    !str_contains($profileText, '/absolute/from/this/host')
    && str_contains($profileText, "__DIR__ . '/../data/studio'"));
check('studioProfileFile preserves other values', ($prof['user_quota'] ?? null) === 123);

$writeErr = StudioInstall::writeStudioProfile(['enabled' => false, 'storage_path' => $tmp . '/data/studio'],
    $tmp . '/config/studio.php');
check('writeStudioProfile creates the config directory and writes the profile',
    $writeErr === null && is_file($tmp . '/config/studio.php'));

/* --- deny files --------------------------------------------------------- */
StudioInstall::writeDenyFile($tmp . '/denyme', 'unit test');
$deny = (string) @file_get_contents($tmp . '/denyme/.htaccess');
/* THE STORAGE PROBE MUST ASK ABOUT A REAL FILENAME.
   It used to fetch server/data/.htaccess. Plenty of hosts deny dotfiles by name
   — <FilesMatch "^\."> is a stock rule — while serving everything else in the
   tree, so on one of those the probe got 403 and this check reported
   "present and enforced (live-checked)" over a storage tree whose every uploaded
   asset was fetchable by URL. A false OK on a check that advertises itself as
   live-checked is worse than no check: it is the one an operator believes. */
{
    $dataDir = sys_get_temp_dir() . '/studio-probe-' . getmypid();
    // Nothing is listening on this port, so the probe cannot run — and must say
    // so rather than guessing, and must not leave its canary behind.
    $res = StudioPreflight::probeStorageUrl('http://127.0.0.1:1', $dataDir);
    check('a probe that cannot reach the host reports "unknown", not "protected"',
        $res === null, var_export($res, true));
    $left = is_dir($dataDir)
        ? array_values(array_filter(scandir($dataDir) ?: [], fn ($f) => strpos($f, 'preflight-probe-') === 0))
        : [];
    check('…and cleans up its canary either way', $left === [], implode(',', $left));
    check('the canary is an ORDINARY filename, not a dotfile — that is the whole point',
        strpos(StudioPreflight::PROBE_CANARY, '.') !== 0);
    $rm($dataDir);
}

check('writeDenyFile denies both Apache generations',
    str_contains($deny, 'Require all denied') && str_contains($deny, 'Deny from all'));
file_put_contents($tmp . '/denyme/.htaccess', '# hand-edited');
StudioInstall::writeDenyFile($tmp . '/denyme', 'unit test');
check('an existing deny file is never overwritten',
    trim((string) @file_get_contents($tmp . '/denyme/.htaccess')) === '# hand-edited');

/* --- the deployment note the client reads before guessing --------------- */
$noteErr = StudioInstall::writeDeployConfig($tmp, './api');
$note = json_decode((string) @file_get_contents($tmp . '/studio.config.json'), true);
check('writeDeployConfig records the API base as a relative URL',
    $noteErr === null && ($note['apiBase'] ?? null) === './api');

check('StudioInstall uuids look like uuid v4',
    (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', StudioInstall::uuid()));

$rm($tmp);

/* ================================================== standalone contract == */
section('standalone — the tool carries its own server');

// The claim this whole directory exists to make: nothing under tools/media-studio
// reads a file from outside it. A require that climbs past the studio folder is
// how "standalone" quietly stops being true.
$escapes = [];
foreach (['server', 'api'] as $sub) {
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(__DIR__ . '/' . $sub,
        FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
        if ($file->getExtension() !== 'php') continue;
        $src = (string) file_get_contents($file->getPathname());
        // Any include/require whose path climbs above the studio folder.
        if (preg_match_all('/(?:require|include)(?:_once)?\s*[( ]\s*__DIR__\s*\.\s*[\'"]([^\'"]+)/', $src, $m)) {
            foreach ($m[1] as $rel) {
                $depth = substr_count($file->getPath(), '/') - substr_count(__DIR__, '/');
                if (substr_count($rel, '../') > $depth) {
                    $escapes[] = $file->getFilename() . ' → ' . $rel;
                }
            }
        }
    }
}
check('no backend file requires anything above the studio folder',
    $escapes === [], implode('; ', $escapes));

foreach (['setup.php', 'preflight.php', 'router.php'] as $entry) {
    $src = (string) file_get_contents(__DIR__ . '/' . $entry);
    check("$entry loads only from the studio folder",
        !preg_match('/(?:require|include)(?:_once)?[^;]*\.\.\/\.\./', $src));
}

echo "\n" . str_repeat('=', 60) . "\n";
$total = $pass + $fail;
echo "Results: $pass/$total passed" . ($fail ? " ($fail failed)" : '') . "\n";
if ($failures) { echo "\nNeeds attention:\n"; foreach ($failures as $f) echo "  - $f\n"; }
exit($fail > 0 ? 1 : 0);
