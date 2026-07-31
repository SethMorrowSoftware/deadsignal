<?php
/**
 * Session — one row per live sign-in token.
 *
 * Tokens are 64 random bytes as hex. They travel in the Authorization header
 * and are never put in a URL: query strings end up in proxy logs, browser
 * history and referrer headers, and a token there is a token leaked.
 *
 * Expiry is compared in SQL rather than PHP so the database's clock is the one
 * that decides — the two can disagree, and a session that outlives its expiry
 * is worse than one that ends slightly early.
 */
class Session
{
    public static function findByToken(string $token): ?array
    {
        return Database::fetchOne(
            'SELECT * FROM sessions WHERE token = ? AND (expires_at IS NULL OR expires_at > NOW())',
            [$token]
        );
    }

    /** Issue a session. Returns the token and when it dies. */
    public static function create(int $userId, int $lifetimeSeconds = 86400): array
    {
        $token = bin2hex(random_bytes(32));
        $life = max(300, $lifetimeSeconds);

        // Expiry set by the DB clock via DATE_ADD(NOW(), …), the SAME clock
        // findByToken/purgeExpired read with NOW(). Computing it in PHP with
        // date() and inserting the literal made the stored instant depend on
        // app.timezone vs the MySQL server timezone: where they differ, a
        // session could outlive its lifetime by the offset (or die early).
        Database::insert(
            'INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent, ip_address)
             VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?)',
            [
                $token,
                $userId,
                $life,
                mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
                mb_substr(Middleware::clientIp(), 0, 45),
            ]
        );

        // Returned for display only; the authoritative value lives in the DB.
        return ['token' => $token, 'user_id' => $userId,
                'expires_at' => gmdate('Y-m-d H:i:s', time() + $life)];
    }

    /** Sliding expiry, so an active session does not die mid-edit. */
    public static function extend(string $token, int $lifetimeSeconds = 86400): bool
    {
        return Database::execute(
            'UPDATE sessions SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE token = ?',
            [max(300, $lifetimeSeconds), $token]
        ) > 0;
    }

    public static function invalidate(string $token): bool
    {
        return Database::execute('DELETE FROM sessions WHERE token = ?', [$token]) > 0;
    }

    public static function invalidateAllForUser(int $userId): int
    {
        return Database::execute('DELETE FROM sessions WHERE user_id = ?', [$userId]);
    }

    /**
     * Sweep dead rows.
     *
     * Called probabilistically from the entry point rather than from a cron:
     * shared hosting rarely has one, and an expired session row that lingers is
     * a row an attacker could still find a use for.
     */
    public static function purgeExpired(): int
    {
        return Database::execute('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= NOW()');
    }
}
