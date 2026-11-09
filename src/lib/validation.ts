import { z } from "zod";
import { TIME_RE } from "./domain/changes";
import { STAGES } from "./domain/stages";

/**
 * Input and response validation (validate at the boundary: user input, stored data and files are all untrusted).
 * Limits mirror the CHECK constraints in supabase/migrations.
 */

export const LIMITS = {
  title: 120,
  subject: 40,
  description: 2000,
  displayName: 40,
  location: 40,
  minMinutes: 1,
  maxMinutes: 600,
} as const;

const dateString = z.iso.date();

export const difficultySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const stageSchema = z.enum(STAGES);

export const minutesSchema = z
  .number()
  .int()
  .min(LIMITS.minMinutes, "Time must be at least 1 minute")
  .max(LIMITS.maxMinutes, "Time must be 10 hours or less");

export const assignmentInputSchema = z.object({
  title: z.string().trim().min(1, "Add a title").max(LIMITS.title),
  subject: z.string().trim().min(1, "Add a subject").max(LIMITS.subject),
  description: z.string().trim().max(LIMITS.description),
  dueDate: dateString,
  difficulty: difficultySchema,
  allocatedMinutes: minutesSchema.nullable(),
  plannedDate: dateString.nullable(),
  /** Optional. Empty means "not set"; the data layer stores that as null. */
  location: z.string().trim().max(LIMITS.location, "Keep the place short").nullable().optional(),
  /** HH:MM, 24 hour. Needs a plannedDate (checked where the whole assignment is known). */
  plannedStart: z.string().regex(TIME_RE, "Use a time like 16:30").nullable().optional(),
  withParent: z.boolean().optional(),
});

/** What a parent (or the student) can change about when and where: everything except the assignment itself. */
export const schedulePatchSchema = z.object({
  plannedDate: dateString.nullable().optional(),
  plannedStart: z.string().regex(TIME_RE, "Use a time like 16:30").nullable().optional(),
  withParent: z.boolean().optional(),
  location: z.string().trim().max(LIMITS.location, "Keep the place short").nullable().optional(),
});
export type SchedulePatch = z.input<typeof schedulePatchSchema>;

/** What callers pass in (location may be left out). */
export type AssignmentInput = z.input<typeof assignmentInputSchema>;

export const assignmentPatchSchema = assignmentInputSchema.partial().extend({
  stage: stageSchema.optional(),
});
export type AssignmentPatch = z.infer<typeof assignmentPatchSchema>;

export const displayNameSchema = z.string().trim().min(1, "Add a name").max(LIMITS.displayName);

export const pinSchema = z
  .string()
  .regex(/^[0-9]{4,8}$/, "Use 4 to 8 digits");
