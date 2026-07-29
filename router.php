<?php
/**
 * Dead Signal Studio — router for PHP's built-in server.
 *
 *   php -S localhost:8080 router.php                      (from tools/media-studio/)
 *   php -S localhost:8080 tools/media-studio/router.php    (from anywhere above it)
 *
 * The built-in server has no rewrite rules, so a request to <studio>/api/...
 * would 404 against a directory that only contains index.php. This hands those
 * paths to the front controller and lets everything else be served as a static
 * file — which makes `php -S` a complete development environment for the whole
 * tool, client and backend, with no Apache involved.
 *
 * Where the studio is mounted is DERIVED, not assumed: the studio folder can
 * sit at the document root or several directories below it, and the same file
 * works either way. Guessing '/api' would only be right for the first.
 *
 * Not used in production — Apache uses api/.htaccess, nginx uses a try_files
 * rule. Both are in the README.
 */

$path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/';

/* The studio's URL prefix: where this file's directory sits inside the served
   document root. Empty when the studio folder IS the document root. */
$docRoot = realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? '')) ?: '';
$studioFs = realpath(__DIR__) ?: __DIR__;
$prefix = '';
if ($docRoot !== '' && str_starts_with($studioFs, $docRoot)) {
    $prefix = str_replace('\\', '/', substr($studioFs, strlen($docRoot)));
}
$prefix = rtrim($prefix, '/');

$apiPrefix = $prefix . '/api';
if ($path === $apiPrefix || str_starts_with($path, $apiPrefix . '/')) {
    // The front controller derives its mount point from SCRIPT_NAME, which the
    // built-in server sets to this router. Tell it the truth instead.
    $_SERVER['SCRIPT_NAME'] = $apiPrefix . '/index.php';
    require __DIR__ . '/api/index.php';
    return true;
}

// Anything that exists on disk: let the built-in server serve it.
return false;
