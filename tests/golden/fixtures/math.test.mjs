import { add, mul } from "./math.js";
const ok = (c) => { if (!c) { console.error("FAIL"); process.exit(1); } };
ok(add(2, 3) === 5);
ok(mul(4, 5) === 20);
console.log("ALL OK");
