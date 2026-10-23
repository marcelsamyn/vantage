/** Transitous trip ids start with the service day and the first departure: "20261011_10:10_be-delijn_…". */
export const isTransitousTrip = (tripId: string): boolean => /^\d{8}_\d{2}:\d{2}_/.test(tripId);
