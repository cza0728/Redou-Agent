const { installRuntimeCoreMethods } = require("./coreMethods.cjs");
const { installRuntimeDelegateMethods } = require("./delegateMethods.cjs");

function installRuntimeMethods(target) {
  installRuntimeCoreMethods(target);
  installRuntimeDelegateMethods(target);
}

module.exports = { installRuntimeMethods };
