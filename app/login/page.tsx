import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { signIn, signUp } from "../auth/actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/");
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-semibold">Budget Builder</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">Sign in or create an account to view your private dashboard.</p>
      {params.error && <p role="alert" className="mt-4 rounded border border-red-300 p-3 text-sm">Authentication failed. Check your details and try again.</p>}
      {params.notice === "confirm-email" && <p role="status" className="mt-4 rounded border p-3 text-sm">Check your email to confirm your account.</p>}
      <form action={signIn} className="mt-8 space-y-4 rounded-lg border bg-white p-5">
        <h2 className="font-semibold">Sign in</h2>
        <label className="block text-sm">Email<input required autoComplete="email" type="email" name="email" className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block text-sm">Password<input required minLength={8} autoComplete="current-password" type="password" name="password" className="mt-1 block w-full rounded border p-2" /></label>
        <button className="rounded bg-[var(--accent)] px-4 py-2 font-medium text-white">Sign in</button>
      </form>
      <form action={signUp} className="mt-5 space-y-4 rounded-lg border bg-white p-5">
        <h2 className="font-semibold">Create account</h2>
        <label className="block text-sm">Email<input required autoComplete="email" type="email" name="email" className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block text-sm">Password (at least 8 characters)<input required minLength={8} autoComplete="new-password" type="password" name="password" className="mt-1 block w-full rounded border p-2" /></label>
        <button className="rounded border px-4 py-2 font-medium">Create account</button>
      </form>
    </main>
  );
}
