import { writeFileSync } from "node:fs";

const page = await fetch(`http://127.0.0.1:9223/json/new?${encodeURIComponent("http://127.0.0.1:4173/")}`, { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!pending.has(message.id)) return;
  pending.get(message.id)(message.result);
  pending.delete(message.id);
});
const command = (method, params = {}) => new Promise((resolve) => {
  const requestId = ++id;
  pending.set(requestId, resolve);
  socket.send(JSON.stringify({ id: requestId, method, params }));
});

await command("Runtime.enable");
await command("Page.enable");
await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await new Promise((resolve) => setTimeout(resolve, 650));
await command("Runtime.evaluate", { expression: "document.querySelector('#start-training').click()" });
await new Promise((resolve) => setTimeout(resolve, 300));
await command("Runtime.evaluate", { expression: "document.querySelector('#toggle-options')?.click()" });
await new Promise((resolve) => setTimeout(resolve, 200));
const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
writeFileSync("tests/mobile-quiz.png", Buffer.from(screenshot.data, "base64"));
socket.close();
