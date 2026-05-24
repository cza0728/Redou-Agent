const { eventContent } = require("../context/contextUtils.cjs");

class RunEventMethods {
  emitToRenderer(webContents, payload) {
    this.eventBus.sendToRenderer(webContents, payload);
  }

  persistEvent(projectId, taskId, event) {
    if (event.type === "assistant_delta") return;
    const role = event.type === "assistant_message" ? "assistant" : "event";
    this.appendTaskMessage(projectId, taskId, role, eventContent(event), {
      event,
      eventType: event.type,
    });
    this.eventBus.publishPersistedTaskEvent({ projectId, taskId, event });
  }

}

function installRunEventMethods(target) {
  for (const name of Object.getOwnPropertyNames(RunEventMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(RunEventMethods.prototype, name));
  }
}

module.exports = { installRunEventMethods };
