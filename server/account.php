<?php
/**
 * Dead Signal Studio — accounts, from the command line.
 *
 *   php server/account.php list
 *   php server/account.php add <name>              # asks for the password
 *   php server/account.php passwd <name>           # asks for the new password
 *
 * The password is asked for rather than passed as an argument. An argument is
 * visible to every user on the box in `ps`, is written verbatim into
 * ~/.bash_history, and on a shared host is often in the process accounting log
 * as well — which makes the one command that sets a credential the one command
 * that leaks it. Passing it anyway still works (scripts exist) but says so.
 *
 * For a script, pipe it instead — a pipe is not in `ps` and not in history:
 *
 *   printf '%s' "$PASSWORD" | php server/account.php add alice
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
  php server/account.php add <name>              (asks for the password)
  php server/account.php passwd <name>           (asks for the new password)

The password can also be piped in, which keeps it out of `ps` and history:
  printf '%s' "\$PASSWORD" | php server/account.php add <name>

TXT;

/**
 * The password, from the safest source available.
 *
 * In order: an argument (works, warns — see the header), a pipe on stdin (the
 * scripted path), or a prompt with the terminal's echo turned off. The prompt
 * asks twice, because a mistyped password that nobody can see is a locked-out
 * account and the only fix is to run this again.
 */
function studio_read_password(?string $fromArgv, string $label): string
{
    if ($fromArgv !== null && $fromArgv !== '') {
        fwrite(STDERR, "Warning: a password given as an argument is visible in `ps` and saved in your\n"
            . "shell history. Next time, leave it off and type it when asked, or pipe it in.\n");
        return $fromArgv;
    }

    /* Not a terminal: something is piping the password in. One line, and the
       trailing newline `printf`/`echo` adds is not part of it. */
    if (!stream_isatty(STDIN)) {
        $line = fgets(STDIN);
        if ($line === false) {
            fwrite(STDERR, "No password on stdin.\n");
            exit(1);
        }
        return rtrim($line, "\r\n");
    }

    $hidden = studio_stty('-echo');
    if (!$hidden) {
        fwrite(STDERR, "(This terminal will show the password as you type it.)\n");
    }
    try {
        fwrite(STDOUT, "$label: ");
        $first = rtrim((string) fgets(STDIN), "\r\n");
        if ($hidden) fwrite(STDOUT, "\n");
        fwrite(STDOUT, "Again: ");
        $again = rtrim((string) fgets(STDIN), "\r\n");
        if ($hidden) fwrite(STDOUT, "\n");
    } finally {
        if ($hidden) studio_stty('echo');
    }

    if ($first !== $again) {
        fwrite(STDERR, "Those did not match. Nothing was changed.\n");
        exit(1);
    }
    return $first;
}

/**
 * Ask the terminal to stop (or resume) echoing. False if it cannot be asked.
 *
 * `stty` is checked for rather than assumed: shell_exec returns the same empty
 * string whether the command ran or the shell could not find it, so calling it
 * blind would report success on a host with no stty and then show the password
 * to the room.
 */
function studio_stty(string $flag): bool
{
    static $available = null;
    if (DIRECTORY_SEPARATOR === '\\' || !function_exists('shell_exec')) return false;
    if ($available === null) {
        $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
        $available = !in_array('shell_exec', $disabled, true)
            && trim((string) @shell_exec('command -v stty 2>/dev/null')) !== '';
    }
    if (!$available) return false;
    @shell_exec('stty ' . $flag . ' 2>/dev/null');
    return true;
}

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
        if ($name === '') {
            fwrite(STDERR, "A name is required.\n\n" . $usage);
            exit(1);
        }
        /* The name is checked BEFORE the password is asked for: typing a
           password twice only to be told the account already exists is a
           password typed into a terminal for nothing. */
        if (StudioInstall::displayNameTaken($pdo, $name)) {
            // Never silently overwrite: this database may be shared, and
            // `add` quietly resetting someone's password is not something a
            // command called "add" should ever do. `passwd` says what it means.
            fwrite(STDERR, "An account called \"$name\" already exists. Use `passwd` to change its password.\n");
            exit(1);
        }
        $pass = studio_read_password($args[2] ?? null, "Password for \"$name\"");
        if (strlen($pass) < 8) {
            fwrite(STDERR, "A password of at least 8 characters is required.\n");
            exit(1);
        }
        $id = StudioInstall::createAccount($pdo, $name, $pass);
        echo "Created account \"$name\" (id $id).\n";
        break;

    case 'passwd':
        $name = trim((string) ($args[1] ?? ''));
        if ($name === '') {
            fwrite(STDERR, "A name is required.\n\n" . $usage);
            exit(1);
        }
        $pass = studio_read_password($args[2] ?? null, "New password for \"$name\"");
        if (strlen($pass) < 8) {
            fwrite(STDERR, "A password of at least 8 characters is required.\n");
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
