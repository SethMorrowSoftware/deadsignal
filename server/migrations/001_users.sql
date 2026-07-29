-- Accounts.
--
-- CREATE TABLE IF NOT EXISTS, deliberately: the studio can be installed into a
-- database that already has a `users` table (its own second install, or an
-- application it is sharing a database with). Sharing the table means sharing
-- the accounts, which is the sane outcome — what must never happen is the
-- installer destroying rows it did not create.
--
-- The columns the studio actually reads are id / display_name / password_hash;
-- the rest exist so a row created here looks like a complete account.
CREATE TABLE IF NOT EXISTS users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uuid            CHAR(36) NOT NULL,
    display_name    VARCHAR(64) NOT NULL,
    password_hash   VARCHAR(255) NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'user',
    is_anonymous    TINYINT(1) NOT NULL DEFAULT 0,
    preferences     JSON NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen       TIMESTAMP NULL,
    upgraded_at     TIMESTAMP NULL,
    UNIQUE KEY uniq_users_uuid (uuid),
    UNIQUE KEY uniq_users_display_name (display_name),
    KEY idx_users_role (role),
    KEY idx_users_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
