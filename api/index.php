<?php
/**
 * Dead Signal Studio — API front controller.
 *
 * Every request to <studio>/api/* arrives here (see .htaccess beside this
 * file) and is dispatched to a controller. This is the studio's whole server
 * surface: three endpoint families and nothing else.
 *
 *   /system/health   identify the API and report whether the database is up
 *   /auth/*          sign in, sign out, who am I
 *   /studio/*        projects, versions, shares, assets
 *
 * WHERE THIS LIVES
 *
 * Inside the studio folder, always. The API moves with the tool, so the client
 * finds it at './api' relative to index.html no matter where the folder has
 * been copied to — a whole domain, a subdirectory of an unrelated site, a
 * staging folder three levels down. Nothing here reads or requires a single
 * file from outside `tools/media-studio/`.
 */

require_once __DIR__ . '/../server/bootstrap.php';

Middleware::setJsonHeaders();

// Shared hosting rarely has a cron, so the sweep rides the request path. 1% of
// requests pay for it; an expired session row is a row an attacker could still
// find a use for.
if (mt_rand(1, 100) === 1) {
    try { Session::purgeExpired(); } catch (\Throwable $e) { /* never fails a request */ }
}

/**
 * The path within the API, derived from where this script is mounted.
 *
 * SCRIPT_NAME rather than searching REQUEST_URI for '/api': a studio installed
 * at /api/studio/ would have the search find the wrong occurrence, and the
 * whole point of this file is that it works from any folder.
 */
$path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/';
$scriptName = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? ''));
$scriptDir = rtrim(dirname($scriptName), '/');

if ($scriptDir !== '' && $scriptDir !== '.' && str_starts_with($path, $scriptDir)) {
    $path = substr($path, strlen($scriptDir));
}
// Without a rewrite (nginx, or Apache with .htaccess ignored) requests arrive
// as /api/index.php/system/health. Accept that form rather than 404ing on it —
// it is the fallback that keeps a mis-deployed install usable.
if (str_starts_with($path, '/index.php')) {
    $path = substr($path, strlen('/index.php'));
}
if ($path === '' || $path === false) $path = '/';

$router = new Router();
$router->use(Middleware::parseJsonBody());
$router->use(Middleware::requireCsrf());

/* Every studio route requires a signed-in account. Authorisation per project —
   owner / editor / commenter / viewer — is decided inside
   StudioController::requireProject(), which is the single chokepoint so a new
   endpoint cannot forget the check. */
$authed = [Middleware::auth(true), Middleware::rateLimit(240, 60)];
// Uploads are chunked, so one large asset is many requests by design; a
// 240/min cap would throttle a legitimate 100 MB file.
$upload = [Middleware::auth(true), Middleware::rateLimit(600, 60)];

// ─── System ─────────────────────────────────────────────────
$router->get('/system/health', [SystemController::class, 'health']);

// ─── Auth ───────────────────────────────────────────────────
$router->post('/auth/login',  [AuthController::class, 'login']);
$router->post('/auth/logout', [AuthController::class, 'logout']);
$router->get('/auth/me',      [AuthController::class, 'me']);

// ─── Studio ─────────────────────────────────────────────────
// Literal sub-paths before :id, everywhere. The upload endpoints in particular
// MUST precede /studio/assets/:id, or "init" is parsed as an asset id.
$router->get('/studio/config',                 [StudioController::class, 'config'],         $authed);
$router->get('/studio/projects',               [StudioController::class, 'listProjects'],   $authed);
$router->post('/studio/projects',              [StudioController::class, 'createProject'],  $authed);
$router->get('/studio/projects/:id',           [StudioController::class, 'getProject'],     $authed);
$router->put('/studio/projects/:id',           [StudioController::class, 'updateProject'],  $authed);
$router->delete('/studio/projects/:id',        [StudioController::class, 'deleteProject'],  $authed);
$router->get('/studio/projects/:id/versions',  [StudioController::class, 'listVersions'],   $authed);
$router->post('/studio/projects/:id/versions', [StudioController::class, 'createVersion'],  $authed);
$router->get('/studio/projects/:id/shares',    [StudioController::class, 'listShares'],     $authed);
$router->post('/studio/projects/:id/shares',   [StudioController::class, 'createShare'],    $authed);
$router->post('/studio/versions/:id/restore',  [StudioController::class, 'restoreVersion'], $authed);
$router->delete('/studio/shares/:id',          [StudioController::class, 'revokeShare'],    $authed);
// A share link has to work for someone WITHOUT an account — that is what
// separates it from a named grant. The 256-bit token is the whole credential,
// so this is public but rate-limited, read-only, and links can only ever carry
// viewer or commenter.
$router->get('/studio/shared/:token',          [StudioController::class, 'getShared'],      [Middleware::rateLimit(30, 60)]);
$router->post('/studio/assets/init',           [StudioController::class, 'initUpload'],     $upload);
$router->post('/studio/assets/chunk',          [StudioController::class, 'uploadChunk'],    $upload);
$router->post('/studio/assets/complete',       [StudioController::class, 'completeUpload'], $upload);
$router->get('/studio/assets',                 [StudioController::class, 'listAssets'],     $authed);
$router->get('/studio/assets/:id/raw',         [StudioController::class, 'downloadAsset'],  $authed);
$router->delete('/studio/assets/:id',          [StudioController::class, 'deleteAsset'],    $authed);

// CORS preflight, for the deployment where the studio and its API are on
// different origins. No credentials are echoed and no origin is allowlisted
// here — same-origin is the supported arrangement; this only stops a preflight
// from being answered by the 404 handler.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Some shared hosts block PUT and DELETE outright. Allow a POST to say what it
// really meant, so those hosts are not left with a read-only studio.
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') {
    $override = $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? $_GET['_method'] ?? null;

    if ($override === null) {
        // Cache the body: php://input is not reliably re-readable across SAPIs,
        // and the middleware needs it after this.
        $rawBody = file_get_contents('php://input');
        $GLOBALS['RAW_REQUEST_BODY'] = $rawBody;
        if (is_string($rawBody) && $rawBody !== '') {
            $decoded = json_decode($rawBody, true);
            if (is_array($decoded) && isset($decoded['_method'])) $override = $decoded['_method'];
        }
    }

    if (is_string($override)) {
        $candidate = strtoupper(trim($override));
        if (in_array($candidate, ['PUT', 'DELETE', 'PATCH'], true)) $method = $candidate;
    }
}

try {
    $router->dispatch($method, $path);
} catch (\Throwable $e) {
    error_log('[studio-api] Unhandled exception: ' . $e->getMessage());
    jsonResponse([
        'error'   => 'Internal server error',
        'details' => studioEnv('app.debug', false) ? $e->getMessage() : null,
    ], 500);
}
