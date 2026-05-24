const { EventEmitter } = require("events");

const REDOU_EVENTS = Object.freeze({
  TASK_STARTED: "task:started",
  TASK_UPDATED: "task:updated",
  TASK_COMPLETED: "task:completed",
  TASK_FAILED: "task:failed",
  LOG_APPENDED: "log:appended",
  SCHEDULE_TRIGGERED: "schedule:triggered",
  ARTIFACT_CREATED: "artifact:created",
  SETTINGS_CHANGED: "settings:changed",
  RUN_STOPPED: "run:stopped",
});

function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  const publish = (eventName, payload = {}) => emitter.emit(eventName, payload);
  const publishTyped = (eventName) => (payload = {}) => publish(eventName, payload);

  return {
    on: (...args) => emitter.on(...args),
    once: (...args) => emitter.once(...args),
    off: (...args) => emitter.off(...args),
    emit: publish,
    publish,
    listenerCount: (...args) => emitter.listenerCount(...args),
    sendToRenderer(webContents, payload, channel = "redou:agent-event") {
      if (!webContents || webContents.isDestroyed()) return false;
      webContents.send(channel, payload);
      return true;
    },
    publishTaskStarted: publishTyped(REDOU_EVENTS.TASK_STARTED),
    publishTaskUpdated: publishTyped(REDOU_EVENTS.TASK_UPDATED),
    publishTaskCompleted: publishTyped(REDOU_EVENTS.TASK_COMPLETED),
    publishTaskFailed: publishTyped(REDOU_EVENTS.TASK_FAILED),
    publishLogAppended: publishTyped(REDOU_EVENTS.LOG_APPENDED),
    publishScheduleTriggered: publishTyped(REDOU_EVENTS.SCHEDULE_TRIGGERED),
    publishArtifactCreated: publishTyped(REDOU_EVENTS.ARTIFACT_CREATED),
    publishSettingsChanged: publishTyped(REDOU_EVENTS.SETTINGS_CHANGED),
    publishRunStopped: publishTyped(REDOU_EVENTS.RUN_STOPPED),
    publishPersistedTaskEvent({ projectId, taskId, event }) {
      const payload = { projectId, taskId, event };
      publish(REDOU_EVENTS.LOG_APPENDED, payload);
      if (event?.type === "done") {
        publish(REDOU_EVENTS.TASK_COMPLETED, payload);
      } else {
        if (event?.type === "error") {
          publish(REDOU_EVENTS.TASK_FAILED, payload);
        }
        if (event?.type === "file_changed" || event?.type === "artifact_created") {
          publish(REDOU_EVENTS.ARTIFACT_CREATED, payload);
        }
        publish(REDOU_EVENTS.TASK_UPDATED, payload);
      }
    },
  };
}

module.exports = {
  REDOU_EVENTS,
  createEventBus,
};
