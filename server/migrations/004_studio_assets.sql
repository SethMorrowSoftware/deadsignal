-- Media Studio: generated and imported binaries.
--
-- Stored on disk under the configured storage root as
-- assets/{owner}/{sha[0:2]}/{sha} — sharded by the first two hex characters so
-- one directory never holds every file. The (owner_id, sha256) unique key
-- gives per-user dedupe: uploading the same file twice costs one row, not one
-- file. project_id is nullable — an asset can belong to the library rather than
-- to any single project, and must survive its project being deleted.
CREATE TABLE IF NOT EXISTS studio_assets (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    owner_id      INT UNSIGNED NOT NULL,
    project_id    INT UNSIGNED NULL,
    sha256        CHAR(64) NOT NULL,
    kind          VARCHAR(20) NOT NULL DEFAULT 'other',
    original_name VARCHAR(255) NOT NULL DEFAULT '',
    mime_type     VARCHAR(100) NOT NULL DEFAULT '',
    size          BIGINT UNSIGNED NOT NULL DEFAULT 0,
    storage_path  VARCHAR(500) NOT NULL,
    metadata      JSON NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_studio_assets_owner_sha (owner_id, sha256),
    KEY idx_studio_assets_project (project_id),
    KEY idx_studio_assets_kind (owner_id, kind),
    CONSTRAINT fk_studio_assets_user
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_studio_assets_project
        FOREIGN KEY (project_id) REFERENCES studio_projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
