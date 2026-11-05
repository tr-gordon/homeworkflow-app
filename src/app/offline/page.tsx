export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-md px-4 pt-16 text-center">
      <h1 className="text-2xl font-extrabold">You&apos;re offline</h1>
      <p className="mt-2 text-muted">HomeworkFlow needs a connection to save and show your homework. Your timer keeps counting on the server. Try again when you&apos;re back online.</p>
    </main>
  );
}
