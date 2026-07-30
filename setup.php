<?php
/**
 * Dead Signal Studio — installer.
 *
 * The studio is a standalone tool. This wizard installs its server half —
 * database, schema, capability profile, first account — and nothing else. It
 * requires no application around it and touches no file outside this folder.
 *
 * WHERE THIS FILE CAN LIVE
 *
 * Wherever the studio folder is: its own domain, a subdirectory of an
 * unrelated site, a staging folder three levels down. Every path is derived
 * from this file's location, and the API ships inside the same folder, so
 * there is no layout to get wrong.
 *
 *     https://yoursite.example/<wherever>/setup.php
 *
 * THE BACKEND IS OPTIONAL. Editing, rendering and exporting all happen in the
 * browser; a studio served from a plain static folder is a supported
 * deployment. What this adds is what one browser cannot do alone: projects that
 * follow you between machines, assets stored outside IndexedDB, and sharing a
 * project with someone else.
 *
 * SECURITY: delete this file when the install is done. While no install exists
 * it is open by design — it is what creates the first account. Once one does,
 * re-running it requires proving server access with ?reconfirm_key=<the
 * database password, or `setup.secret` from server/env.php when the password is
 * empty>.
 */

/** Minimal standalone error page — used before any of the backend is loaded. */
function studioSetupBail(string $title, string $body): void
{
    http_response_code(403);
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
       . '<title>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</title>'
       . '<style>body{font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;background:#05080a;color:#bfeee0;'
       . 'max-width:44em;margin:0 auto;padding:3em 1em}h1{color:#39ff9e;font-size:1.2em}'
       . 'code{background:#0b1412;padding:.1em .35em;border-radius:2px}a{color:#39ff9e}</style>'
       . '<h1>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h1>' . $body;
    exit;
}

$STUDIO_DIR = __DIR__;
$SERVER_DIR = __DIR__ . '/server';

if (!is_file($SERVER_DIR . '/StudioInstall.php') || !is_file($SERVER_DIR . '/StudioPreflight.php')) {
    studioSetupBail('The server folder is missing', <<<HTML
<p>This wizard expects <code>server/</code> beside it, and it is not there — so there is nothing here
   to install.</p>
<p>Upload the whole studio folder, not just the part the browser needs. The pieces that matter are
   <code>server/</code> (the backend) and <code>api/</code> (its entry point, including the dotfile
   <code>api/.htaccess</code> — many FTP clients skip dotfiles silently).</p>
<p>The studio itself does not need any of this: served from a static folder it works exactly as it
   does now, minus accounts, sync and sharing.</p>
HTML);
}

require_once $SERVER_DIR . '/StudioInstall.php';
require_once $SERVER_DIR . '/StudioPreflight.php';

$ENV_FILE  = StudioInstall::envFile();
$LOCK_FILE = StudioInstall::lockFile();
$API_REL   = StudioInstall::relativeApiBase();
$API_PATH  = StudioInstall::apiUrlPath(StudioInstall::scriptUrlDir($_SERVER));

session_start();

/* The wizard's every page describes this server's configuration and carries a
   credential in its forms. Neither should be indexed, and neither should leak
   through a Referer to anything this page links to. */
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

// ---------------------------------------------------------------------------
// Guard: a configured install may only be reconfigured by someone who can read
// its secrets.
//
// The exception is the run that is CREATING the install: step 2 writes
// server/env.php, so from step 3 onwards a first-time install would otherwise
// lock out the very session that just configured it. That exemption is marked
// in the session, and it expires the moment the install locks itself — after
// which the key is required from everyone, this session included.
// ---------------------------------------------------------------------------
$envExists = is_file($ENV_FILE);
$isLocked  = is_file($LOCK_FILE);
$installingHere = !empty($_SESSION['studio_setup_creating']) && !$isLocked;

if ($envExists) {
    $existingEnv = @include $ENV_FILE;
    $secret = is_array($existingEnv) ? StudioInstall::reconfirmSecret($existingEnv) : '';
    /* A finished install with nothing to check a key against does not open for
       anybody. There is no key that could be right, so demanding one would be
       theatre; the way back in is from the server, which is the access this
       guard exists to require. Before this, the empty-secret case returned
       "no key needed" and handed the whole wizard to an anonymous visitor. */
    if (StudioInstall::lockedWithNoSecret($envExists, $isLocked, $secret)) {
        studioSetupBail('This studio is installed and cannot be reconfigured from the web', <<<HTML
<p>The install at <code>server/env.php</code> is complete, and it holds neither a database password
   nor a <code>setup.secret</code> — so there is nothing this wizard could check a visitor against.
   Rather than open to everyone, it opens to nobody.</p>
<p>To re-run it, do one of these <strong>from the server</strong>:</p>
<ul>
  <li>add a <code>'setup' =&gt; ['secret' =&gt; '…']</code> value to <code>server/env.php</code>, then
      return with <code>?reconfirm_key=</code> that value; or</li>
  <li>delete <code>server/config/.setup-complete</code>.</li>
</ul>
<p>To change settings without the wizard at all, edit <code>server/config/studio.php</code> directly;
   it documents itself and is safe to delete and regenerate. Setting
   <code>'enabled' =&gt; false</code> there turns the backend off without uninstalling anything.</p>
HTML);
    }
    /* The key may also come from the session — see the redirect below. Without
       that, every step of the wizard would have to carry it in the URL. */
    $offered = $_POST['reconfirm_key'] ?? $_GET['reconfirm_key'] ?? ($_SESSION['studio_reconfirm'] ?? '');
    if (StudioInstall::needsReconfirm($envExists, $isLocked, $installingHere, $secret)
        && !StudioInstall::keyAccepted($secret, $offered)) {
        studioSetupBail('This studio is already installed', <<<HTML
<p>A configuration already exists at <code>server/env.php</code>, so this wizard will not run for an
   anonymous visitor.</p>
<p>To reconfigure it, add the current database password as <code>?reconfirm_key=…</code> — or the
   <code>setup.secret</code> value from <code>server/env.php</code> if the database password is
   empty. Both are readable only from the server, which is the point.</p>
<p>To change settings without the wizard, edit <code>server/config/studio.php</code> directly; it
   documents itself and is safe to delete and regenerate. Setting <code>'enabled' =&gt; false</code>
   there turns the backend off without uninstalling anything.</p>
HTML);
    }

    /* THE KEY IS A PASSWORD, AND IT ARRIVED IN A URL.
       ?reconfirm_key= is the only practical way in from a browser address bar,
       so it is still accepted — but a query string lands in the access log, the
       browser's history and any Referer this page emits, and this particular
       one is the DATABASE PASSWORD. Take it once, put it in the session, and
       bounce to a clean URL so it is not re-sent on every subsequent request
       and is not sitting in the address bar while somebody is looking over a
       shoulder. The forms below carry it from the session instead. */
    if (isset($_GET['reconfirm_key']) && StudioInstall::keyAccepted($secret, $_GET['reconfirm_key'])) {
        $_SESSION['studio_reconfirm'] = (string) $_GET['reconfirm_key'];
        $q = $_GET; unset($q['reconfirm_key']);
        $self = (string) ($_SERVER['SCRIPT_NAME'] ?? 'setup.php');
        header('Location: ' . $self . ($q ? '?' . http_build_query($q) : ''), true, 303);
        exit;
    }
}
$reconfirmKey = (string) ($_POST['reconfirm_key'] ?? $_GET['reconfirm_key'] ?? ($_SESSION['studio_reconfirm'] ?? ''));

// Nothing configured yet: this session is the one doing the installing.
if (!$envExists) $_SESSION['studio_setup_creating'] = true;

$step = $_POST['step'] ?? $_GET['step'] ?? ($_SESSION['studio_setup_step'] ?? '1');
$step = max(1, min(6, (int) $step));

$errors  = [];
$notices = [];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function studioPdo(string $envFile): ?PDO
{
    if (!is_file($envFile)) return null;
    $env = @include $envFile;
    if (!is_array($env)) return null;
    try {
        return StudioInstall::connect(StudioInstall::dbConfig($env));
    } catch (Throwable $e) {
        return null;
    }
}

function studioPreflightRows(string $studioDir, string $envFile): array
{
    $rows = StudioPreflight::checks($studioDir, studioPdo($envFile));
    return ['rows' => $rows, 'counts' => StudioPreflight::tally($rows)];
}

// ---------------------------------------------------------------------------
// Step handlers
// ---------------------------------------------------------------------------

/** STEP 2 — database configuration (or adoption of an existing env.php). */
function handleStudioDatabase(string $envFile): array
{
    // "Use what is already configured" — the common case when re-running the
    // wizard to change a setting rather than to move the install.
    if (($_POST['db_mode'] ?? '') === 'existing') {
        if (!is_file($envFile)) return ['errors' => ['There is no existing configuration to use.']];
        if (!studioPdo($envFile)) {
            return ['errors' => ['The existing <code>server/env.php</code> did not connect. Configure a database below.']];
        }
        return ['errors' => []];
    }

    $errors = [];
    $host     = trim((string) ($_POST['db_host'] ?? 'localhost'));
    $port     = (int) ($_POST['db_port'] ?? 3306);
    $database = trim((string) ($_POST['db_name'] ?? ''));
    $username = trim((string) ($_POST['db_user'] ?? ''));
    $password = (string) ($_POST['db_pass'] ?? '');
    $timezone = trim((string) ($_POST['timezone'] ?? 'UTC'));

    if ($database === '') $errors[] = 'Database name is required.';
    if ($username === '') $errors[] = 'Database username is required.';
    if ($port < 1 || $port > 65535) $errors[] = 'Port must be between 1 and 65535.';
    if ($errors) return ['errors' => $errors];

    $notices = [];
    try {
        // Connect to the SERVER, not to the database: the database is allowed
        // not to exist yet, and this wizard would rather create it than send
        // someone away to make an empty one by hand.
        $pdo = new PDO(sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $host, $port), $username, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT => 5,
        ]);

        try {
            if (StudioInstall::useOrCreateDatabase($pdo, $database)) {
                $notices[] = 'Database <strong>' . htmlspecialchars($database, ENT_QUOTES, 'UTF-8')
                    . '</strong> did not exist, so it was created (utf8mb4 / utf8mb4_unicode_ci).';
            }
        } catch (RuntimeException $e) {
            // Already a sentence written for a person — it names what to do.
            return ['errors' => [$e->getMessage()]];
        }

        // Checked here, with credentials in hand, rather than at migration
        // time: project documents live in a JSON column, and finding that out
        // when the schema fails is much harder to trace back than being told
        // now, by name and version.
        $json = StudioPreflight::jsonColumnSupport($pdo);
        if (!$json['ok']) {
            return ['errors' => ['This database server (<strong>' . htmlspecialchars($json['version'], ENT_QUOTES, 'UTF-8')
                . '</strong>) is too old for JSON columns, which project documents need. '
                . 'MySQL 5.7.8+ or MariaDB 10.2.7+ — ask your host to move the database to a newer server.']];
        }
    } catch (PDOException $e) {
        $msg = $e->getMessage();
        // 1045 is the credentials themselves. Access denied to a *database*
        // (1044) never reaches here — useOrCreateDatabase answers that one,
        // because "check the username and password" is the wrong advice when
        // both are correct and it is the database that is missing.
        if ((int) ($e->errorInfo[1] ?? 0) === 1045 || str_contains($msg, 'Access denied for user')) {
            $errors[] = 'Access denied: check the username and password.';
        } elseif (str_contains($msg, 'Connection refused') || str_contains($msg, 'No such file')) {
            $errors[] = 'Cannot reach MySQL at <strong>' . htmlspecialchars($host . ':' . $port, ENT_QUOTES, 'UTF-8')
                . '</strong>. Check the hostname — shared hosts almost always want <code>localhost</code>.';
        } else {
            $errors[] = 'Database connection failed: ' . htmlspecialchars($msg, ENT_QUOTES, 'UTF-8');
        }
        return ['errors' => $errors];
    }

    // Keep the setup secret stable across re-runs, so a key that worked before
    // still works after a reconfiguration.
    $existing = is_file($envFile) ? (@include $envFile) : null;
    $secret = is_array($existing) ? (string) ($existing['setup']['secret'] ?? '') : '';

    $content = StudioInstall::envTemplate([
        'host' => $host, 'port' => $port, 'database' => $database,
        'username' => $username, 'password' => $password,
    ], ['timezone' => $timezone] + ($secret !== '' ? ['setup_secret' => $secret] : []));

    if (@file_put_contents($envFile, $content, LOCK_EX) === false) {
        return ['errors' => ['Failed to write <code>server/env.php</code>. Make <code>server/</code> writable (755) and try again.']];
    }
    @chmod($envFile, 0640);

    return ['errors' => [], 'notices' => $notices];
}

/** STEP 3 — schema. */
function handleStudioMigrations(string $envFile): array
{
    $pdo = studioPdo($envFile);
    if (!$pdo) return ['errors' => ['No working database configuration — go back to step 2.'], 'results' => []];

    try {
        $out = StudioInstall::migrate($pdo);
    } catch (PDOException $e) {
        return ['errors' => ['Database error: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8')], 'results' => []];
    }
    return ['errors' => array_map(static fn($e) => htmlspecialchars($e, ENT_QUOTES, 'UTF-8'), $out['errors']),
            'results' => $out['results']];
}

/** STEP 4 — capability profile and storage. */
function handleStudioProfile(string $studioDir, string $envFile): array
{
    $pre = studioPreflightRows($studioDir, $envFile);

    // A blocking host result does not stop the install: the studio still runs
    // client-side from any static folder. It stops the *backend* being switched
    // on, which is a different and much smaller claim.
    $enabled = !empty($_POST['studio_enabled']) && $pre['counts'][StudioPreflight::BLOCK] === 0;

    $quotaMb = max(64, min(102400, (int) ($_POST['studio_quota_mb'] ?? 2048)));
    $assetMb = max(8, min(4096, (int) ($_POST['studio_asset_mb'] ?? 512)));

    $profile = StudioPreflight::profile($studioDir, [
        'enabled'        => $enabled,
        'user_quota'     => $quotaMb * 1024 * 1024,
        'max_asset_size' => $assetMb * 1024 * 1024,
        'server_render'  => !empty($_POST['studio_server_render']) && StudioPreflight::findFfmpeg() !== null,
        'cron_enabled'   => !empty($_POST['studio_cron']),
    ]);

    $err = StudioInstall::writeStudioProfile($profile);
    if ($err !== null) return ['errors' => [$err]] + $pre;

    // Create storage now, so a permission problem surfaces here rather than at
    // someone's first upload.
    $notices = [];
    $storage = $studioDir . '/server/data/studio';
    if (!is_dir($storage) && !@mkdir($storage, 0755, true) && !is_dir($storage)) {
        $notices[] = 'Could not create <code>server/data/studio/</code>. Create it and give it write permission (755, or 775 where PHP runs as another user) before uploading assets.';
    } elseif (!StudioPreflight::reallyWritable($storage)) {
        $notices[] = '<code>server/data/studio/</code> exists but is not writable — uploads will fail until it is (755, or 775 where PHP runs as another user).';
    }

    // These directories must never be web-served: one holds every uploaded
    // asset, the other holds the database password.
    StudioInstall::writeDenyFile($studioDir . '/server/data', 'Uploaded assets and runtime state.');
    StudioInstall::writeDenyFile($studioDir . '/server/config', 'Configuration, including the setup lock.');

    return ['errors' => [], 'notices' => $notices] + $pre;
}

/** STEP 5 — the first account. */
function handleStudioAccount(string $envFile): array
{
    $pdo = studioPdo($envFile);
    if (!$pdo) return ['errors' => ['No working database configuration — go back to step 2.']];

    if (($_POST['account_mode'] ?? '') === 'skip') return ['errors' => [], 'skipped' => true];

    $name  = trim((string) ($_POST['account_name'] ?? ''));
    $pass  = (string) ($_POST['account_pass'] ?? '');
    $pass2 = (string) ($_POST['account_pass2'] ?? '');

    $errors = [];
    if ($name === '') $errors[] = 'A display name is required — it is what you sign in with.';
    if (mb_strlen($name) > 64) $errors[] = 'Display name must be 64 characters or fewer.';
    if (strlen($pass) < 8) $errors[] = 'Password must be at least 8 characters.';
    if ($pass !== $pass2) $errors[] = 'Passwords do not match.';
    if ($errors) return ['errors' => $errors];

    $first = !StudioInstall::anyUserExists($pdo);

    try {
        if (StudioInstall::displayNameTaken($pdo, $name)) {
            // Never overwrite an account that already exists: this database may
            // be shared with something else, and silently resetting one of its
            // accounts from an installer is not a thing a tool should do.
            return ['errors' => ['An account called <strong>' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8')
                . '</strong> already exists in this database. Sign in with it instead, or choose another name.']];
        }
        StudioInstall::createAccount($pdo, $name, $pass);
    } catch (PDOException $e) {
        return ['errors' => ['Database error: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8')]];
    }

    /* The lock is written on arrival at step 6, not here: it belongs to the
       wizard having finished, not to this run having created the first
       account. See StudioInstall::lockInstall. */
    return ['errors' => [], 'notices' => [], 'created' => true, 'first' => $first];
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
$migrationResults = [];
$preflight = null;
$accountCreated = null;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    switch ($_POST['action'] ?? '') {
        case 'host':
            $step = 2;
            break;

        case 'database':
            $r = handleStudioDatabase($ENV_FILE);
            $errors = $r['errors'];
            $notices = $r['notices'] ?? [];
            $step = $errors ? 2 : 3;
            $envExists = is_file($ENV_FILE);
            break;

        case 'migrate':
            $r = handleStudioMigrations($ENV_FILE);
            $errors = $r['errors'];
            $migrationResults = $r['results'];
            $step = $errors ? 3 : 4;
            break;

        case 'profile':
            $r = handleStudioProfile($STUDIO_DIR, $ENV_FILE);
            $errors = $r['errors'];
            $notices = $r['notices'] ?? [];
            $preflight = ['rows' => $r['rows'] ?? [], 'counts' => $r['counts'] ?? []];
            $step = $errors ? 4 : 5;
            break;

        case 'account':
            $r = handleStudioAccount($ENV_FILE);
            $errors = $r['errors'];
            $notices = $r['notices'] ?? [];
            $accountCreated = !empty($r['created']);
            $step = $errors ? 5 : 6;
            break;
    }
}

if ($step === 1 || ($step === 4 && $preflight === null)) {
    $preflight = studioPreflightRows($STUDIO_DIR, $ENV_FILE);
}

// Arriving at the end: record where the API is, so the client does not have to
// probe for it. Best effort — a read-only studio folder is a perfectly sensible
// thing to deploy, and the client auto-detects without this.
$deployNote = null;
if ($step === 6) {
    $deployNote = StudioInstall::writeDeployConfig($STUDIO_DIR, $API_REL);
    /* And lock the wizard, whatever route got here — created an account,
       skipped the step, or added a second one. A wizard that only locked after
       creating the FIRST account stayed open on every other finished install,
       and on a socket-auth install with no setup.secret "open" means open to
       anyone who can load the URL. */
    if (!StudioInstall::lockInstall($LOCK_FILE)) {
        $notices[] = 'Could not write the setup lock at <code>server/config/.setup-complete</code>. '
            . 'Until that file exists this wizard will keep running — delete <code>setup.php</code> by hand.';
    }
}

$_SESSION['studio_setup_step'] = $step;

$e = static fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
$stepNames = ['Host', 'Database', 'Schema', 'Studio', 'Account', 'Done'];
$hasUsers  = ($pdoProbe = studioPdo($ENV_FILE)) ? StudioInstall::anyUserExists($pdoProbe) : false;
unset($pdoProbe);
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Dead Signal Studio — setup</title>
<style>
  :root{--bg:#05080a;--fg:#bfeee0;--dim:#5f7d78;--line:#12211d;--ok:#39ff9e;--warn:#ffb347;--bad:#ff3860;--panel:#0a1210}
  *{box-sizing:border-box}
  body{font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;background:var(--bg);color:var(--fg);
       max-width:62em;margin:0 auto;padding:2em 1em}
  h1{color:var(--ok);font-size:1.3em;margin:0 0 .2em;letter-spacing:.04em}
  .sub{color:var(--dim);margin:0 0 2em}
  h2{font-size:1.05em;color:var(--ok);margin:0 0 .4em}
  ol.steps{list-style:none;display:flex;flex-wrap:wrap;gap:.4em;padding:0;margin:0 0 2em}
  ol.steps li{border:1px solid var(--line);border-radius:2px;padding:.25em .7em;color:var(--dim);font-size:.9em}
  ol.steps li.on{border-color:var(--ok);color:var(--ok)}
  ol.steps li.done{color:var(--fg)}
  .panel{border:1px solid var(--line);border-radius:3px;padding:1.2em;background:var(--panel);margin:0 0 1.5em}
  table{width:100%;border-collapse:collapse}
  td,th{text-align:left;padding:.4em .6em;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--dim);font-weight:normal}
  .s{white-space:nowrap;font-weight:bold}
  .ok{color:var(--ok)} .warn{color:var(--warn)} .block,.bad{color:var(--bad)}
  .why{color:#8fb3ab;font-size:.92em}
  code{background:#0b1412;padding:.1em .35em;border-radius:2px}
  label{display:block;color:var(--dim);margin:.9em 0 .2em}
  input[type=text],input[type=password],input[type=number],select{width:100%;background:#0b1412;color:var(--fg);
       border:1px solid var(--line);border-radius:2px;padding:.5em;font:inherit}
  input:focus,select:focus,button:focus{outline:2px solid var(--ok);outline-offset:1px}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:1em}
  .check{display:flex;gap:.6em;align-items:flex-start;margin:.9em 0}
  .check input{margin-top:.35em}
  button{background:#0b1412;color:var(--ok);border:1px solid var(--ok);border-radius:2px;
         padding:.6em 1.4em;font:inherit;cursor:pointer;margin-top:1.4em}
  button:hover{background:#10201b}
  button.secondary{color:var(--dim);border-color:var(--line)}
  .msgs{border:1px solid var(--bad);border-radius:3px;padding:.8em 1em;margin:0 0 1.5em;color:#ffb9c6}
  .msgs.note{border-color:var(--warn);color:#ffdcae}
  .msgs ul{margin:.3em 0 0;padding-left:1.2em}
  a{color:var(--ok)}
  .done-list{list-style:none;padding:0}
  .done-list li{padding:.35em 0;border-bottom:1px solid var(--line)}
  .hint{color:var(--dim);font-size:.92em;margin:.3em 0 0}
</style>
</head>
<body>

<h1>▓ DEAD SIGNAL STUDIO — SETUP</h1>
<p class="sub">PHP <?= $e(PHP_VERSION) ?> · studio <code><?= $e(basename($STUDIO_DIR)) ?>/</code> · API <code><?= $e($API_PATH) ?></code></p>

<ol class="steps">
  <?php foreach ($stepNames as $i => $name): $n = $i + 1; ?>
    <li class="<?= $n === $step ? 'on' : ($n < $step ? 'done' : '') ?>"><?= $n ?> <?= $e($name) ?></li>
  <?php endforeach; ?>
</ol>

<?php if ($errors): ?>
  <div class="msgs"><strong>Not done yet:</strong><ul><?php foreach ($errors as $err): ?><li><?= $err ?></li><?php endforeach; ?></ul></div>
<?php endif; ?>
<?php if ($notices): ?>
  <div class="msgs note"><strong>Worth knowing:</strong><ul><?php foreach ($notices as $n): ?><li><?= $n ?></li><?php endforeach; ?></ul></div>
<?php endif; ?>

<?php if ($step === 1):
  $counts = $preflight['counts']; ?>
  <div class="panel">
    <h2>1 · What this host can do</h2>
    <p class="why">The same checks as <code>preflight.php</code>, run against this server. Only the
       items marked ✗ stop the backend; each ⚠ costs one optional feature and says which.</p>
    <table>
      <thead><tr><th><span aria-hidden="true">&nbsp;</span></th><th>Check</th><th>Found</th></tr></thead>
      <tbody>
      <?php foreach ($preflight['rows'] as $row): ?>
        <tr>
          <td class="s <?= $e($row['status']) ?>"><?= $row['status'] === 'ok' ? '✔' : ($row['status'] === 'warn' ? '⚠' : '✗') ?></td>
          <td><?= $e($row['name']) ?></td>
          <td><?= $e($row['detail']) ?><?php if ($row['consequence'] !== ''): ?><div class="why"><?= $e($row['consequence']) ?></div><?php endif; ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php if ($counts[StudioPreflight::BLOCK] > 0): ?>
      <p class="hint bad">Fix the ✗ items before continuing — the backend cannot be switched on while they stand.
         You can still continue and configure everything else; the last step will leave the backend off.</p>
    <?php endif; ?>
    <form method="post">
      <input type="hidden" name="action" value="host">
      <input type="hidden" name="step" value="2">
      <input type="hidden" name="reconfirm_key" value="<?= $e($reconfirmKey) ?>">
      <button type="submit">Continue →</button>
    </form>
  </div>

<?php elseif ($step === 2): ?>
  <div class="panel">
    <h2>2 · Database</h2>
    <?php if ($envExists): ?>
      <p>This studio already has a database configured in <code>server/env.php</code>.</p>
      <form method="post">
        <input type="hidden" name="action" value="database">
        <input type="hidden" name="db_mode" value="existing">
        <input type="hidden" name="reconfirm_key" value="<?= $e($reconfirmKey) ?>">
        <button type="submit">Use it →</button>
      </form>
      <p class="hint" style="margin-top:1.6em">Or point the studio at a different database — this overwrites <code>server/env.php</code>:</p>
    <?php else: ?>
      <p>Enter a MySQL user and the database you want the studio to use. <strong>If the database does
         not exist yet it is created for you</strong> — as long as this MySQL user is allowed to
         create one. Nothing is written until the connection succeeds.</p>
      <p class="hint">On cPanel the user usually is <em>not</em> allowed to, so make the database
         there first (MySQL Databases → Create New Database, then add your user with All
         Privileges) and name it here. On a VPS or your own machine, just pick a name.</p>
      <p class="hint">An existing database is fine too. The schema is <code>CREATE TABLE IF NOT
         EXISTS</code> throughout and nothing is dropped or altered, so installing beside another
         application's tables is safe — and if that application already has a <code>users</code>
         table, the studio simply shares its accounts.</p>
    <?php endif; ?>

    <form method="post">
      <input type="hidden" name="action" value="database">
      <input type="hidden" name="db_mode" value="new">
      <input type="hidden" name="reconfirm_key" value="<?= $e($reconfirmKey) ?>">
      <div class="row2">
        <div>
          <label for="db_host">Host</label>
          <input type="text" id="db_host" name="db_host" value="<?= $e($_POST['db_host'] ?? 'localhost') ?>">
          <p class="hint">Shared hosts almost always want <code>localhost</code>.</p>
        </div>
        <div>
          <label for="db_port">Port</label>
          <input type="number" id="db_port" name="db_port" value="<?= $e($_POST['db_port'] ?? 3306) ?>" min="1" max="65535">
        </div>
      </div>
      <label for="db_name">Database name</label>
      <input type="text" id="db_name" name="db_name" value="<?= $e($_POST['db_name'] ?? 'studio') ?>" autocomplete="off">
      <p class="hint">Created if it is not there. Letters, numbers, underscores and hyphens.</p>
      <div class="row2">
        <div>
          <label for="db_user">Database user</label>
          <input type="text" id="db_user" name="db_user" value="<?= $e($_POST['db_user'] ?? '') ?>" autocomplete="off">
        </div>
        <div>
          <label for="db_pass">Password</label>
          <input type="password" id="db_pass" name="db_pass" autocomplete="new-password">
        </div>
      </div>
      <label for="timezone">Timezone</label>
      <select id="timezone" name="timezone">
        <?php $tz = $_POST['timezone'] ?? 'UTC';
              foreach (DateTimeZone::listIdentifiers() as $id): ?>
          <option value="<?= $e($id) ?>"<?= $id === $tz ? ' selected' : '' ?>><?= $e($id) ?></option>
        <?php endforeach; ?>
      </select>
      <button type="submit">Test and save →</button>
    </form>
  </div>

<?php elseif ($step === 3): ?>
  <div class="panel">
    <h2>3 · Schema</h2>
    <p>This creates six tables: the studio's four (<code>studio_projects</code>,
       <code>studio_assets</code>, <code>studio_versions</code>, <code>studio_shares</code>) plus
       <code>users</code> and <code>sessions</code>, because signing in is what the backend is for.</p>
    <p class="hint">Safe to run again: applied files are recorded and skipped, and a table that
       already exists counts as done rather than as an error. The ledger is
       <code>_studio_migrations</code>, kept separate from any other application's.</p>
    <?php if ($migrationResults): ?>
      <table>
        <tbody>
        <?php foreach ($migrationResults as $r): ?>
          <tr>
            <td class="s <?= $r['status'] === 'fail' ? 'bad' : 'ok' ?>"><?= $r['status'] === 'fail' ? '✗' : '✔' ?></td>
            <td><?= $e($r['file']) ?></td>
            <td class="why"><?= $e($r['msg']) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    <?php endif; ?>
    <form method="post">
      <input type="hidden" name="action" value="migrate">
      <input type="hidden" name="reconfirm_key" value="<?= $e($reconfirmKey) ?>">
      <button type="submit">Apply the schema →</button>
    </form>
  </div>

<?php elseif ($step === 4):
  $counts = $preflight['counts'];
  $blocked = $counts[StudioPreflight::BLOCK] > 0;
  $ffmpeg = StudioPreflight::findFfmpeg(); ?>
  <div class="panel">
    <h2>4 · Studio settings</h2>
    <p>Written to <code>server/config/studio.php</code>. Every value here can be changed later by
       editing that file — it is plain PHP and re-derivable.</p>

    <form method="post">
      <input type="hidden" name="action" value="profile">
      <input type="hidden" name="reconfirm_key" value="<?= $e($reconfirmKey) ?>">

      <div class="check">
        <input type="checkbox" id="studio_enabled" name="studio_enabled" value="1" <?= $blocked ? 'disabled' : 'checked' ?>>
        <label for="studio_enabled" style="margin:0;color:inherit">
          Enable the multi-user backend
          <span class="hint" style="display:block">
            <?= $blocked
              ? 'Unavailable while a blocking check fails (step 1). The studio still works client-side.'
              : 'Off means the studio stays single-user and browser-only, and the CLOUD tab says so.' ?>
          </span>
        </label>
      </div>

      <div class="row2">
        <div>
          <label for="studio_quota_mb">Storage per user (MB)</label>
          <input type="number" id="studio_quota_mb" name="studio_quota_mb" value="2048" min="64" max="102400">
        </div>
        <div>
          <label for="studio_asset_mb">Largest single file (MB)</label>
          <input type="number" id="studio_asset_mb" name="studio_asset_mb" value="512" min="8" max="4096">
          <p class="hint">Uploads are chunked, so this is not limited by the host's upload cap.</p>
        </div>
      </div>

      <?php if ($ffmpeg !== null): ?>
        <div class="check">
          <input type="checkbox" id="studio_server_render" name="studio_server_render" value="1">
          <label for="studio_server_render" style="margin:0;color:inherit">
            Allow server-side rendering
            <span class="hint" style="display:block">ffmpeg found at <code><?= $e($ffmpeg) ?></code>. Optional — export runs in the browser either way.</span>
          </label>
        </div>
      <?php endif; ?>

      <div class="check">
        <input type="checkbox" id="studio_cron" name="studio_cron" value="1">
        <label for="studio_cron" style="margin:0;color:inherit">
          A cron job will run maintenance
          <span class="hint" style="display:block">Without one, abandoned uploads are swept during normal requests instead. Either is fine.</span>
        </label>
      </div>

      <button type="submit">Save settings →</button>
    </form>
  </div>

<?php elseif ($step === 5): ?>
  <div class="panel">
    <h2>5 · Account</h2>
    <?php if ($hasUsers): ?>
      <p>This database already has accounts. Add another for the studio, or skip and sign in with one
         that exists.</p>
      <p class="hint">Existing accounts are never modified here — if the name is taken, this step
         refuses rather than resetting someone's password.</p>
    <?php else: ?>
      <p>The first account. This is the name and password you sign in with on the studio's
         <strong>CLOUD</strong> tab.</p>
      <p class="hint">Every account has identical rights: each owns its own projects, and sharing is
         decided per project by whoever owns it. There is no sign-up page — to add someone, re-run
         this wizard with the reconfirm key.</p>
    <?php endif; ?>

    <form method="post">
      <input type="hidden" name="action" value="account">
      <input type="hidden" name="account_mode" value="create">
      <input type="hidden" name="reconfirm_key" value="<?= $e($reconfirmKey) ?>">
      <label for="account_name">Display name</label>
      <input type="text" id="account_name" name="account_name" value="<?= $e($_POST['account_name'] ?? '') ?>" maxlength="64" autocomplete="username">
      <div class="row2">
        <div>
          <label for="account_pass">Password</label>
          <input type="password" id="account_pass" name="account_pass" autocomplete="new-password">
          <p class="hint">At least 8 characters.</p>
        </div>
        <div>
          <label for="account_pass2">Password again</label>
          <input type="password" id="account_pass2" name="account_pass2" autocomplete="new-password">
        </div>
      </div>
      <button type="submit">Create the account →</button>
    </form>

    <?php if ($hasUsers): ?>
      <form method="post">
        <input type="hidden" name="action" value="account">
        <input type="hidden" name="account_mode" value="skip">
        <input type="hidden" name="reconfirm_key" value="<?= $e($reconfirmKey) ?>">
        <button type="submit" class="secondary">Skip — I have an account →</button>
      </form>
    <?php endif; ?>
  </div>

<?php else:
  $studioUrl = rtrim(StudioInstall::scriptUrlDir($_SERVER), '/') . '/'; ?>
  <div class="panel">
    <h2>6 · Done</h2>
    <ul class="done-list">
      <li><span class="ok">✔</span> Database configured — <code>server/env.php</code></li>
      <li><span class="ok">✔</span> Schema applied</li>
      <li><span class="ok">✔</span> Studio settings written — <code>server/config/studio.php</code></li>
      <?php if ($accountCreated): ?>
        <li><span class="ok">✔</span> Account created</li>
      <?php else: ?>
        <li><span class="warn">•</span> No account created — sign in with an existing one</li>
      <?php endif; ?>
      <?php /* Said on its own line and on every route through step 5: skipping the
               account step used to leave the wizard unlocked and say nothing. */ ?>
      <?php if (is_file($LOCK_FILE)): ?>
        <li><span class="ok">✔</span> Setup locked — re-running it needs the reconfirm key</li>
      <?php else: ?>
        <li><span class="warn">•</span> Setup could <strong>not</strong> be locked — delete <code>setup.php</code> by hand</li>
      <?php endif; ?>
      <li id="api-check"><span class="warn">•</span> Checking the API from your browser…</li>
    </ul>

    <p style="margin-top:1.4em"><strong><a href="<?= $e($studioUrl) ?>">Open the studio →</a></strong>
       Go to the <strong>CLOUD</strong> tab and sign in.</p>

    <p class="hint">The studio finds the API at <code><?= $e($API_REL) ?></code> — that is
      <code><?= $e($API_PATH) ?></code> from here.
      <?php if ($deployNote === null): ?>
        Recorded in <code>studio.config.json</code> beside <code>index.html</code>, which saves the
        client a probe; delete that file to go back to auto-detection.
      <?php else: ?>
        <?= $deployNote ?>
      <?php endif; ?>
    </p>

    <div class="msgs note" style="margin-top:1.6em">
      <strong>Two files to delete now:</strong>
      <ul>
        <li><code>setup.php</code> (this page) — it configures your install.</li>
        <li><code>preflight.php</code> — it describes your server.</li>
      </ul>
    </div>
  </div>

  <script>
    /* The real client path, checked the way the browser will actually use it:
       a rewrite rule that Apache never loaded shows up here as a 404 rather
       than as a mystery on the CLOUD tab a week later. */
    (async () => {
      const el = document.getElementById('api-check');
      const url = <?= json_encode($API_PATH . '/system/health', JSON_UNESCAPED_SLASHES) ?>;
      const say = (cls, mark, text) => { el.innerHTML = '';
        const s = document.createElement('span'); s.className = cls; s.textContent = mark;
        el.appendChild(s); el.appendChild(document.createTextNode(' ' + text)); };
      const ask = async (u) => {
        const res = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        return { status: res.status, body: await res.json().catch(() => null) };
      };
      try {
        const r = await ask(url);
        if (r.body && r.body.status === 'healthy') { say('ok', '✔', 'API reachable at ' + url); return; }
        if (r.body && r.body.status) {
          say('warn', '⚠', 'API reachable but ' + r.body.status + ' (database: ' + (r.body.database || '?') + ')');
          return;
        }
        /* The rewrite did not happen. The same backend answers at its own
           filename, so try that before reporting a broken install — and if it
           works, say so, because it is what the studio will then use and the
           operator should know why the address looks like that. */
        const direct = <?= json_encode($API_PATH . '/index.php/system/health', JSON_UNESCAPED_SLASHES) ?>;
        const d = await ask(direct).catch(() => ({ status: 0, body: null }));
        if (d.body && d.body.status) {
          say('warn', '⚠', 'API reachable only at ' + direct + ' — this host is ignoring api/.htaccess'
            + ' (AllowOverride None, or the dotfile did not upload). The studio detects this and uses it'
            + ' automatically; fixing the rewrite saves one request per session.');
        } else if (r.status === 404) {
          say('bad', '✗', 'API 404 at ' + url + ' — api/ did not upload, or PHP does not run there');
        } else {
          say('bad', '✗', 'API responded ' + r.status + ' at ' + url);
        }
      } catch (err) {
        say('bad', '✗', 'Could not reach ' + url + ' (' + err.message + ')');
      }
    })();
  </script>
<?php endif; ?>

</body>
</html>
