import { z } from "zod";
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
});

export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

export const assignmentPatchSchema = assignmentInputSchema.partial().extend({
  stage: stageSchema.optional(),
});
export type AssignmentPatch = z.infer<typeof assignmentPatchSchema>;

export const displayNameSchema = z.string().trim().min(1, "Add a name").max(LIMITS.displayName);

export const pinSchema = z
  .string()
  .regex(/^[0-9]{4,8}$/, "Use 4 to 8 digits");
