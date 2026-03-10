import { handler } from "./handler.js";

addEventListener("fetch", (event) => event.respondWith(handler(event)));
