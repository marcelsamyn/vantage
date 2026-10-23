import { groupSky } from "./GroupSky";

/** Every Starlink satellite above you. Thousands of them, so this layer updates every 5 s. */
export default groupSky("starlink", 5000);
