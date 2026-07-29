<?php
/**
 * Dead Signal Studio — command-line schema runner.
 *
 *   php server/migrate.php              apply everything pending
 *   php server/migrate.php --status     say what would run, change nothing
 *   php server/migrate.php --create-db  create the database first if it is missing
 *
 * setup.php does this from the browser; this exists for hosts where SSH is
 * easier than a wizard, and for re-running the schema after an update without
 * unlocking the installer.
 *
 * CLI only. It is not routed by the API and would refuse to run if it were.
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo "This script runs from the command line only.\n";
    exit(1);
}

require_once __DIR__ . '/StudioInstall.php';

$envFile = StudioInstall::envFile();
if (!is_file($envFile)) {
    fwrite(STDERR, "No configuration at server/env.php — run setup.php first, or copy env.example.php and fill it in.\n");
    exit(1);
}

$env = require $envFile;
if (!is_array($env)) {
    fwrite(STDERR, "server/env.php did not return a configuration array.\n");
    exit(1);
}

$args = array_slice($argv, 1);
$dbCfg = StudioInstall::dbConfig($env);

try {
    $pdo = StudioInstall::connect($dbCfg);
} catch (PDOException $e) {
    // 1049 unknown database, 1044 no access to it (which MySQL also answers for
    // a database that does not exist when the user holds no privilege on it).
    $code = (int) ($e->errorInfo[1] ?? 0);
    if ($code !== 1049 && $code !== 1044) {
        fwrite(STDERR, 'Could not connect to the database: ' . $e->getMessage() . "\n");
        exit(1);
    }
    if (!in_array('--create-db', $args, true)) {
        // Not created silently: env.php is a file someone edited, and a typo in
        // the database name should not leave a stray empty database behind.
        fwrite(STDERR, "The database named in server/env.php is not reachable.\n"
            . "  If it does not exist yet:      php server/migrate.php --create-db\n"
            . "  If it exists (cPanel, mostly): add this user to it with All Privileges.\n");
        exit(1);
    }
    try {
        $server = StudioInstall::connectServer($dbCfg);
        $made = StudioInstall::useOrCreateDatabase($server, (string) ($dbCfg['database'] ?? ''));
        echo $made ? "Created database " . $dbCfg['database'] . " (utf8mb4).\n" : '';
        $pdo = StudioInstall::connect($dbCfg);
    } catch (Throwable $e2) {
        fwrite(STDERR, strip_tags($e2->getMessage()) . "\n");
        exit(1);
    }
}

$statusOnly = in_array('--status', $args, true);

if ($statusOnly) {
    $applied = [];
    try {
        $applied = $pdo->query('SELECT filename FROM _studio_migrations')->fetchAll(PDO::FETCH_COLUMN);
    } catch (PDOException $e) {
        echo "No migrations have been applied yet.\n";
    }
    $files = glob(StudioInstall::migrationsDir() . '/*.sql') ?: [];
    sort($files);
    foreach ($files as $file) {
        $name = basename($file);
        printf("  %s  %s\n", in_array($name, $applied, true) ? 'applied' : 'PENDING', $name);
    }
    exit(0);
}

$out = StudioInstall::migrate($pdo);
foreach ($out['results'] as $r) {
    printf("  %-5s %-28s %s\n", $r['status'], $r['file'], $r['msg']);
}

if ($out['errors']) {
    foreach ($out['errors'] as $err) fwrite(STDERR, "\n" . $err . "\n");
    exit(1);
}

printf("\n%d migration%s applied.\n", $out['applied'], $out['applied'] === 1 ? '' : 's');
