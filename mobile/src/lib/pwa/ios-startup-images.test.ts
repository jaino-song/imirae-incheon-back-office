import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { IOS_PWA_SPLASH_VERSION, IOS_STARTUP_IMAGES } from "./ios-startup-images";

describe("IOS_STARTUP_IMAGES", () => {
  it("should expose every startup image as a versioned existing asset", () => {
    const serviceWorkerSource = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

    expect(IOS_STARTUP_IMAGES).toHaveLength(17);
    expect(new Set(IOS_STARTUP_IMAGES.map(({ media }) => media)).size).toBe(17);

    IOS_STARTUP_IMAGES.forEach(({ rel, url }) => {
      expect(rel).toBe("apple-touch-startup-image");
      expect(url).toContain(`?v=${IOS_PWA_SPLASH_VERSION}`);

      const publicPath = url.split("?")[0];
      expect(existsSync(resolve(process.cwd(), "public", publicPath.slice(1)))).toBe(true);
      expect(serviceWorkerSource).toContain(`'${url}'`);
    });
  });
});
