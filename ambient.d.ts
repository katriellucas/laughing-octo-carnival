import type { Geolocation } from "fastly:geolocation";

declare global {
  namespace App {
    interface Platform {
      env: (key: string) => string;
      geo: Geolocation | null;
      waitUntil: (promise: Promise<unknown>) => void;
    }
  }
}
