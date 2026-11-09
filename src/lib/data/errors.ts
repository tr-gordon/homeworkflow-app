export type RepoErrorCode =
  | "not_set_up"
  | "corrupt_data"
  | "forbidden"
  | "not_found"
  | "validation"
  | "timer_active_exists"
  | "timer_not_running"
  | "timer_not_paused"
  | "timer_already_finished"
  | "timer_not_found"
  | "assignment_busy"
  | "assignment_archived"
  | "newer_version"
  | "pin_not_set"
  | "wrong_pin"
  | "pin_locked"
  | "invalid_file"
  | "wrong_student"
  | "bad_signature"
  | "unsupported_here"
  | "unknown";

const FRIENDLY: Record<RepoErrorCode, string> = {
  not_set_up: "Set up HomeworkFlow on this device first.",
  corrupt_data: "The saved data on this device couldn't be read. A copy was kept so nothing is lost.",
  forbidden: "That isn't allowed in this view.",
  not_found: "We couldn't find that.",
  validation: "Please check the details and try again.",
  timer_active_exists: "Another timer is already running. Finish or pause it first.",
  timer_not_running: "That timer isn't running.",
  timer_not_paused: "That timer isn't paused.",
  timer_already_finished: "That timer is already finished.",
  timer_not_found: "We couldn't find that timer.",
  assignment_busy: "Finish or stop the timer on that assignment first.",
  assignment_archived: "Restore this assignment first.",
  newer_version: "That file is from a newer version of HomeworkFlow. Close and reopen this app once or twice to update it, then try again.",
  pin_not_set: "No parent PIN is set yet. Set one in Settings first.",
  wrong_pin: "That PIN isn't right.",
  pin_locked: "Too many wrong PINs. Please wait a minute and try again.",
  invalid_file: "That file isn't a HomeworkFlow file, or it is damaged.",
  wrong_student: "That file is for a different student.",
  bad_signature: "That changes file wasn't made from this student's snapshot, so it was not applied.",
  unsupported_here: "That isn't available on this kind of device.",
  unknown: "Something went wrong. Please try again.",
};

export class RepoError extends Error {
  constructor(
    public readonly code: RepoErrorCode,
    message?: string,
  ) {
    super(message ?? FRIENDLY[code]);
    this.name = "RepoError";
  }
}
