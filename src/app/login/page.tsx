import LoginForm from "./LoginForm";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-indigo-700">AutoFly_Review</h1>
        <p className="mt-2 text-slate-600">
          Never leave a Google review unanswered. AI drafts the reply, you approve it before it goes live.
        </p>
      </div>
      <div className="card p-5">
        {searchParams.error === "link_invalid" && (
          <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            That sign-in link is invalid or expired. Request a new one below.
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
