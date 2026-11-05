"use client";

import { useEffect, useState } from "react";
import { basePath } from "@/lib/config";
import { getRepo, storageAvailable } from "@/lib/data";
import { RepoError } from "@/lib/data/errors";
import { Button, Card, Loading } from "./ui";

type Gate = { status: "checking" } | { status: "ok" } | { status: "blocked" } | { status: "corrupt" } | { status: "error" };

/**
 * Runs once at start: makes sure this browser can store data and that saved
 * data is readable BEFORE any screen runs. Registers the service worker so the
 * app also opens offline (all data is on the device anyway).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate>({ status: "checking" });

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath}/` }).catch(() => {
        // The app works without it; offline support is a bonus.
      });
    }
    // Ask the browser not to evict our data when storage is tight (best effort).
    navigator.storage?.persist?.().catch(() => undefined);

    const check = async (): Promise<Gate> => {
      if (!storageAvailable()) return { status: "blocked" };
      try {
        await getRepo().getDevice();
        return { status: "ok" };
      } catch (e) {
        return { status: e instanceof RepoError && e.code === "corrupt_data" ? "corrupt" : "error" };
      }
    };
    check().then(setGate);
  }, []);

  if (gate.status === "checking") return <Loading />;
  if (gate.status === "blocked") {
    return (
      <Notice title="This browser is blocking storage">
        HomeworkFlow keeps your homework on this device, so it needs browser storage. Turn off private browsing, or allow site data for this page, then reload.
      </Notice>
    );
  }
  if (gate.status === "corrupt") {
    return (
      <Notice title="Saved data couldn't be read">
        <p>
          The data saved on this device is damaged or from a different version. Nothing was deleted: a copy was kept in this browser. If you have a backup file (from Share, then
          Back up), you can erase and restore it.
        </p>
        <Button
          variant="danger"
          className="mt-4"
          onClick={async () => {
            if (window.confirm("Erase the damaged data on this device and start fresh? A backup file is the only way to get it back.")) {
              await getRepo().eraseAllData();
              window.location.reload();
            }
          }}
        >
          Erase and start fresh
        </Button>
      </Notice>
    );
  }
  if (gate.status === "error") return <Notice title="Something went wrong">Please reload the page.</Notice>;
  return <>{children}</>;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-lg p-4 pt-12">
      <Card>
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="mt-2 text-muted">{children}</div>
      </Card>
    </main>
  );
}
