<?php
/**
 * Dead Signal Studio — backend bootstrap.
 *
 * This directory is the studio's entire server half. It depends on nothing
 * outside `tools/media-studio/`: no framework, no composer, no application
 * around it. Copy the studio folder onto a host with PHP and MySQL, run
 * setup.php, and it is installed. That independence is the point — the studio
 * is a tool, and a tool that can only run inside one particular application is
 * not really a tool.
 *
 * The backend is also OPTIONAL. Everything the studio does — editing,
 * rendering, exporting — happens in the browser. What this adds is the handful
 * of things one browser cannot do on its own: projects that follow you between
 * machines, assets stored somewhere other than IndexedDB, and sharing a project
 * with someone else. A deployment that never installs any of this is a
 * supported deployment, not a degraded one.
 *
 * Loaded by api/index.php (the front controller) and by the CLI tools.
 */

if (!defined('DEAD_SIGNAL_STUDIO')) {
    define('DEAD_SIGNAL_STUDIO', true);
}

define('STUDIO_SERVER_DIR', __DIR__);

$envFile = __DIR__ . '/env.php';
if (!is_file($envFile)) {
    // Not configured is a normal state, not a crash: the studio ships without
    // an env.php and the client treats "no backend" as an ordinary answer. Say
    // what would fix it rather than just refusing.
    if (php_sapi_name() !== 'cli') {
        http_response_code(503);
        header('Content-Type: application/json');
        echo json_encode([
            'error' => 'The studio backend is not configured on this server. Run the studio\'s setup.php, '
                     . 'or copy server/env.example.php to server/env.php and fill it in.',
        ]);
        exit;
    }
    fwrite(STDERR, "server/env.php not found. Run setup.php, or copy server/env.example.php to server/env.php.\n");
    exit(1);
}

$env = require $envFile;
if (!is_array($env)) {
    if (php_sapi_name() !== 'cli') {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'server/env.php did not return a configuration array.']);
        exit;
    }
    fwrite(STDERR, "server/env.php did not return a configuration array.\n");
    exit(1);
}
$GLOBALS['_studio_env'] = $env;

date_default_timezone_set($env['app']['timezone'] ?? 'UTC');

if ($env['app']['debug'] ?? false) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    // Never to the client: a stack trace naming file paths and SQL is a gift to
    // anyone probing the install. Errors still reach the host's error log.
    error_reporting(E_ALL & ~E_NOTICE & ~E_DEPRECATED);
    ini_set('display_errors', '0');
}

/** Everything this backend owns lives in three directories. */
spl_autoload_register(static function (string $class): void {
    if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $class)) return;
    foreach ([__DIR__, __DIR__ . '/controllers', __DIR__ . '/models'] as $dir) {
        $path = $dir . '/' . $class . '.php';
        if (is_file($path)) { require_once $path; return; }
    }
});

/** Config, with a dotted path and a default: studioEnv('app.session_lifetime', 86400). */
function studioEnv(string $path, $default = null)
{
    $node = $GLOBALS['_studio_env'] ?? [];
    foreach (explode('.', $path) as $key) {
        if (!is_array($node) || !array_key_exists($key, $node)) return $default;
        $node = $node[$key];
    }
    return $node;
}

/* Set by middleware, read by controllers. */
$GLOBALS['requestBody']   = [];
$GLOBALS['currentUser']   = null;
$GLOBALS['currentSession'] = null;

function jsonResponse(array $data, int $statusCode = 200): void
{
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function jsonError(string $message, int $statusCode = 400): void
{
    jsonResponse(['error' => $message], $statusCode);
}

/** A field from the decoded request body. */
function input(string $key, $default = null)
{
    return $GLOBALS['requestBody'][$key] ?? $default;
}

/** The signed-in account, or null. */
function currentUser(): ?array
{
    return $GLOBALS['currentUser'] ?? null;
}

/** The session row backing this request, or null. */
function currentSession(): ?array
{
    return $GLOBALS['currentSession'] ?? null;
}

function generateUuid(): string
{
    $d = random_bytes(16);
    $d[6] = chr(ord($d[6]) & 0x0f | 0x40);   // version 4
    $d[8] = chr(ord($d[8]) & 0x3f | 0x80);   // variant RFC 4122
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}
