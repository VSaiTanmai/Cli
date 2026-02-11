"use client";

import { useEffect, useState, useCallback, useRef } from "react";

export function usePolling<T>(
  url: string,
  intervalMs: number = 5000,
  enabled: boolean = true,
): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mountedRef.current) {
        setData(json);
        setError(null);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Fetch failed");
        setLoading(false);
      }
    }
  }, [url]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    fetchData();
    const timer = setInterval(fetchData, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchData, intervalMs, enabled]);

  return { data, loading, error, refresh: fetchData };
}
