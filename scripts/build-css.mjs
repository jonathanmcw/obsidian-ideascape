// styles.css = the map host + the organiser's scoped sheet.
import { readFileSync, writeFileSync } from "node:fs";
const parts = ["src/styles/map-host.css", "src/organiser/styles.css"];
writeFileSync("styles.css", parts.map(p => `/* ==== ${p} ==== */\n` + readFileSync(p, "utf8")).join("\n\n"));
console.log("styles.css ←", parts.join(" + "));
