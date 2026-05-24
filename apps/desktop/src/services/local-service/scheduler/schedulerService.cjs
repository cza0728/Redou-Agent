const { REDOU_EVENTS } = require("../eventBus.cjs");
const { isScheduleDue, normalizeScheduleId } = require("./scheduleParser.cjs");

function publishEvent(eventBus, eventName, payload) {
  if (typeof eventBus?.publish === "function") {
    eventBus.publish(eventName, payload);
    return;
  }
  eventBus?.emit?.(eventName, payload);
}

class SchedulerService {
  constructor({
    dashboardBridge,
    eventBus = null,
    repos = {},
    processManager = null,
    contextBuilder = null,
    logger = null,
    options = {},
  } = {}) {
    if (typeof dashboardBridge !== "function") {
      throw new Error("SchedulerService requires a dashboardBridge function.");
    }
    this.dashboardBridge = dashboardBridge;
    this.eventBus = eventBus;
    this.repos = repos;
    this.processManager = processManager;
    this.contextBuilder = contextBuilder;
    this.log = typeof logger === "function" ? logger : () => {};
    this.pollIntervalMs = Math.max(0, Number(options.pollIntervalMs || 0));
    this.timer = null;
    this.initialized = false;
    this.scanning = false;
  }

  init(options = {}) {
    this.initialized = true;
    const interval = Math.max(0, Number(options.pollIntervalMs ?? this.pollIntervalMs));
    if (!interval || this.timer) {
      return { ok: true, polling: Boolean(this.timer), pollIntervalMs: this.timer ? interval : 0 };
    }
    this.timer = setInterval(() => {
      this.scanDueSchedules().catch((error) => {
        this.log(`redou scheduler scan failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, interval);
    this.timer.unref?.();
    return { ok: true, polling: true, pollIntervalMs: interval };
  }

  dispose() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.initialized = false;
    this.scanning = false;
    return { ok: true };
  }

  normalizeListResult(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.jobs)) return result.jobs;
    if (Array.isArray(result?.schedules)) return result.schedules;
    return [];
  }

  listSchedules() {
    return this.dashboardBridge("cron_list");
  }

  createSchedule(job) {
    const payload = job && typeof job === "object" ? job : {};
    const result = this.dashboardBridge("cron_create", payload);
    this.eventBus?.publishSettingsChanged?.({ source: "scheduler", action: "create", job: result });
    publishEvent(this.eventBus, REDOU_EVENTS.TASK_UPDATED, { source: "scheduler", action: "create", job: result });
    return result;
  }

  updateSchedule(idOrSchedule, updates = {}) {
    const id = normalizeScheduleId(idOrSchedule);
    if (!id) throw new Error("cron job id required");
    const payload = {
      ...(idOrSchedule && typeof idOrSchedule === "object" ? idOrSchedule : {}),
      ...(updates && typeof updates === "object" ? updates : {}),
      id,
    };
    const result = this.dashboardBridge("cron_update", payload);
    this.eventBus?.publishSettingsChanged?.({ source: "scheduler", action: "update", id, job: result });
    publishEvent(this.eventBus, REDOU_EVENTS.TASK_UPDATED, { source: "scheduler", action: "update", id, job: result });
    return result;
  }

  pauseSchedule(idOrSchedule) {
    const id = normalizeScheduleId(idOrSchedule);
    const result = this.dashboardBridge("cron_pause", { id });
    this.eventBus?.publishSettingsChanged?.({ source: "scheduler", action: "pause", id });
    publishEvent(this.eventBus, REDOU_EVENTS.TASK_UPDATED, { source: "scheduler", action: "pause", id });
    return result;
  }

  resumeSchedule(idOrSchedule) {
    const id = normalizeScheduleId(idOrSchedule);
    const result = this.dashboardBridge("cron_resume", { id });
    this.eventBus?.publishSettingsChanged?.({ source: "scheduler", action: "resume", id });
    publishEvent(this.eventBus, REDOU_EVENTS.TASK_UPDATED, { source: "scheduler", action: "resume", id });
    return result;
  }

  deleteSchedule(idOrSchedule) {
    const id = normalizeScheduleId(idOrSchedule);
    const result = this.dashboardBridge("cron_delete", { id });
    this.eventBus?.publishSettingsChanged?.({ source: "scheduler", action: "delete", id });
    publishEvent(this.eventBus, REDOU_EVENTS.TASK_UPDATED, { source: "scheduler", action: "delete", id });
    return result;
  }

  runNow(idOrSchedule) {
    const id = normalizeScheduleId(idOrSchedule);
    const result = this.dashboardBridge("cron_trigger", { id });
    if (typeof this.eventBus?.publishScheduleTriggered === "function") {
      this.eventBus.publishScheduleTriggered({ id, result });
    } else {
      publishEvent(this.eventBus, REDOU_EVENTS.SCHEDULE_TRIGGERED, { id, result });
    }
    return result;
  }

  isDue(schedule, now = new Date()) {
    return isScheduleDue(schedule, now);
  }

  async scanDueSchedules(now = new Date()) {
    if (this.scanning) return { ok: true, skipped: true, triggered: [] };
    this.scanning = true;
    try {
      const schedules = this.normalizeListResult(await Promise.resolve(this.listSchedules()));
      const due = schedules.filter((schedule) => this.isDue(schedule, now));
      const triggered = [];
      for (const schedule of due) {
        const id = normalizeScheduleId(schedule);
        if (!id) continue;
        triggered.push({ id, result: await Promise.resolve(this.runNow(id)) });
      }
      return { ok: true, triggered };
    } finally {
      this.scanning = false;
    }
  }

  // Backward-compatible aliases used by RedouLocalService's existing cron API.
  list() {
    return this.listSchedules();
  }

  create(job) {
    return this.createSchedule(job);
  }

  update(idOrSchedule, updates = {}) {
    return this.updateSchedule(idOrSchedule, updates);
  }

  pause(idOrSchedule) {
    return this.pauseSchedule(idOrSchedule);
  }

  resume(idOrSchedule) {
    return this.resumeSchedule(idOrSchedule);
  }

  trigger(idOrSchedule) {
    return this.runNow(idOrSchedule);
  }

  delete(idOrSchedule) {
    return this.deleteSchedule(idOrSchedule);
  }
}

module.exports = {
  SchedulerService,
};
