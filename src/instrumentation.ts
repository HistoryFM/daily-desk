export async function register() {
  // The desk runs its own scheduler inside the server process (catches up after sleep).
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DESK_SCHEDULER !== "0") {
    const { registerJobs, startScheduler } = await import("./lib/scheduler");
    const { JOBS } = await import("./lib/jobs");
    registerJobs(JOBS);
    startScheduler();
  }
}
