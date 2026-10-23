import { useEffect, useState } from "react";

/**
 * `value`, but only after it has stopped changing for `ms`. A map zooms in many small steps, and a layer that fetched
 * at every step would ask a volunteer-run service for areas nobody stops to look at.
 */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
