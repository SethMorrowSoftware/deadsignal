# Installing Dead Signal Studio

There are two things you can install, and they are independent.

1. **The studio.** A folder of static files. Copy it onto any web server and
   open it. Every generator, every export and the whole editor run in the
   browser. No PHP, no database, no build step, no accounts.
2. **The backend** (`api/` + `server/`). Optional. It adds the three things one
   browser cannot do alone: projects that follow you between machines, assets
   stored somewhere other than IndexedDB, and sharing a project with someone
   else.

A studio with no backend is a **supported deployment**, not a degraded one. If
all you want is the tool, stop after part 1.

---

## 1. The studio (static)

Upload the whole folder — or the subset in [What to upload](#what-to-upload) —
and open `index.html` through a web server.

```bash
python -m http.server 8000     # from inside the folder
# then open http://localhost:8000/
```

> **It must be served.** Opening `index.html` off the filesystem does not work:
> the engine is ES modules and browsers refuse module `import`s over `file://`
> (CORS, origin `null`). Any static server will do — `python -m http.server`,
> `npx serve`, Apache, nginx, an S3 bucket with static hosting, a `~/public_html`
> on shared hosting.

Two browser features want a **secure context** (`https://`, or `localhost`):

| Without it | What happens |
|---|---|
| WebCodecs offline export | Video export falls back to real-time `MediaRecorder`. Same file, slower, and the tab must stay visible. |
| `navigator.storage.persist()` | The library still works; the browser is just freer to evict it under storage pressure. |

Neither is fatal. `http://` on a plain LAN address is usable; `https://` is
better.

### What to upload

The minimum set, if you are picking files by hand:

```
index.html
styles/
src/
```

That is the entire tool. Add these only if you want the backend:

```
api/            ← including api/.htaccess  (see the warning below)
server/
setup.php
```

And these are development/administration only — **delete them from a live host**:

```
preflight.php   ← reports your server configuration
router.php      ← only used by `php -S`
test-*.mjs      ← the test suites
test-*.php
scripts/
tests/
```

> ⚠️ **`api/.htaccess` is a dotfile, and many FTP clients and unzip tools skip
> dotfiles silently.** Without it, Apache 404s every API request and the CLOUD
> tab reports "No backend found" on a perfectly healthy install. It is the most
> common deployment failure there is. Turn on "show hidden files" in your
> client, and check afterwards: `preflight.php` and `setup.php` both verify the
> file arrived.

---

## 2. The backend

### What it needs

| | |
|---|---|
| **PHP** | 8.0 or newer, with `pdo_mysql` |
| **MySQL / MariaDB** | MySQL 5.7.8+ or MariaDB 10.2.7+ (project documents need a JSON column), plus a database and a user with rights on it |
| **A writable directory** | `server/` must be writable while the wizard runs; `server/data/` afterwards |
| **Rewrites** | Apache with `AllowOverride All`, or the nginx rule below. Neither is *required* — see [If the rewrite is not honoured](#if-the-rewrite-is-not-honoured) |

Not required: shell access, cron, `exec()`, ffmpeg, composer, or any PHP
extension beyond `pdo_mysql`. The studio renders in the browser, so a host that
disables `exec()` — which most shared hosting does — costs you nothing.

### Check the host first (optional)

`preflight.php` answers "what can this host actually do?" before you commit to
an install. It refuses to run until you give it a token, because the report
describes your server configuration and that is not something to publish:

1. open `preflight.php` and set `$TOKEN` near the top to any hard-to-guess string;
2. visit `https://yoursite.example/<wherever>/preflight.php?run=YOUR-TOKEN`;
3. **delete the file** when you have the report.

It runs the same checks as step 1 of the wizard, from the same code, so the two
cannot disagree.

### Run the wizard

Visit `setup.php` wherever the studio folder is:

```
https://yoursite.example/<wherever>/setup.php
```

Every path is derived from that file's location, so the studio installs the same
way at a document root, in a subdirectory of an unrelated site, or three folders
down. There is no layout to get wrong and nothing to configure about where it
lives.

Six steps:

| Step | What it does |
|---|---|
| **1 Host** | The preflight report. Blockers stop you here; warnings do not. |
| **2 Database** | Connection details → writes `server/env.php`. |
| **3 Schema** | Applies `server/migrations/` — six tables, all `CREATE TABLE IF NOT EXISTS`. |
| **4 Studio** | Quotas, upload limits, storage path → writes `server/config/studio.php`. |
| **5 Account** | Creates the first account. |
| **6 Done** | Locks the install and tells you to delete `setup.php`. |

**Creating the database.** The wizard will `CREATE DATABASE` for you where the
user holds the privilege — a VPS, a local machine, most Docker setups. On cPanel
it usually cannot, so make the database first (**MySQL Databases → Create New
Database**, then **Add User To Database** with *All Privileges*) and name it in
the wizard. You get a message saying exactly that rather than a raw SQL error.

**An existing database is fine.** The schema is `CREATE TABLE IF NOT EXISTS`
throughout and nothing is ever dropped or altered, so the studio installs beside
another application's tables. If that application already has a `users` table,
the studio shares its accounts.

> One caveat when sharing a `users` table: if the other application deletes an
> account, the studio's rows cascade away with it but the **files** they pointed
> at do not. Remove `server/data/studio/assets/<user-id>/` by hand.

### Afterwards

**Delete `setup.php` and `preflight.php`.** While no install exists, `setup.php`
is open by design — it is what creates the first account. Once one exists, it
refuses to run for an anonymous visitor and demands `?reconfirm_key=` (the
database password, or `setup.secret` from `server/env.php` when the password is
empty). That guard is real, but deleting the file is better than relying on it.

**Never commit `server/env.php`.** It holds the database password. The shipped
`.gitignore` already excludes it, along with `server/config/`, `server/data/`
and `studio.config.json`.

### Without the wizard

Everything the wizard does has a command-line equivalent:

```bash
cp server/env.example.php server/env.php   # then fill in the database block
php server/migrate.php                     # apply the schema
php server/migrate.php --create-db         # …creating the database first

php server/account.php list
php server/account.php add    <name> <password>
php server/account.php passwd <name> <new-password>
```

`server/config/studio.php` is optional — the backend has working defaults for
every value in it. It documents itself, and it is safe to delete and regenerate.

### Accounts

Accounts are made from the server, never from a sign-up page. `setup.php`
creates the first; after that use `php server/account.php add <name> <password>`,
or re-run the wizard with the reconfirm key. Every account has identical rights;
who may see a project is decided per project by its owner
(**owner / editor / commenter / viewer**).

### Turning the backend off

Set `'enabled' => false` in `server/config/studio.php`. The backend goes quiet,
the CLOUD tab says so, and everything else is untouched. This is not
uninstalling — nothing is deleted and flipping it back restores the lot.

---

## Web server configuration

### Apache

Nothing to do, provided `AllowOverride` lets `api/.htaccess` be read. That file
is the whole configuration: it routes `<studio>/api/<anything>` to
`api/index.php` and restores the `Authorization` header that CGI/FastCGI strips.

### nginx

nginx does not read `.htaccess`. Add the equivalent, with the path the studio is
actually served from:

```nginx
location ^~ /studio/api/ {
    try_files $uri /studio/api/index.php$is_args$args;
}

location ~ ^/studio/api/index\.php {
    include        fastcgi_params;
    fastcgi_pass   unix:/run/php/php8.1-fpm.sock;
    fastcgi_param  SCRIPT_FILENAME $document_root/studio/api/index.php;
    fastcgi_split_path_info ^(.+\.php)(/.*)$;
    fastcgi_param  PATH_INFO $fastcgi_path_info;
}

# The backend's data and configuration are never served directly.
location ~ ^/studio/server/ { deny all; }
```

### If the rewrite is not honoured

The studio handles this rather than breaking. When `./api` does not answer, the
client tries `./api/index.php` — the same backend reached without a rewrite —
and remembers whichever one worked. So an `AllowOverride None` host still gets a
working studio; it just spends one extra request finding that out, once.

### Storage

Uploaded assets live under `server/data/studio/assets/<user-id>/` and are served
**only** through the API, never as static files. The installer writes a deny
rule at `server/data/.htaccess` covering both Apache generations.

If your host ignores `.htaccess`, that deny rule does nothing and uploads become
fetchable by URL. The preflight checks this **live** — it fetches the file
through the web server rather than trusting that it exists — and says so
plainly. The fix is to point `storage_path` in `server/config/studio.php` at a
directory **above** the document root, or to add the deny rule to the server
configuration.

---

## Local development

PHP's built-in server has no rewrite rules, so `router.php` supplies the one
`api/.htaccess` gives Apache. That makes `php -S` a complete environment for
both halves:

```bash
php -S localhost:8000 router.php     # from inside the folder
```

`router.php` derives the studio's mount point rather than assuming `/api`, so it
works from a parent directory too. It is a development shim — do not ship it.

To run the two suites that need a live server and a database:

```bash
php -S 127.0.0.1:8090 router.php               # in another terminal

php  test-studio-api.php   http://127.0.0.1:8090
node test-studio-cloud.mjs http://127.0.0.1:8090
```

Both skip cleanly when nothing is listening. Everything else runs with
`bash scripts/ci-gate.sh`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page, console says a module failed to load | Opened over `file://` | Serve it. Any static server. |
| CLOUD tab: "No backend found" | `api/.htaccess` missing, or `api/`/`server/` not uploaded | Re-upload with hidden files shown; check with `preflight.php` |
| CLOUD tab: "backend is not configured" (503) | `server/env.php` missing | Run `setup.php`, or copy `env.example.php` and fill it in |
| CLOUD tab: "reachable but degraded" | The API is up, the database is not | Check the database block in `server/env.php` |
| Signed out on every request | CGI/FastCGI dropped the `Authorization` header | `api/.htaccess` restores it — confirm the file arrived |
| Uploads fail with a directory message | `server/data/` not writable | `chmod 755` (775 if PHP runs as another user) |
| Setup says "already installed" | `server/env.php` exists | Add `?reconfirm_key=<db password>`, or the `setup.secret` from `env.php` |
| Video export is slow and needs the tab visible | No secure context, so no WebCodecs | Serve over `https://` or `localhost` |
| MP4 export produced a `.webm` | This Chromium build ships without H.264 | Expected. The console says so and the library records the extension actually written. |
