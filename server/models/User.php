<?php
/**
 * User — an account.
 *
 * The studio needs three things from an account: something to sign in with, a
 * password to check it against, and a stable id to own projects and assets. It
 * deliberately needs nothing else, which is what lets the `users` table be
 * shared with another application that already owns one.
 *
 * `role` is stored but not enforced anywhere in this backend: every signed-in
 * account has exactly the same rights, and who may read or write a given
 * project is decided per project by StudioShare. The column exists so a row
 * created here is a complete account for whatever else shares the table.
 */
class User
{
    public static function findById(int $id): ?array
    {
        return self::hydrate(Database::fetchOne('SELECT * FROM users WHERE id = ?', [$id]));
    }

    public static function findByUuid(string $uuid): ?array
    {
        return self::hydrate(Database::fetchOne('SELECT * FROM users WHERE uuid = ?', [$uuid]));
    }

    public static function findByDisplayName(string $name): ?array
    {
        return self::hydrate(Database::fetchOne('SELECT * FROM users WHERE display_name = ?', [$name]));
    }

    /** Touch last_seen. Best effort — a failure here must never fail a request. */
    public static function touch(int $userId): void
    {
        try {
            Database::execute('UPDATE users SET last_seen = NOW() WHERE id = ?', [$userId]);
        } catch (\Throwable $e) {
            // A shared `users` table may not have this column. Not worth a 500.
        }
    }

    /**
     * The account as the API returns it.
     *
     * The password hash is not in this list, and that is the entire point of
     * the function existing: a row goes to the client only through here.
     */
    public static function toPublic(?array $user): ?array
    {
        if ($user === null) return null;
        return [
            'id'           => (int) $user['id'],
            'uuid'         => $user['uuid'] ?? null,
            'display_name' => $user['display_name'] ?? '',
            'role'         => $user['role'] ?? 'user',
            'created_at'   => $user['created_at'] ?? null,
            'last_seen'    => $user['last_seen'] ?? null,
        ];
    }

    private static function hydrate(?array $row): ?array
    {
        if ($row === null) return null;
        $row['id'] = (int) $row['id'];
        return $row;
    }
}
