const { installAnalysisStateMethods } = require("./analysisStateMethods.cjs");
const { installAnalysisWorkspaceMethods } = require("./analysisWorkspaceMethods.cjs");
const { installAnalysisExecutionMethods } = require("./analysisExecutionMethods.cjs");

function installAnalysisMethods(target) {
  installAnalysisStateMethods(target);
  installAnalysisWorkspaceMethods(target);
  installAnalysisExecutionMethods(target);
}

module.exports = { installAnalysisMethods };
