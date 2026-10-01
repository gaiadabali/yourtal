import { runDemoMarketplace } from "../src/seed/demo-world/marketplace.ts";
await runDemoMarketplace({ apiBaseUrl: "http://127.0.0.1:26471", password: "demo-local-only-password-1" }, console.log);
