"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { AssignmentForm } from "@/components/AssignmentForm";
import { Card, Loading } from "@/components/ui";
import { getRepo } from "@/lib/data";
import { estimateMinutes } from "@/lib/domain/estimates";
import { samplesFromAssignments } from "@/lib/domain/history";
import { assignmentHref } from "@/lib/links";
import { useLoad, useRequireRole, useToday } from "@/lib/hooks";

export default function NewAssignmentPage() {
  const viewer = useRequireRole("student");
  const router = useRouter();
  const today = useToday();
  const data = useLoad(async () => (viewer ? getRepo().listAssignments(viewer.id) : []), [viewer?.id]);
  const samples = useMemo(() => (data.status === "ready" ? samplesFromAssignments(data.data, new Date()) : []), [data]);
  const subjects = useMemo(() => (data.status === "ready" ? Array.from(new Set(data.data.map((a) => a.subject))) : []), [data]);

  if (!viewer) return <Loading />;
  return (
    <AppShell viewer={viewer} active="new">
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-2xl font-extrabold">Add an assignment</h1>
        <Card>
          <AssignmentForm
            mode="create"
            today={today}
            subjectOptions={subjects}
            suggest={(difficulty, subject) => estimateMinutes(difficulty, subject, samples)}
            submitLabel="Add assignment"
            onSubmit={async (input) => {
              const created = await getRepo().createAssignment(input);
              router.push(assignmentHref(created.id));
            }}
          />
        </Card>
      </div>
    </AppShell>
  );
}
