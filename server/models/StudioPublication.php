<?php
/**
 * StudioPublication — one asset, published to the open web by token.
 *
 * The counterpart to StudioShare with the secrecy inverted. A share token
 * guards a whole project and is shown once; a publication token is one
 * rendered file's public ADDRESS — stable, re-showable, pasted into chats and
 * embeds — and revocation is deleting the row. What the two keep in common is
 * the discipline: 256-bit tokens, shape-checked before the database sees
 * them, and expiry decided by the database's own clock (`NOW()`), because an
 * expired URL that still serves is worse than one that stops slightly early.
 */
class StudioPublication
{
    /** 256 bits, hex — the same coinage share links use. */
    public static function mintToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    /**
     * Publish an asset, or return its existing publication.
     *
     * One publication per asset (the unique key): pressing publish twice must
     * hand back the same address, not mint a second URL for the same bytes.
     * Republishing with a different expiry UPDATES the expiry — "keep this up
     * for another week" is a thing an owner means to be able to say.
     */
    public static function publish(int $assetId, ?int $userId, ?int $expiresInSeconds): array
    {
        $existing = self::findByAsset($assetId);
        if ($existing) {
            Database::execute(
                $expiresInSeconds !== null
                    ? 'UPDATE studio_publications SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE asset_id = ?'
                    : 'UPDATE studio_publications SET expires_at = NULL WHERE asset_id = ?',
                $expiresInSeconds !== null ? [$expiresInSeconds, $assetId] : [$assetId]
            );
            return self::findByAsset($assetId);
        }
        Database::execute(
            $expiresInSeconds !== null
                ? 'INSERT INTO studio_publications (asset_id, token, created_by, expires_at)
                   VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))'
                : 'INSERT INTO studio_publications (asset_id, token, created_by, expires_at)
                   VALUES (?, ?, ?, NULL)',
            $expiresInSeconds !== null
                ? [$assetId, self::mintToken(), $userId, $expiresInSeconds]
                : [$assetId, self::mintToken(), $userId]
        );
        return self::findByAsset($assetId);
    }

    /** The live publication for a token, joined to the asset it serves. */
    public static function findByToken(string $token): ?array
    {
        $row = Database::fetchOne(
            'SELECT p.*, a.owner_id, a.sha256, a.kind, a.original_name, a.mime_type, a.size
             FROM studio_publications p
             JOIN studio_assets a ON a.id = p.asset_id
             WHERE p.token = ?
               AND (p.expires_at IS NULL OR p.expires_at > NOW())
             LIMIT 1',
            [$token]
        );
        return $row ? self::cast($row) : null;
    }

    public static function findByAsset(int $assetId): ?array
    {
        $row = Database::fetchOne(
            'SELECT * FROM studio_publications WHERE asset_id = ? LIMIT 1',
            [$assetId]
        );
        return $row ? self::cast($row) : null;
    }

    /** Every publication on assets this user owns — the CLOUD tab's list. */
    public static function listFor(int $ownerId): array
    {
        return array_map([self::class, 'cast'], Database::fetchAll(
            'SELECT p.*, a.original_name, a.kind, a.mime_type, a.size
             FROM studio_publications p
             JOIN studio_assets a ON a.id = p.asset_id
             WHERE a.owner_id = ?
             ORDER BY p.id DESC',
            [$ownerId]
        ));
    }

    public static function revokeForAsset(int $assetId): void
    {
        Database::execute('DELETE FROM studio_publications WHERE asset_id = ?', [$assetId]);
    }

    private static function cast(array $row): array
    {
        foreach (['id', 'asset_id', 'created_by', 'owner_id', 'size'] as $k) {
            if (array_key_exists($k, $row) && $row[$k] !== null) $row[$k] = (int) $row[$k];
        }
        return $row;
    }
}
