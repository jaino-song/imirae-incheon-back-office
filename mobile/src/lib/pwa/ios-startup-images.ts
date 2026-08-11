export const IOS_PWA_SPLASH_VERSION = "20260812-logo-v2";

interface IOSStartupImage {
  media: string;
  rel: "apple-touch-startup-image";
  url: string;
}

const startupImage = (filename: string, media: string): IOSStartupImage => ({
  media,
  rel: "apple-touch-startup-image",
  url: `/splash/${filename}?v=${IOS_PWA_SPLASH_VERSION}`,
});

export const IOS_STARTUP_IMAGES: ReadonlyArray<IOSStartupImage> = [
  startupImage(
    "splash-640x1136.png",
    "(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)",
  ),
  startupImage(
    "splash-750x1334.png",
    "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)",
  ),
  startupImage(
    "splash-1242x2208.png",
    "(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-1125x2436.png",
    "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-828x1792.png",
    "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)",
  ),
  startupImage(
    "splash-1242x2688.png",
    "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-1080x2340.png",
    "(device-width: 360px) and (device-height: 780px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-1170x2532.png",
    "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-1284x2778.png",
    "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-1179x2556.png",
    "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-1290x2796.png",
    "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-1206x2622.png",
    "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-1320x2868.png",
    "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)",
  ),
  startupImage(
    "splash-1536x2048.png",
    "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)",
  ),
  startupImage(
    "splash-1668x2224.png",
    "(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2)",
  ),
  startupImage(
    "splash-1668x2388.png",
    "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)",
  ),
  startupImage(
    "splash-2048x2732.png",
    "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)",
  ),
];
