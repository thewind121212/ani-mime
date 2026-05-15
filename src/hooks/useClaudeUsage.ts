import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface UsageResult {
  text: string;
  fetched_at: number;
}

interface UseClaudeUsageOptions {
  /** When false, the hook does nothing. Flip to true to trigger a fetch. */
  enabled: boolean;
}

interface UseClaudeUsageReturn {
  data: UsageResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useClaudeUsage({ enabled }: UseClaudeUsageOptions): UseClaudeUsageReturn {
  const [data, setData] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the latest in-flight request so a stale resolve doesn't overwrite
  // a fresher one when the user clicks Refresh rapidly.
  const requestIdRef = useRef(0);

  const fetchUsage = useCallback((forceRefresh: boolean) => {
    const id = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    invoke<UsageResult>("get_claude_usage", { forceRefresh })
      .then((result) => {
        if (requestIdRef.current !== id) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (requestIdRef.current !== id) return;
        setError(typeof err === "string" ? err : String(err));
        setLoading(false);
      });
  }, []);

  // First fetch when the consumer enables us.
  useEffect(() => {
    if (!enabled) return;
    if (data || loading) return;
    fetchUsage(false);
  }, [enabled, data, loading, fetchUsage]);

  const refresh = useCallback(() => {
    fetchUsage(true);
  }, [fetchUsage]);

  return { data, loading, error, refresh };
}
