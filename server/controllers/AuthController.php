<?php
/**
 * AuthController — signing in and out.
 *
 * Deliberately small. There is no self-registration endpoint: accounts are
 * created by setup.php, which requires either an empty install or proof of
 * server access. A creative tool for a named group of people does not need an
 * open sign-up form, and an open one on a shared host is a liability nobody
 * asked for. To add a user, re-run setup.php with the reconfirm key.
 *
 * Routes:
 *   POST /auth/login    { displayName, password } → { token, user }
 *   POST /auth/logout                             → { success }
 *   GET  /auth/me                                 → { user }
 */
class AuthController
{
    /** POST /auth/login */
    public function login(array $params): void
    {
        // Ten attempts per fifteen minutes per IP. Slow enough to make online
        // guessing pointless, loose enough that a person who genuinely forgot
        // which capitalisation they used is not locked out for the afternoon.
        Middleware::rateLimit(10, 900)($params);

        $displayName = trim((string) input('displayName', ''));
        $password = (string) input('password', '');

        if ($displayName === '' || $password === '') {
            jsonError('Display name and password are required');
        }

        $user = User::findByDisplayName($displayName);
        if (!$user || !is_string($user['password_hash'] ?? null) || $user['password_hash'] === '') {
            // Constant-time-ish: run a dummy verify so a name that does not
            // exist does not answer measurably faster than a wrong password,
            // which would turn this endpoint into an account-enumeration oracle.
            password_verify($password, '$2y$12$' . str_repeat('.', 53));
            jsonError('Invalid credentials', 401);
        }
        if (!password_verify($password, (string) $user['password_hash'])) {
            jsonError('Invalid credentials', 401);
        }

        $session = Session::create((int) $user['id'], (int) studioEnv('app.session_lifetime', 604800));
        User::touch((int) $user['id']);

        jsonResponse([
            'token'     => $session['token'],
            'expiresAt' => $session['expires_at'],
            'user'      => User::toPublic($user),
        ]);
    }

    /** POST /auth/logout — always succeeds; the token is going either way. */
    public function logout(array $params): void
    {
        $token = Middleware::extractBearerToken();
        if ($token !== null) Session::invalidate($token);
        jsonResponse(['success' => true]);
    }

    /** GET /auth/me */
    public function me(array $params): void
    {
        Middleware::auth(true)($params);
        $user = currentUser();

        // Sliding expiry: someone using the studio should not be signed out
        // mid-session for having been signed in a long time.
        $session = currentSession();
        if ($session && isset($session['token'])) {
            Session::extend((string) $session['token'], (int) studioEnv('app.session_lifetime', 604800));
        }

        jsonResponse(['user' => User::toPublic($user)]);
    }
}
