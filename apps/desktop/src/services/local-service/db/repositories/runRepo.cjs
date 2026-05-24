class RunRepository {
  constructor({ activeRuns }) {
    this.activeRuns = activeRuns;
  }

  get(runId) {
    return this.activeRuns.get(runId) || null;
  }

  set(runId, run) {
    this.activeRuns.set(runId, run);
    return run;
  }

  delete(runId) {
    return this.activeRuns.delete(runId);
  }

  list() {
    return Array.from(this.activeRuns.entries()).map(([runId, run]) => ({ runId, ...run }));
  }
}

module.exports = {
  RunRepository,
};
