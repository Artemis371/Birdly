"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { usePolling } from "@/lib/client/usePolling";

// Re-renders the current server page (and the top bar) every `ms` while the
// person is here. router.refresh keeps what's on screen until the new data
// arrives, so there's no loading flash and no layout jump.
export function AutoRefresh({ ms }: { ms: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  usePolling(
    () =>
      new Promise<void>((resolve) => {
        startTransition(() => {
          router.refresh();
          resolve();
        });
      }),
    ms,
  );
  return null;
}
