-- Media Studio: server-side projects.
--
-- `document` is the studio's project document verbatim (the same JSON the
-- standalone tool writes). Binaries NEVER go in MySQL — assets live on disk and
-- are referenced from studio_assets. A size cap is enforced in the controller:
-- a document with thousands of keyframes is legitimate, an unbounded one is a
-- denial-of-service.
CREATE TABLE IF NOT EXISTS studio_projects (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uuid           CHAR(36) NOT NULL,
    owner_id       INT UNSIGNED NOT NULL,
    name           VARCHAR(200) NOT NULL,
    description    TEXT NULL,
    document       JSON NOT NULL,
    schema_version INT UNSIGNED NOT NULL DEFAULT 1,
    thumbnail_id   INT UNSIGNED NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'draft',
    size_bytes     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NULL,
    UNIQUE KEY uniq_studio_projects_uuid (uuid),
    KEY idx_studio_projects_owner (owner_id, status),
    KEY idx_studio_projects_updated (updated_at),
    CONSTRAINT fk_studio_projects_user
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
