"use client";

import { Button, Card } from "@/components/ui";

/**
 * Last line of defence: if any screen fails to render, show this instead of a blank page.
 * Homework data is stored apart from the screen code, so an error here does not lose it.
 */
export default function ErrorScreen({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg p-4 pt-12">
      <Card>
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-muted">
          This screen hit a problem. Your homework is safe: it is stored on this device, separate from the screen that failed.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
        </div>
      </Card>
    </main>
  );
}
