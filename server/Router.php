<?php
/**
 * Router — the studio API's REST router.
 *
 * Supports:
 *   - GET / POST / PUT / DELETE / PATCH method registration
 *   - Path parameters via :name syntax (e.g. /users/:id)
 *   - Middleware via use()
 *   - 404 / 405 responses
 *
 * Path params are passed to controller methods as an associative array:
 *   $router->get('/studio/projects/:id', [StudioController::class, 'getProject']);
 *   // Calls (new StudioController())->getProject(['id' => '42'])
 */
class Router
{
    /** @var array<string, array<int, array{pattern: string, regex: string, params: array, handler: array|callable}>> */
    private array $routes = [
        'GET'    => [],
        'POST'   => [],
        'PUT'    => [],
        'PATCH'  => [],
        'DELETE' => [],
    ];

    /** @var callable[] */
    private array $middleware = [];

    /**
     * Per-route middleware stacks set by group(); reset after the registrar
     * runs. Stack form keeps nested groups composable in future, even though
     * the current API only registers a single layer at a time.
     * @var callable[][]
     */
    private array $groupStack = [];

    public function get(string $path, $handler, array $middleware = []): self
    {
        return $this->addRoute('GET', $path, $handler, $middleware);
    }

    public function post(string $path, $handler, array $middleware = []): self
    {
        return $this->addRoute('POST', $path, $handler, $middleware);
    }

    public function put(string $path, $handler, array $middleware = []): self
    {
        return $this->addRoute('PUT', $path, $handler, $middleware);
    }

    public function patch(string $path, $handler, array $middleware = []): self
    {
        return $this->addRoute('PATCH', $path, $handler, $middleware);
    }

    public function delete(string $path, $handler, array $middleware = []): self
    {
        return $this->addRoute('DELETE', $path, $handler, $middleware);
    }

    /**
     * Register a middleware that runs before each route's handler (global).
     */
    public function use(callable $middleware): self
    {
        $this->middleware[] = $middleware;
        return $this;
    }

    /**
     * Run $registrar with $middleware automatically attached to every route
     * it registers. Lets callers express "every /studio/* route requires a
     * signed-in account and the studio rate limit" once, instead of repeating
     * the stack on every line — which is how a route eventually ships without
     * it.
     *
     *   $router->group($authed, function ($r) {
     *       $r->get('/studio/projects', [StudioController::class, 'listProjects']);
     *       ...
     *   });
     */
    public function group(array $middleware, callable $registrar): self
    {
        $this->groupStack[] = $middleware;
        try {
            $registrar($this);
        } finally {
            array_pop($this->groupStack);
        }
        return $this;
    }

    /**
     * Dispatch a request. Calls jsonError on 404/405.
     */
    public function dispatch(string $method, string $path): void
    {
        $method = strtoupper($method);
        $path = '/' . trim($path, '/');
        if ($path === '/') {
            $path = '/';
        }

        // Find matching route
        $matchedRoute = null;
        $matchedParams = [];
        $methodsForPath = [];

        foreach ($this->routes as $routeMethod => $routes) {
            foreach ($routes as $route) {
                if (preg_match($route['regex'], $path, $matches)) {
                    if ($routeMethod === $method) {
                        $matchedRoute = $route;
                        // Build associative param array
                        foreach ($route['params'] as $idx => $name) {
                            $matchedParams[$name] = $matches[$idx + 1] ?? null;
                        }
                        break 2;
                    } else {
                        $methodsForPath[] = $routeMethod;
                    }
                }
            }
        }

        if ($matchedRoute === null) {
            if (!empty($methodsForPath)) {
                header('Allow: ' . implode(', ', array_unique($methodsForPath)));
                jsonError('Method not allowed', 405);
            }
            jsonError('Not found: ' . $path, 404);
        }

        // Run global middleware first, then any route-scoped middleware
        // attached via group() or the optional middleware array on the
        // route registration. Each layer can short-circuit by calling
        // jsonError/jsonResponse.
        foreach ($this->middleware as $mw) {
            $mw($matchedParams);
        }
        foreach (($matchedRoute['middleware'] ?? []) as $mw) {
            $mw($matchedParams);
        }

        // Invoke the handler
        $handler = $matchedRoute['handler'];

        if (is_array($handler) && count($handler) === 2 && is_string($handler[0])) {
            // [ClassName::class, 'methodName']
            $controller = new $handler[0]();
            $controller->{$handler[1]}($matchedParams);
        } elseif (is_callable($handler)) {
            $handler($matchedParams);
        } else {
            jsonError('Invalid route handler', 500);
        }
    }

    /**
     * Register a route with method + path.
     */
    private function addRoute(string $method, string $path, $handler, array $middleware = []): self
    {
        $path = '/' . trim($path, '/');
        $params = [];

        // Convert :name segments to regex capture groups
        $regex = preg_replace_callback(
            '#:([a-zA-Z_][a-zA-Z0-9_]*)#',
            function ($matches) use (&$params) {
                $params[] = $matches[1];
                return '([^/]+)';
            },
            $path
        );

        $regex = '#^' . $regex . '$#';

        // Compose group-attached middleware (in outer-to-inner order) with
        // any per-route middleware passed at registration.
        $stacked = [];
        foreach ($this->groupStack as $layer) {
            foreach ($layer as $mw) $stacked[] = $mw;
        }
        foreach ($middleware as $mw) $stacked[] = $mw;

        $this->routes[$method][] = [
            'pattern'    => $path,
            'regex'      => $regex,
            'params'     => $params,
            'handler'    => $handler,
            'middleware' => $stacked,
        ];

        return $this;
    }
}
