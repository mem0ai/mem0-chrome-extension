/* eslint-disable no-empty */
type AnchorCandidate =
  | string
  | {
      find: () => Element | null;
    };

type InlinePlacement = {
  strategy: 'inline';
  where?: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend';
  inlineAlign?: 'start' | 'end';
  inlineClass?: string;
};

type DockPlacement = {
  strategy: 'dock';
  container?: string | Element;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  gap?: number;
};

type FloatPlacement = {
  strategy: 'float';
  placement?:
    | 'top-start'
    | 'top-center'
    | 'top-end'
    | 'right-start'
    | 'right-center'
    | 'right-end'
    | 'bottom-start'
    | 'bottom-center'
    | 'bottom-end'
    | 'left-start'
    | 'left-center'
    | 'left-end';
  gap?: number;
};

export type Placement = InlinePlacement | DockPlacement | FloatPlacement;

export type ApplyPlacementOptions = {
  container: HTMLElement;
  anchor: Element | null;
  placement?: Placement | null;
};

export type FindAnchorOptions = {
  candidates?: AnchorCandidate[];
  timeoutMs?: number;
  pollMs?: number;
};

export type MountResilientOptions = {
  anchors?: AnchorCandidate[];
  timeoutMs?: number;
  pollMs?: number;
  placement?: Placement;
  enableFloatingFallback?: boolean;
  render?: (shadow: ShadowRoot, host: HTMLElement, anchor: Element | null) => void | (() => void);
};

export type MountOnEditorFocusOptions = {
  editorSelector?: string;
  deriveAnchor?: (editor: Element) => Element | null;
  existingHostSelector?: string;
  placement?: Placement;
  cacheTtlMs?: number;
  persistCache?: boolean;
  fallback?: () => void;
  learnKey?: string;
  render?: (shadow: ShadowRoot, host: HTMLElement, anchor: Element | null) => void | (() => void);
};

type Stopper = () => void;

type ShadowHost = {
  host: HTMLDivElement;
  shadow: ShadowRoot;
};

type CachedAnchorHint = {
  sel: string;
  placement: Placement | null;
  ts: number;
  ver: string;
};

declare const chrome:
  | {
      runtime?: { getManifest: () => { version: string } };
      storage?: {
        session?: {
          get: (key: string, cb: (items: Record<string, unknown>) => void) => void;
          set: (items: Record<string, unknown>, cb?: () => void) => void;
        };
        local?: {
          get: (key: string, cb: (items: Record<string, unknown>) => void) => void;
          set: (items: Record<string, unknown>, cb?: () => void) => void;
          remove: (key: string | string[], cb?: () => void) => void;
        };
      };
    }
  | undefined;

/* utils */
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function watchForRemoval(node: Node, onGone: () => void): MutationObserver {
  const obs = new MutationObserver(() => {
    if (!document.contains(node)) {
      try {
        obs.disconnect();
      } catch {}
      onGone();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  return obs;
}

function watchSpaNavigation(callback: () => void, intervalMs: number = 500): Stopper {
  const w = globalThis;
  const loc = w.location;
  const hist = w.history;

  let href = loc.href;
  const i = w.setInterval(() => {
    if (loc.href !== href) {
      href = loc.href;
      callback();
    }
  }, intervalMs);

  w.addEventListener('popstate', callback);

  const originalPush = hist.pushState.bind(hist) as History['pushState'];
  const originalReplace = hist.replaceState.bind(hist) as History['replaceState'];

  // Reassign and trigger callback on SPA nav
  hist.pushState = ((...args: Parameters<History['pushState']>) => {
    const r = originalPush(...args);
    callback();
    return r;
  }) as History['pushState'];

  hist.replaceState = ((...args: Parameters<History['replaceState']>) => {
    const r = originalReplace(...args);
    callback();
    return r;
  }) as History['replaceState'];

  return () => {
    w.clearInterval(i);
    w.removeEventListener('popstate', callback);
    hist.pushState = originalPush;
    hist.replaceState = originalReplace;
  };
}

/* public API */
export function createShadowRootHost(className: string = 'mem0-root'): ShadowHost {
  const host = document.createElement('div');
  host.className = className;
  const shadow = host.attachShadow({ mode: 'open' });
  return { host, shadow };
}

export async function findAnchor(
  candidates: AnchorCandidate[] = [],
  timeoutMs: number = 2000,
  pollMs: number = 250
): Promise<Element | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      let el: Element | null = null;
      if (typeof cand === 'string') {
        el = document.querySelector(cand);
      } else if (cand && typeof cand.find === 'function') {
        el = cand.find();
      }
      if (el) {
        return el;
      }
    }
    await sleep(pollMs);
  }
  return null;
}

export function applyPlacement(opts: ApplyPlacementOptions): Stopper {
  const { container, anchor, placement } = opts;

  if (!anchor) {
    document.body.appendChild(container);
    return () => {
      return;
    };
  }

  const p = placement || ({ strategy: 'inline' } as Placement);

  switch (p.strategy) {
    case 'inline': {
      const where = p.where || 'beforeend';
      (anchor as Element).insertAdjacentElement(where, container);
      if (p.inlineAlign === 'end') {
        container.style.marginLeft = 'auto';
      }
      if (p.inlineClass) {
        container.classList.add(p.inlineClass);
      }
      return () => {
        return;
      };
    }

    case 'dock': {
      const host = (
        p.container
          ? typeof p.container === 'string'
            ? anchor.closest(p.container) || (anchor as Element)
            : p.container
          : anchor
      ) as HTMLElement;

      if (getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
      }
      const side = p.side || 'bottom';
      const align = p.align || 'start';
      const gap = p.gap ?? 8;

      const cs = container.style;
      cs.position = 'absolute';
      cs.zIndex = '2147483647';

      const layout = (): void => {
        host.getBoundingClientRect(); // force layout
        if (side === 'top') {
          cs.top = `${-container.offsetHeight - gap}px`;
          cs.bottom = '';
        }
        if (side === 'bottom') {
          cs.top = `${host.offsetHeight + gap}px`;
          cs.bottom = '';
        }
        if (side === 'left') {
          cs.left = `${-container.offsetWidth - gap}px`;
          cs.right = '';
          cs.top = '';
        }
        if (side === 'right') {
          cs.left = `${host.offsetWidth + gap}px`;
          cs.right = '';
          cs.top = '';
        }

        const a = { start: '0px', center: '50%', end: '100%' }[align];
        if (side === 'top' || side === 'bottom') {
          cs.left = a;
          cs.transform = align === 'center' ? 'translateX(-50%)' : '';
        } else {
          cs.top = a;
          cs.transform = align === 'center' ? 'translateY(-50%)' : '';
        }
      };

      host.appendChild(container);
      layout();

      const ro = new ResizeObserver(layout);
      ro.observe(host);

      const on = (): void => layout();
      globalThis.addEventListener('scroll', on, true);
      globalThis.addEventListener('resize', on);

      return () => {
        ro.disconnect();
        globalThis.removeEventListener('scroll', on, true);
        globalThis.removeEventListener('resize', on);
      };
    }

    case 'float': {
      const gap = p.gap ?? 8;

      const position = (): void => {
        const r = (anchor as Element).getBoundingClientRect();
        const cs = container.style;
        cs.position = 'fixed';
        cs.zIndex = '2147483647';

        const parts = (p.placement || 'right-start').split('-');
        const side = parts[0] as 'top' | 'right' | 'bottom' | 'left';
        const align = (parts[1] || 'start') as 'start' | 'center' | 'end';

        const set = (x: number, y: number): void => {
          cs.left = `${x}px`;
          cs.top = `${y}px`;
        };

        const y = { start: r.top, center: r.top + r.height / 2, end: r.bottom };
        const x = { start: r.left, center: r.left + r.width / 2, end: r.right };

        if (side === 'right') {
          set(r.right + gap, y[align] ?? r.top);
        }
        if (side === 'left') {
          set(r.left - container.offsetWidth - gap, y[align] ?? r.top);
        }
        if (side === 'bottom') {
          set(x[align] ?? r.left, r.bottom + gap);
        }
        if (side === 'top') {
          set(x[align] ?? r.left, r.top - container.offsetHeight - gap);
        }
      };

      document.body.appendChild(container);
      position();

      const on = (): void => position();
      globalThis.addEventListener('scroll', on, true);
      globalThis.addEventListener('resize', on);
      const ro = new ResizeObserver(on);
      ro.observe(anchor as Element);

      return () => {
        globalThis.removeEventListener('scroll', on, true);
        globalThis.removeEventListener('resize', on);
        ro.disconnect();
      };
    }

    default: {
      (anchor as Element).appendChild(container);
      return () => {
        return;
      };
    }
  }
}

/* private helpers */
function validateCachedAnchor(sel: string | undefined, editor: Element | null) {
  const el = sel ? (document.querySelector(sel) as Element | null) : null;
  if (!el || !el.isConnected || !document.contains(el)) {
    return { ok: false as const, reason: 'missing' as const };
  }
  if (editor && !(el === editor || el.contains(editor) || editor.contains(el))) {
    return { ok: false as const, reason: 'mismatch' as const };
  }
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) {
    return { ok: false as const, reason: 'invisible' as const };
  }
  return { ok: true as const, el };
}

function selectorFor(el: Element | null): string {
  if (!el) {
    return '';
  }
  if ((el as HTMLElement).id) {
    return `#${(el as HTMLElement).id}`;
  }
  const tag = (el.tagName || '').toLowerCase();
  const cls =
    (el as HTMLElement).className && typeof (el as HTMLElement).className === 'string'
      ? '.' + (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
  const s = tag + cls;
  const p = el.parentElement;
  if (p && p.id) {
    return `#${p.id} > ${s}`;
  }
  return s;
}

function keyFor(opts: { learnKey?: string }): string {
  const loc = globalThis.location;
  return 'mem0_anchor_hint:' + (opts.learnKey || `${loc.host}:${loc.pathname}`);
}

function now(): number {
  return Date.now();
}

function ver(): string {
  try {
    return chrome?.runtime?.getManifest().version ?? '0';
  } catch {
    return '0';
  }
}

/* chrome storage helpers (safe, promise-based) */
async function getSession<T = unknown>(k: string): Promise<T | null> {
  return new Promise<T | null>(resolve => {
    try {
      chrome?.storage?.session?.get(k, (o: Record<string, unknown>) =>
        resolve((o?.[k] as T) ?? null)
      );
    } catch {
      resolve(null);
    }
  });
}

async function setSession<T = unknown>(k: string, v: T): Promise<void> {
  return new Promise<void>(resolve => {
    try {
      const o: Record<string, unknown> = {};
      o[k] = v as unknown;
      chrome?.storage?.session?.set(o, resolve);
    } catch {
      resolve();
    }
  });
}

async function getLocal<T = unknown>(k: string): Promise<T | null> {
  return new Promise<T | null>(resolve => {
    try {
      chrome?.storage?.local?.get(k, (o: Record<string, unknown>) =>
        resolve((o?.[k] as T) ?? null)
      );
    } catch {
      resolve(null);
    }
  });
}

async function setLocal<T = unknown>(k: string, v: T): Promise<void> {
  return new Promise<void>(resolve => {
    try {
      const o: Record<string, unknown> = {};
      o[k] = v as unknown;
      chrome?.storage?.local?.set(o, resolve);
    } catch {
      resolve();
    }
  });
}

async function delLocal(k: string | string[]): Promise<void> {
  return new Promise<void>(resolve => {
    try {
      chrome?.storage?.local?.remove(k, resolve);
    } catch {
      resolve();
    }
  });
}

/* cache API */
export async function resolveCachedAnchor(
  opts: { learnKey?: string },
  editor: Element | null,
  ttlMs: number = 24 * 60 * 60 * 1000
): Promise<{ el: Element; placement: Placement | null } | null> {
  const k = keyFor(opts);

  // fast session cache
  let hint = (await getSession<CachedAnchorHint>(k)) || null;
  if (hint?.sel) {
    const v = validateCachedAnchor(hint.sel, editor);
    if (v.ok) {
      return { el: v.el, placement: hint.placement };
    }
  }

  // persisted cache
  hint = (await getLocal<CachedAnchorHint>(k)) || null;
  if (hint?.sel && hint.ver === ver() && now() - hint.ts < ttlMs) {
    const v2 = validateCachedAnchor(hint.sel, editor);
    if (v2.ok) {
      return { el: v2.el, placement: hint.placement };
    }
  } else if (hint) {
    await delLocal(k);
  }

  return null;
}

export async function saveAnchorHint(
  opts: { learnKey?: string },
  anchorEl: Element,
  placement: Placement | null,
  persist?: boolean
): Promise<void> {
  const k = keyFor(opts);
  const hint: CachedAnchorHint = {
    sel: selectorFor(anchorEl),
    placement: placement ?? null,
    ts: now(),
    ver: ver(),
  };
  await setSession(k, hint);
  if (persist) {
    await setLocal(k, hint);
  }
}

/* mount helpers */
export function mountResilient(opts: MountResilientOptions): Stopper {
  let cleanup: (() => void) | null = null;
  let stopSpa: Stopper | null = null;
  let removalObs: MutationObserver | null = null;
  let host: HTMLElement | null = null;

  const bootstrap = async (): Promise<void> => {
    try {
      if (cleanup) {
        try {
          cleanup();
        } catch {}
        cleanup = null;
      }
      if (removalObs) {
        try {
          removalObs.disconnect();
        } catch {}
        removalObs = null;
      }
      if (host?.isConnected) {
        host.remove();
      }
      host = null;

      const anchor = await findAnchor(
        opts.anchors || [],
        opts.timeoutMs ?? 2000,
        opts.pollMs ?? 200
      );
      const { host: h, shadow } = createShadowRootHost('mem0-root');
      host = h;

      let unplace: Stopper = () => {
        return;
      };
      if (anchor) {
        unplace = applyPlacement({ container: host, anchor, placement: opts.placement });
      } else if (opts.enableFloatingFallback) {
        Object.assign(host.style, {
          position: 'fixed',
          right: '16px',
          bottom: '16px',
          zIndex: '2147483647',
        });
        document.body.appendChild(host);
      } else {
        return;
      }

      const maybeCleanup =
        typeof opts.render === 'function' ? opts.render(shadow, host, anchor) : null;
      if (typeof maybeCleanup === 'function') {
        cleanup = maybeCleanup;
      }

      const watchNode = anchor || host;
      removalObs = watchForRemoval(watchNode, () => {
        try {
          unplace();
        } catch {}
        if (cleanup) {
          try {
            cleanup();
          } catch {}
        }
        bootstrap();
      });

      if (!stopSpa) {
        stopSpa = watchSpaNavigation(() => bootstrap());
      }
    } catch {
      setTimeout(() => bootstrap(), 1500);
    }
  };

  void bootstrap();

  return () => {
    if (cleanup) {
      cleanup();
    }
    if (stopSpa) {
      stopSpa();
    }
    if (removalObs) {
      removalObs.disconnect();
    }
    if (host?.isConnected) {
      host.remove();
    }
  };
}

export function mountOnEditorFocus(opts: MountOnEditorFocusOptions): Stopper {
  let used = false;
  const editorSelector =
    opts.editorSelector || 'textarea, [contenteditable="true"], input[type="text"]';
  const deriveAnchor =
    opts.deriveAnchor ||
    ((editor: Element) => editor.closest('form') || editor.parentElement || null);
  const guardSelector = opts.existingHostSelector || '#mem0-icon-button, .mem0-root';

  const handleIntent = (e: Event): void => {
    if (used) {
      return;
    }
    try {
      if (guardSelector && document.querySelector(guardSelector)) {
        return;
      }
    } catch {}
    const t = e.target as Element | null;
    if (!t || !(t.matches && t.matches(editorSelector))) {
      return;
    }

    used = true;

    Promise.resolve()
      .then(() => resolveCachedAnchor(opts, t, opts.cacheTtlMs))
      .then(async hit => {
        const anchor = hit?.el ?? deriveAnchor(t);
        const placement =
          hit?.placement ?? (opts.placement || ({ strategy: 'inline' } as Placement));

        if (!anchor && typeof opts.fallback === 'function') {
          used = false;
          return opts.fallback();
        }
        if (!anchor) {
          used = false;
          return;
        }

        const { host, shadow } = createShadowRootHost('mem0-root');

        const unplace = applyPlacement({ container: host, anchor, placement });
        const cleanup = (
          opts.render && typeof opts.render === 'function'
            ? opts.render(shadow, host, anchor)
            : null
        ) as null | (() => void);

        if (!hit?.el) {
          try {
            await saveAnchorHint(opts, anchor, placement, opts.persistCache);
          } catch {}
        }

        const removal = new MutationObserver(() => {
          if (!document.contains(anchor) || !document.contains(host)) {
            try {
              unplace();
            } catch {}
            if (cleanup) {
              try {
                cleanup();
              } catch {}
            }
            try {
              removal.disconnect();
            } catch {}
            used = false;
          }
        });
        removal.observe(document.documentElement, { childList: true, subtree: true });
      })
      .catch(() => {
        used = false;
      });
  };

  globalThis.addEventListener('focusin', handleIntent, true);
  globalThis.addEventListener('keydown', handleIntent, true);
  globalThis.addEventListener('pointerdown', handleIntent, true);

  return function stop() {
    globalThis.removeEventListener('focusin', handleIntent, true);
    globalThis.removeEventListener('keydown', handleIntent, true);
    globalThis.removeEventListener('pointerdown', handleIntent, true);
  };
}

/* bundled export for convenience */
export const OPENMEMORY_UI = {
  createShadowRootHost,
  findAnchor,
  applyPlacement,
  resolveCachedAnchor,
  saveAnchorHint,
  mountResilient,
  mountOnEditorFocus,
};

export default OPENMEMORY_UI;
