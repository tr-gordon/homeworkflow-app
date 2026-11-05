"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getRepo } from "@/lib/data";
import { Loading } from "@/components/ui";

/** Sends people to the right place: sign-in, student dashboard or parent dashboard. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    getRepo()
      .getViewer()
      .then((v) => {
        if (cancelled) return;
        router.replace(!v ? "/setup" : v.role === "student" ? "/student" : "/parent");
      })
      .catch(() => !cancelled && router.replace("/setup"));
    return () => {
      cancelled = true;
    };
  }, [router]);
  return <Loading />;
}
