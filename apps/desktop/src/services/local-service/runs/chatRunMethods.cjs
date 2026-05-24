const { installQueueMethods } = require("./queueMethods.cjs");
const { installRunEventMethods } = require("./eventMethods.cjs");
const { installHermesRunMethods } = require("./hermesRunMethods.cjs");
const { installMessageMethods } = require("./messageMethods.cjs");

function installChatRunMethods(target) {
  installQueueMethods(target);
  installRunEventMethods(target);
  installHermesRunMethods(target);
  installMessageMethods(target);
}

module.exports = { installChatRunMethods };
