import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun } from "lucide-react";
import type { ReactElement } from "react";
import type { Condition } from "./client";

export function WeatherGlyph({ condition, isDay, size = 20 }: { condition: Condition; isDay: boolean; size?: number }): ReactElement {
  const props = { size, strokeWidth: 1.5 };
  switch (condition) {
    case "clear":
      return isDay ? <Sun {...props} /> : <Moon {...props} />;
    case "partly":
      return isDay ? <CloudSun {...props} /> : <CloudMoon {...props} />;
    case "cloudy":
      return <Cloud {...props} />;
    case "fog":
      return <CloudFog {...props} />;
    case "drizzle":
      return <CloudDrizzle {...props} />;
    case "rain":
    case "showers":
      return <CloudRain {...props} />;
    case "snow":
      return <CloudSnow {...props} />;
    case "storm":
      return <CloudLightning {...props} />;
  }
}
