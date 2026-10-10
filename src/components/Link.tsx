"use client";

import NextLink from "next/link";
import { type ComponentProps, useState } from "react";

// Drop-in for next/link that prefetches on intent (hover, touch, keyboard
// focus) instead of whenever a link scrolls into view. Every Birdly page is
// dynamic, so viewport prefetching only fetched a thin shell, yet it cost one
// server request per visible link, repeated after every auto-refresh (measured:
// ~24 extra requests per home refresh). This is the "hover-triggered prefetch"
// pattern from the Next.js prefetching guide.
export default function Link({ prefetch, onMouseEnter, onTouchStart, onFocus, ...props }: ComponentProps<typeof NextLink>) {
  const [intent, setIntent] = useState(false);
  return (
    <NextLink
      {...props}
      prefetch={prefetch === false ? false : intent ? (prefetch ?? null) : false}
      onMouseEnter={(e) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
    />
  );
}
