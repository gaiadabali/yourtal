// A file in `src/jobs/` that is NOT a job — no `job` export at all. Proves
// `loadJobs` only registers files that actually export one, rather than
// every `.ts` file in the directory.
export const helperConstant = 42;
