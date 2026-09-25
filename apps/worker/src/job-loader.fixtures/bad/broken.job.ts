// A file that exports something named `job` with the wrong shape — no
// `queue` string, `handle` is not a function. `loadJobs` must throw loudly
// on this rather than silently registering nothing.
export const job = { queue: "", handle: "not a function" };
