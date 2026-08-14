<?php
/**
 * Dead Signal Studio — the player page for a published asset.
 *
 * <studio>/watch.php?t=<token> is what an author actually pastes into a chat
 * or a post: a page with a player in it, wrapping the raw bytes route
 * (api/…/studio/p/<token>) the way a share needs — a bare .webm URL plays in a
 * tab, but it has no title, no context and no download affordance.
 *
 * Standalone PHP beside index.html — like setup.php and preflight.php — rather
 * than a route in the JSON front controller, because every route there speaks
 * JSON behind no-store headers and a player page wants the opposite of both.
 * It talks to the same models the API uses, in-process; no HTTP self-call.
 *
 * Anonymous by design: the 256-bit token IS the credential, exactly like a
 * project share link, and everything else keeps that discipline — shape-check
 * before the database sees it, expiry decided by the DB clock, the owner's
 * identity never on the page, and revocation (or disabling the studio)
 * killing the page immediately.
 */

declare(strict_types=1);

$page = static function (int $status, string $title, string $bodyHtml): void {
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex');
    $t = htmlspecialchars($title, ENT_QUOTES);
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex">'
        . '<title>' . $t . '</title><style>'
        . ':root{color-scheme:dark}'
        . 'body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;'
        . 'justify-content:center;background:#05080a;color:#c8ffe3;'
        . 'font:14px/1.5 "DejaVu Sans Mono","Consolas",monospace}'
        . '.card{max-width:min(92vw,960px);width:100%;padding:18px;box-sizing:border-box}'
        . 'h1{font-size:15px;font-weight:normal;letter-spacing:.12em;color:#39ff9e;margin:0 0 10px;'
        . 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
        . 'h1::before{content:"▓ "}'
        . 'video,audio,img{display:block;width:100%;max-height:78vh;background:#000;'
        . 'border:1px solid #123726;border-radius:4px;box-sizing:border-box}'
        . 'audio{max-width:640px;margin:24px auto}'
        . 'img{object-fit:contain}'
        . '.meta{margin-top:10px;display:flex;gap:14px;align-items:center;color:#5c8f78;font-size:12px}'
        . '.meta a{color:#39ff9e;text-decoration:none;border:1px solid #1d5c3e;border-radius:4px;'
        . 'padding:3px 10px}'
        . '.meta a:hover{background:#39ff9e;color:#02100a}'
        . '.msg{color:#5c8f78;text-align:center}'
        . '.scan{position:fixed;inset:0;pointer-events:none;opacity:.14;'
        . 'background:repeating-linear-gradient(0deg,transparent 0 2px,#000 2px 4px)}'
        . '</style></head><body><div class="card">' . $bodyHtml . '</div>'
        . '<div class="scan" aria-hidden="true"></div></body></html>';
    exit;
};

$gone = static function (string $why) use ($page): void {
    $page(404, 'DEAD SIGNAL', '<h1>NO CARRIER</h1><p class="msg">' . htmlspecialchars($why, ENT_QUOTES) . '</p>');
};

// A studio with no backend has no publications; say so as a page, not as the
// bootstrap's JSON 503.
if (!is_file(__DIR__ . '/server/env.php')) {
    $gone('This studio has no backend installed, so nothing is published here.');
}

require_once __DIR__ . '/server/bootstrap.php';

// Guessing resistance, same budget class as the API's public routes. The
// limiter answers 429 as JSON, which is tolerable on the abuse path only.
$GLOBALS['_studio_route'] = 'watch.php';
try { Middleware::rateLimit(120, 60)([]); } catch (\Throwable $e) { /* fails open */ }

$storage = new StudioStorage();
if (!$storage->isEnabled()) {
    $gone('Publishing is switched off on this server.');
}

$token = strtolower(trim((string) ($_GET['t'] ?? '')));
if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
    $gone('That is not a valid address.');
}

try {
    $pub = StudioPublication::findByToken($token);
} catch (\Throwable $e) {
    error_log('[studio-watch] lookup failed: ' . $e->getMessage());
    $page(503, 'DEAD SIGNAL', '<h1>NO CARRIER</h1><p class="msg">The archive is not answering. Try again shortly.</p>');
    exit; // unreachable; $page exits
}
if (!$pub) {
    $gone('This signal has been withdrawn, or it never existed.');
}

// The bytes, by the rewrite-free path so the page works on every host the
// studio itself works on (nginx, AllowOverride None, anything).
$src  = 'api/index.php/studio/p/' . $token;
$mime = (string) ($pub['mime_type'] ?? '');
$name = (string) ($pub['original_name'] ?: 'signal');
$size = (int) ($pub['size'] ?? 0);
$mb   = $size > 0 ? number_format($size / 1048576, $size > 10485760 ? 0 : 1) . ' MB' : '';

$srcAttr = htmlspecialchars($src, ENT_QUOTES);
if (str_starts_with($mime, 'video/')) {
    $media = '<video controls playsinline preload="metadata" src="' . $srcAttr . '"></video>';
} elseif (str_starts_with($mime, 'audio/')) {
    $media = '<audio controls preload="metadata" src="' . $srcAttr . '"></audio>';
} elseif (str_starts_with($mime, 'image/')) {
    $media = '<img src="' . $srcAttr . '" alt="' . htmlspecialchars($name, ENT_QUOTES) . '">';
} else {
    $media = '<p class="msg">This file does not play in a browser.</p>';
}

$page(200, $name, '<h1>' . htmlspecialchars($name, ENT_QUOTES) . '</h1>'
    . $media
    . '<div class="meta">'
    . ($mb !== '' ? '<span>' . $mb . '</span>' : '')
    . '<a href="' . $srcAttr . '" download="' . htmlspecialchars($name, ENT_QUOTES) . '">⤓ download</a>'
    . '</div>');
