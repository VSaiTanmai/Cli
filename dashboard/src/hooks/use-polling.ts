"use client";

import { useEffect, useState, useCallback, useRef } from "react";

/** Max consecutive errors before backing off to max interval */
const MAX_BACKOFF_ERRORS = 5;
/** Maximum backoff multiplier (interval * 2^5 = 32x) */
const MAX_BACKOFF_MULTIPLIER = 32;

export function usePolling<T>(
  url: string,
  intervalMs: number = 5000,
  enabled: boolean = true,
): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const errorCountRef = useRef(0);

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mountedRef.current) {
        setData(json);
        setError(null);
        setLoading(false);
        errorCountRef.current = 0; // Reset backoff on success
      }
    } catch (err) {
      // Ignore aborted requests (component unmounted or new request started)
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Fetch failed");
        setLoading(false);
        errorCountRef.current = Math.min(
          errorCountRef.current + 1,
          MAX_BACKOFF_ERRORS,
        );
      }
    }
  }, [url]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    fetchData();

    // Exponential backoff: on errors, poll slower to reduce pressure
    const getInterval = () => {
      if (errorCountRef.current === 0) return intervalMs;
      const multiplier = Math.min(
        Math.pow(2, errorCountRef.current),
        MAX_BACKOFF_MULTIPLIER,
      );
      return intervalMs * multiplier;
    };

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        await fetchData();
        if (mountedRef.current) schedule();
      }, getInterval());
    };
    schedule();

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      // Cancel in-flight request on unmount — prevents state updates on dead component
      abortRef.current?.abort();
    };
  }, [fetchData, intervalMs, enabled]);

  return { data, loading, error, refresh: fetchData };
}
