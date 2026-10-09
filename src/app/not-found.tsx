import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-lg font-semibold">That market flew away.</p>
      <p className="mt-1 text-sm text-muted">It may have been removed or the link is wrong.</p>
      <Link href="/" className="mt-4 inline-block rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg">
        Back to markets
      </Link>
    </div>
  );
}
