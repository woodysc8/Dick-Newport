"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-7xl p-8">
      <h1 className="text-3xl font-semibold">Transactions unavailable</h1>
      <p role="alert" className="mt-4">
        Your transaction workspace could not be opened. Your records are
        unchanged.
      </p>
      <button onClick={reset} className="mt-4 rounded border px-4 py-2">
        Retry
      </button>
      <Link href="/" className="ml-4 underline">
        Overview
      </Link>
    </main>
  );
}
