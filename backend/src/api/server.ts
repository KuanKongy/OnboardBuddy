import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`OnboardBuddy API listening on http://localhost:${port}`);
});
