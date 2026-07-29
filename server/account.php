<?php
/**
 * Dead Signal Studio — accounts, from the command line.
 *
 *   php server/account.php list
 *   php server/account.php add <name> <password>
 *   php server/account.php passwd <name> <new-password>
 *
 * There is no sign-up page: accounts are made by someone with access to the
 * server, either through setup.php or here. On a host with SSH this is the
 * quicker of the two, and it is the only way to add a user without unlocking
 * the installer.
 *
 * CLI only. It is not routed by the API and refuses to run if it is reached
 * over HTTP.
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo "This script runs from the command line only.\n";
    exit(1);
}

require_once __DIR__ . '/StudioInstall.php';

$usage = <<<TXT
Usage:
  php server/account.php list
  php server/account.php add <name> <password>
  php server/account.php passwd <name> <new-password>

TXT;

$args = array_slice($argv, 1);
$command = $args[0] ?? '';

if ($command === '' || in_array($command, ['-h', '--help', 'help'], true)) {
    echo $usage;
    exit($command === '' ? 1 : 0);
}

$envFile = StudioInstall::envFile();
if (!is_file($envFile)) {
    fwrite(STDERR, "No configuration at server/env.php — run setup.php first.\n");
    exit(1);
}
$env = require $envFile;
if (!is_array($env)) {
    fwrite(STDERR, "server/env.php did not return a configuration array.\n");
    exit(1);
}

try {
    $pdo = StudioInstall::connect(StudioInstall::dbConfig($env));
} catch (PDOException $e) {
    fwrite(STDERR, 'Could not connect to the database: ' . $e->getMessage() . "\n");
    exit(1);
}

switch ($command) {
    case 'list':
        $rows = $pdo->query('SELECT id, display_name, created_at, last_seen FROM users ORDER BY id')->fetchAll();
        if (!$rows) { echo "No accounts yet.\n"; break; }
        foreach ($rows as $r) {
            printf("  %-4s %-24s created %s%s\n", $r['id'], $r['display_name'],
                $r['created_at'] ?? '?', $r['last_seen'] ? '  last seen ' . $r['last_seen'] : '');
        }
        break;

    case 'add':
        $name = trim((string) ($args[1] ?? ''));
        $pass = (string) ($args[2] ?? '');
        if ($name === '' || strlen($pass) < 8) {
            fwrite(STDERR, "A name and a password of at least 8 characters are required.\n");
            exit(1);
        }
        if (StudioInstall::displayNameTaken($pdo, $name)) {
            // Never silently overwrite: this database may be shared, and
            // `add` quietly resetting someone's password is not something a
            // command called "add" should ever do. `passwd` says what it means.
            fwrite(STDERR, "An account called \"$name\" already exists. Use `passwd` to change its password.\n");
            exit(1);
        }
        $id = StudioInstall::createAccount($pdo, $name, $pass);
        echo "Created account \"$name\" (id $id).\n";
        break;

    case 'passwd':
        $name = trim((string) ($args[1] ?? ''));
        $pass = (string) ($args[2] ?? '');
        if ($name === '' || strlen($pass) < 8) {
            fwrite(STDERR, "A name and a password of at least 8 characters are required.\n");
            exit(1);
        }
        if (!StudioInstall::resetPassword($pdo, $name, $pass)) {
            fwrite(STDERR, "No account called \"$name\".\n");
            exit(1);
        }
        // Signing out everywhere is the point of changing a password: a session
        // issued before the change would otherwise outlive it by up to a week.
        $pdo->prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE display_name = ?)')
            ->execute([$name]);
        echo "Password changed for \"$name\". Existing sessions were signed out.\n";
        break;

    default:
        fwrite(STDERR, "Unknown command \"$command\".\n\n" . $usage);
        exit(1);
}
