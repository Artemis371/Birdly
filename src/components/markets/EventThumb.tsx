/* eslint-disable @next/next/no-img-element -- remote event art; next/image optimization would burn the free-tier quota */
export function EventThumb({ src, alt, size = 40 }: { src: string | null; alt: string; size?: number }) {
  if (!src) return <div className="shrink-0 rounded-lg bg-surface-2" style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-lg bg-surface-2 object-cover"
      style={{ width: size, height: size }}
    />
  );
}
