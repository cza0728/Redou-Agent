function normalizeScheduleId(value) {
  if (value && typeof value === "object") {
    return String(value.id || value.job_id || value.scheduleId || "").trim();
  }
  return String(value || "").trim();
}

function parseScheduleDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 100000000000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

function scheduleIsPaused(schedule) {
  if (!schedule || typeof schedule !== "object") return false;
  return (
    schedule.disabled === true ||
    schedule.paused === true ||
    String(schedule.status || "").toLowerCase() === "paused" ||
    String(schedule.state || "").toLowerCase() === "paused" ||
    String(schedule.enabled || "").toLowerCase() === "false"
  );
}

function scheduleDueAt(schedule) {
  if (!schedule || typeof schedule !== "object") return null;
  for (const key of ["nextRunAt", "next_run_at", "nextRun", "next_run", "runAt", "run_at", "dueAt", "due_at"]) {
    const date = parseScheduleDate(schedule[key]);
    if (date) return date;
  }
  return null;
}

function isScheduleDue(schedule, now = new Date()) {
  if (!schedule || typeof schedule !== "object") return false;
  if (scheduleIsPaused(schedule)) return false;
  const dueAt = scheduleDueAt(schedule);
  if (!dueAt) return false;
  return dueAt.getTime() <= now.getTime();
}

module.exports = {
  isScheduleDue,
  normalizeScheduleId,
  parseScheduleDate,
  scheduleDueAt,
  scheduleIsPaused,
};
