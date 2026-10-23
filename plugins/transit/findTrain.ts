import { errorMessage } from "../../app/core/api";
import { feed } from "../../app/core/feed";
import { profile } from "../../app/core/profile";
import { findTrains, trainEntityId } from "./client";
import type { TrainMatch } from "./types";

const open = (m: TrainMatch): void => profile.open({ kind: "train", id: trainEntityId(m.ref), data: m.ref });

/**
 * The "Where is train …" command: look the number up in Italy and Belgium and open the train's profile.
 * If both countries have such a train, the Belgian one opens when the text names a type ("IC 1832"), and the other goes to the feed.
 */
export async function findTrain(text: string): Promise<void> {
  const typed = text.trim();
  if (!typed) return;
  let matches: TrainMatch[];
  try {
    matches = await findTrains(typed);
  } catch (err) {
    feed({ level: "alert", source: "transit", title: `Could not look up train ${typed}`, detail: errorMessage(err) }, { toast: true });
    return;
  }
  const [first, second] = matches;
  if (!first) {
    const hint = /^\d+$/.test(typed) ? "No Italian train has that number today. For a Belgian train, add its type, for example IC 1832." : "No Belgian train has that name today. Check the type and number, for example IC 1832, or S8 6594.";
    feed({ level: "info", source: "transit", title: `No train found for "${typed}"`, detail: hint }, { toast: true });
    return;
  }
  open(first);
  if (second) feed({ level: "info", source: "transit", title: `A second train matches ${typed}`, detail: `${second.label}: ${second.route}`, entity: { kind: "train", id: trainEntityId(second.ref), data: second.ref } }, { toast: true });
}
