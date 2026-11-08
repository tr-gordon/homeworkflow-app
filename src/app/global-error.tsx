"use client";

import "./globals.css";

/** For failures in the page frame itself (the layout), where the normal error screen cannot render. */
export default function GlobalError() {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-lg p-4 pt-12">
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="mt-2">Your homework is safe: it is stored on this device. Reload the app to continue.</p>
          <button type="button" className="mt-4 min-h-11 rounded-xl bg-brand px-4 font-semibold text-brand-contrast" onClick={() => window.location.reload()}>
            Reload the app
          </button>
        </main>
      </body>
    </html>
  );
}
