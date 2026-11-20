import { useEffect, useState } from 'react';
import { ChevronDown, Globe } from 'lucide-react';
import { Collapse } from '~/components/ui';
import { cn } from '~/utils';

/**
 * Live view of the headless browser the browser presets drive (Playwright MCP).
 * The `browser-live` container serves an MJPEG stream and a small status endpoint;
 * this section only appears while that service answers.
 */
const BASE_URL = (import.meta.env.VITE_BROWSER_LIVE_URL as string | undefined) ?? 'http://localhost:9333';

type Status = { url: string | null; title: string | null };

export default function BrowserLive() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(true);
  const [streamKey, setStreamKey] = useState(0);

  useEffect(() => {
    if (!BASE_URL) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${BASE_URL}/status`, { cache: 'no-store' });
        const next = (await res.json()) as Status;
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!BASE_URL || status == null) {
    return null;
  }

  const idle = status.url == null || status.url === 'about:blank';
  let host = '';
  try {
    host = status.url ? new URL(status.url).host : '';
  } catch {
    host = status.url ?? '';
  }

  return (
    <section data-testid="session-browser-live">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-control flex h-8 w-full min-w-0 items-center gap-1 rounded ps-2 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
        <span>Browser</span>
        {!idle && (
          <span className="relative ms-1 flex size-2" aria-label="live">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-red-500" />
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'ms-auto me-1 size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
            !open && '-rotate-90',
          )}
        />
      </button>
      <Collapse open={open}>
        <div className="px-2 pt-1">
          {idle ? (
            <p className="text-text-secondary text-sm">
              No page open yet. Use a “+ Browser” model and the page will show up here live.
            </p>
          ) : (
            <a
              href={status.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="border-border-light block overflow-hidden rounded-lg border"
              title={status.url ?? undefined}
            >
              <img
                key={streamKey}
                src={`${BASE_URL}/stream`}
                alt={status.title ? `Live browser: ${status.title}` : 'Live browser view'}
                className="block w-full bg-white"
                onError={() => setTimeout(() => setStreamKey((k) => k + 1), 2000)}
              />
            </a>
          )}
          {!idle && (
            <p className="text-text-secondary mt-1 truncate text-xs" title={status.url ?? undefined}>
              {status.title ? `${status.title} · ` : ''}
              {host}
            </p>
          )}
        </div>
      </Collapse>
    </section>
  );
}
