"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

/**
 * Keeps a server-rendered console page live, event-first: an SSE
 * subscription to the org's domain events triggers an immediate (debounced)
 * refresh when something actually happens; the interval remains as the
 * polling floor for instances where the stream can't stay open. Background
 * tabs pause everything and refresh instantly on return.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let source: EventSource | null = null;

    const refreshSoon = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => router.refresh(), 400);
    };

    const start = () => {
      if (!timer) timer = setInterval(() => router.refresh(), seconds * 1000);
      if (!source && typeof EventSource !== "undefined") {
        source = new EventSource(`${PUBLIC_API_URL}/v1/events/stream`);
        source.onmessage = refreshSoon;
        // Named events (task.created, employee.hired, …) all funnel to refresh.
        source.addEventListener("connected", () => {});
        source.onerror = () => {
          source?.close();
          source = null; // stream unavailable → polling floor carries on
        };
      }
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      source?.close();
      source = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        router.refresh();
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      if (debounce.current) clearTimeout(debounce.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, seconds]);

  return null;
}
