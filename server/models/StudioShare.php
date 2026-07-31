<?php
/**
 * StudioShare - Who else can see a project.
 *
 * A row is EITHER a named grant or an unguessable link, never both. Link
 * tokens are viewer/commenter only: "whoever has the URL can edit" is not a
 * permission model anyone can reason about, and it cannot be revoked for one
 * person without revoking it for everyone.
 *
 * Roles are ordered, so a check is "at least this much access" rather than a
 * set of equality tests that quietly miss a case when a role is added.
 *
 * `commenter` is RESERVED: no commenting endpoint, table, or UI exists yet, so
 * today it confers exactly viewer access (it outranks viewer only so existing
 * grants keep working when commenting ships). Any UI offering it must label it
 * "same as viewer for now" rather than implying a commenting feature.
 */
class StudioShare
{
    public const ROLE_VIEWER    = 'viewer';
    public const ROLE_COMMENTER = 'commenter';
    public const ROLE_EDITOR    = 'editor';
    public const ROLE_OWNER     = 'owner';

    private const RANK = [
        self::ROLE_VIEWER => 1,
        self::ROLE_COMMENTER => 2,
        self::ROLE_EDITOR => 3,
        self::ROLE_OWNER => 4,
    ];

    /** Roles a share may grant. `owner` is implicit and never stored. */
    public static function grantableRoles(): array
    {
        return [self::ROLE_VIEWER, self::ROLE_COMMENTER, self::ROLE_EDITOR];
    }

    /** Roles a LINK may grant — deliberately excludes editor. */
    public static function linkRoles(): array
    {
        return [self::ROLE_VIEWER, self::ROLE_COMMENTER];
    }

    public static function rank(?string $role): int
    {
        return self::RANK[$role] ?? 0;
    }

    /** True when $role is at least $needed. */
    public static function allows(?string $role, string $needed): bool
    {
        return self::rank($role) >= self::rank($needed);
    }

    /**
     * The role a user has on a project, or null.
     *
     * Ownership beats any share row: an owner who also has a stale viewer grant
     * is still the owner.
     */
    public static function roleFor(int $projectId, int $userId, int $ownerId): ?string
    {
        if ($userId === $ownerId) return self::ROLE_OWNER;
        $role = Database::fetchColumn(
            'SELECT role FROM studio_shares
             WHERE project_id = ? AND grantee_id = ? LIMIT 1',
            [$projectId, $userId]
        );
        return $role ? (string) $role : null;
    }

    /**
     * Resolve a link token to its share row, if it is live.
     *
     * Expiry is compared in SQL rather than PHP so the database's clock is the
     * one that decides — the two can disagree, and an expired link that still
     * works is worse than one that stops slightly early.
     */
    public static function findByToken(string $token): ?array
    {
        $row = Database::fetchOne(
            'SELECT * FROM studio_shares
             WHERE link_token = ?
               AND (link_expires_at IS NULL OR link_expires_at > NOW())
             LIMIT 1',
            [$token]
        );
        return $row ? self::hydrate($row) : null;
    }

    public static function listFor(int $projectId): array
    {
        return array_map([self::class, 'hydrate'], Database::fetchAll(
            'SELECT s.*, u.display_name AS grantee_name, u.uuid AS grantee_uuid
             FROM studio_shares s
             LEFT JOIN users u ON u.id = s.grantee_id
             WHERE s.project_id = ?
             ORDER BY s.id DESC',
            [$projectId]
        ));
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetchOne('SELECT * FROM studio_shares WHERE id = ?', [$id]);
        return $row ? self::hydrate($row) : null;
    }

    public static function grantToUser(int $projectId, int $granteeId, string $role, ?int $by): int
    {
        // Re-granting is a role change, not a second row — the unique key on
        // (project_id, grantee_id) makes that explicit rather than an error.
        Database::execute(
            'INSERT INTO studio_shares (project_id, grantee_id, role, created_by)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE role = VALUES(role)',
            [$projectId, $granteeId, $role, $by]
        );
        return (int) Database::fetchColumn(
            'SELECT id FROM studio_shares WHERE project_id = ? AND grantee_id = ?',
            [$projectId, $granteeId]
        );
    }

    public static function createLink(int $projectId, string $token, string $role,
                                      ?int $expiresInSeconds, ?int $by): int
    {
        // Like Session, expiry is set by the DB clock (DATE_ADD(NOW(), …)) so the
        // same clock that reads link_expires_at with NOW() also wrote it — the
        // gmdate() literal it used before skewed against a non-UTC MySQL server.
        if ($expiresInSeconds === null) {
            return Database::insert(
                'INSERT INTO studio_shares (project_id, link_token, role, link_expires_at, created_by)
                 VALUES (?, ?, ?, NULL, ?)',
                [$projectId, $token, $role, $by]
            );
        }
        return Database::insert(
            'INSERT INTO studio_shares (project_id, link_token, role, link_expires_at, created_by)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)',
            [$projectId, $token, $role, $expiresInSeconds, $by]
        );
    }

    public static function revoke(int $id): bool
    {
        return Database::execute('DELETE FROM studio_shares WHERE id = ?', [$id]) > 0;
    }

    /**
     * Row as the API returns it.
     *
     * The token itself is never returned by a listing — it is shown once, at
     * creation, and after that the row only proves a link exists. A share list
     * is visible to more people than the link is meant to be.
     */
    public static function hydrate(array $row, bool $withToken = false): array
    {
        foreach (['id', 'project_id', 'grantee_id', 'created_by'] as $k) {
            if (isset($row[$k])) $row[$k] = $row[$k] === null ? null : (int) $row[$k];
        }
        $row['is_link'] = !empty($row['link_token']);
        if (!$withToken) unset($row['link_token']);
        return $row;
    }
}
