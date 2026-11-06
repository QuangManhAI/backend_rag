import type { Express } from 'express';

interface RouteLayer {
  route?: { methods: Record<string, boolean> };
  match(path: string): boolean;
}

/** The methods a path answers to; empty when no route matches it. Backs 405 and `Allow`. */
export function allowedMethods(app: Express, path: string): string[] {
  const stack = (app as unknown as { router: { stack: RouteLayer[] } }).router
    .stack;
  const methods = new Set<string>();
  for (const layer of stack) {
    if (!layer.route || !layer.match(path)) continue;
    const { get, post, put, delete: del } = layer.route.methods;
    // A route on every method is middleware mounted with `all`, not an endpoint.
    if (get && post && put && del) continue;
    for (const [method, on] of Object.entries(layer.route.methods)) {
      if (on && method !== '_all') methods.add(method.toUpperCase());
    }
  }
  return [...methods].sort();
}
