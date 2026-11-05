import { DIFFICULTY_LABELS } from "@/lib/domain/estimates";
import type { Difficulty } from "@/lib/domain/types";

export function DifficultyText({ difficulty }: { difficulty: Difficulty }) {
  return <>{`Difficulty ${difficulty}/5 (${DIFFICULTY_LABELS[difficulty].toLowerCase()})`}</>;
}
