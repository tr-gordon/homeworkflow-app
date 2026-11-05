"use client";

import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { AssignmentDetail } from "@/components/AssignmentDetail";
import { Loading } from "@/components/ui";
import { useRequireRole } from "@/lib/hooks";

function Inner() {
  const viewer = useRequireRole("any");
  if (!viewer) return <Loading />;
  return (
    <AppShell viewer={viewer} active="home">
      <AssignmentDetail viewer={viewer} />
    </AppShell>
  );
}

/** One route for both roles; the assignment is chosen by `?id=` (static export has no dynamic routes). */
export default function AssignmentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Inner />
    </Suspense>
  );
}
