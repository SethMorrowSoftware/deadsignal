<?php
/**
 * Dead Signal Studio — host preflight.
 *
 * Answers one question before anything is installed: what can THIS host
 * actually do? Shared hosting varies enormously, and the difference between
 * "works" and "fails three weeks in" is usually a MySQL version, a disabled
 * exec(), or a small upload cap — none of which are visible from a cPanel
 * dashboard.
 *
 * The setup wizard runs the same checks as step 1 of the install. This page
 * exists for the case where you want the answer BEFORE committing to an
 * install. Both call server/StudioPreflight.php, so they cannot report
 * different things.
 *
 * ---------------------------------------------------------------------------
 * TO RUN: set $TOKEN below to any hard-to-guess string, then visit
 *
 *     https://yoursite.example/<wherever>/preflight.php?run=YOUR-TOKEN
 *
 * It refuses to run without one. Server configuration is not a secret worth
 * publishing, and a preflight page left on a live host is exactly the sort of
 * thing that gets indexed. DELETE THIS FILE once you have the report.
 * ---------------------------------------------------------------------------
 */

$TOKEN = '';   // <-- set me

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');

$given = isset($_GET['run']) ? (string) $_GET['run'] : '';
if ($TOKEN === '' || !hash_equals($TOKEN, $given)) {
    http_response_code(403);
    echo '<!doctype html><meta charset="utf-8"><title>Preflight locked</title>'
       . '<body style="font:14px/1.5 system-ui;max-width:44em;margin:3em auto;padding:0 1em">'
       . '<h1>Preflight is locked</h1>'
       . '<p>Open this file, set <code>$TOKEN</code> near the top to any hard-to-guess string, '
       . 'then visit it with <code>?run=</code> that same string.</p>'
       . '<p>It refuses to run without one because the report describes your server '
       . 'configuration, which is not something to publish.</p>'
       . '<p>If the studio is already installed, <code>setup.php</code> runs these same '
       . 'checks as its first step.</p></body>';
    exit;
}

$STUDIO_DIR = __DIR__;
$SERVER_DIR = __DIR__ . '/server';

if (!is_file($SERVER_DIR . '/StudioPreflight.php')) {
    http_response_code(500);
    echo '<!doctype html><meta charset="utf-8"><title>server/ is missing</title>'
       . '<body style="font:14px/1.5 system-ui;max-width:44em;margin:3em auto;padding:0 1em">'
       . '<h1>The server folder is missing</h1>'
       . '<p>This page needs <code>server/StudioPreflight.php</code> beside it. Upload the whole '
       . 'studio folder, including <code>server/</code> and <code>api/</code>.</p></body>';
    exit;
}

require_once $SERVER_DIR . '/StudioPreflight.php';
require_once $SERVER_DIR . '/StudioInstall.php';

/* Connect only if the studio has already been configured. Credentials are used
   to open the connection and are never printed. */
$pdo = null;
$envFile = StudioInstall::envFile();
$dbNote = 'server/env.php not found — the database has not been configured yet.';
if (is_file($envFile)) {
    $env = @include $envFile;
    try {
        $pdo = StudioInstall::connect(StudioInstall::dbConfig(is_array($env) ? $env : []));
        $dbNote = '';
    } catch (Throwable $e) {
        $dbNote = 'server/env.php exists but the connection failed (' . get_class($e) . ').';
    }
}

$rows = StudioPreflight::checks($STUDIO_DIR, $pdo);
$counts = StudioPreflight::tally($rows);

$verdict = $counts[StudioPreflight::BLOCK] > 0
    ? ['Not ready', 'Fix the items marked ✗. Everything else is optional.', '#ff3860']
    : ($counts[StudioPreflight::WARN] > 0
        ? ['Ready, with reduced features', 'Nothing here stops the install. Each warning costs one optional feature and says which.', '#ffb347']
        : ['Ready', 'This host supports everything, including optional server-side rendering.', '#39ff9e']);

$e = static function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); };
?>
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dead Signal Studio — host preflight</title>
<style>
  body{font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;background:#05080a;color:#bfeee0;
       max-width:60em;margin:0 auto;padding:2em 1em}
  h1{color:#39ff9e;font-size:1.3em;margin:0 0 .2em}
  .sub{color:#5f7d78;margin:0 0 2em}
  .verdict{border:1px solid;border-radius:3px;padding:1em;margin:0 0 2em}
  .verdict h2{margin:0 0 .3em;font-size:1.1em}
  table{width:100%;border-collapse:collapse}
  td,th{text-align:left;padding:.45em .6em;border-bottom:1px solid #12211d;vertical-align:top}
  th{color:#5f7d78;font-weight:normal}
  .s{white-space:nowrap;font-weight:bold}
  .ok{color:#39ff9e} .warn{color:#ffb347} .block{color:#ff3860}
  .why{color:#8fb3ab;font-size:.92em}
  code{background:#0b1412;padding:.1em .35em;border-radius:2px}
  .after{margin-top:2.5em;border-top:1px solid #12211d;padding-top:1.5em;color:#8fb3ab}
</style>
<h1>▓ DEAD SIGNAL STUDIO — HOST PREFLIGHT</h1>
<p class="sub"><?= $e(php_uname('s')) ?> · PHP <?= $e(PHP_VERSION) ?> · <?= $e(date('Y-m-d H:i')) ?></p>

<div class="verdict" style="border-color:<?= $e($verdict[2]) ?>">
  <h2 style="color:<?= $e($verdict[2]) ?>"><?= $e($verdict[0]) ?></h2>
  <div><?= $e($verdict[1]) ?></div>
  <div class="why"><?= (int) $counts['ok'] ?> ok · <?= (int) $counts['warn'] ?> warning<?= $counts['warn'] === 1 ? '' : 's' ?> · <?= (int) $counts['block'] ?> blocking<?php
    if ($dbNote !== '') { echo ' · ' . $e($dbNote); } ?></div>
</div>

<table>
  <thead><tr><th><span aria-hidden="true">&nbsp;</span></th><th>Check</th><th>Found</th></tr></thead>
  <tbody>
  <?php foreach ($rows as $row): ?>
    <tr>
      <td class="s <?= $e($row['status']) ?>"><?= $row['status'] === 'ok' ? '✔' : ($row['status'] === 'warn' ? '⚠' : '✗') ?></td>
      <td><?= $e($row['name']) ?></td>
      <td>
        <?= $e($row['detail']) ?>
        <?php if ($row['consequence'] !== ''): ?><div class="why"><?= $e($row['consequence']) ?></div><?php endif; ?>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>

<div class="after">
  <p><strong>Delete this file when you are done.</strong> It describes your server configuration.</p>
  <p>None of this is required to use the studio: editing, rendering and exporting run in the browser,
     from any static server, with no backend at all. These checks are for the optional multi-user
     backend — accounts, projects that follow you between machines, and sharing.</p>
</div>
