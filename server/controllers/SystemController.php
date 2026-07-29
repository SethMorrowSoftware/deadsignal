<?php
/**
 * SystemController — is this thing on?
 *
 * GET /system/health is how the client identifies the API. It is not merely a
 * liveness check: the client walks a list of candidate addresses and decides
 * which one is the backend by whether the body has `status` and `version`. A
 * site that returns index.html for every path answers 200 to this URL, so a
 * 200 alone must never be taken as "found it" — which is why this always
 * answers with those two fields, healthy or not.
 *
 * A database that is down is reported as `degraded` with 503: the API is there,
 * and saying so is the difference between "check your install" and "check your
 * database".
 */
class SystemController
{
    public const API_VERSION = '1.0.0';

    public function health(array $params): void
    {
        $dbOk = false;
        try {
            Database::fetchColumn('SELECT 1');
            $dbOk = true;
        } catch (\Throwable $e) {
            // Reported below, not thrown: this endpoint's job is to answer.
        }

        $storage = new StudioStorage();

        http_response_code($dbOk ? 200 : 503);
        echo json_encode([
            'status'    => $dbOk ? 'healthy' : 'degraded',
            'database'  => $dbOk ? 'connected' : 'disconnected',
            'studio'    => $storage->isEnabled() ? 'enabled' : 'disabled',
            'timestamp' => date('c'),
            'version'   => self::API_VERSION,
            'service'   => 'dead-signal-studio',
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }
}
