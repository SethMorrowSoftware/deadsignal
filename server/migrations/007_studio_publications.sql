-- Media Studio: publishing one finished asset to the open web.
--
-- A publication is the OPPOSITE trade from a share link. A share link guards a
-- whole project — recipe, history, everything — so its token is a secret shown
-- once and treated like a credential. A publication is one rendered FILE the
-- owner wants strangers to see: the token IS the address, meant to be pasted
-- into a chat, a post, an embed. It is therefore stable, re-showable, and
-- revocable — deleting the row kills the URL.
--
-- One publication per asset (the unique key): publishing twice returns the
-- same address rather than minting a drawer of parallel URLs nobody can audit.
-- The asset FK cascades, so deleting an asset revokes its publication with it
-- and a published URL can never outlive — or leak — a deleted file.
CREATE TABLE IF NOT EXISTS studio_publications (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    asset_id    INT UNSIGNED NOT NULL,
    token       CHAR(64) NOT NULL,
    created_by  INT UNSIGNED NULL,
    expires_at  TIMESTAMP NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_studio_publications_token (token),
    UNIQUE KEY uniq_studio_publications_asset (asset_id),
    CONSTRAINT fk_studio_publications_asset
        FOREIGN KEY (asset_id) REFERENCES studio_assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_studio_publications_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
