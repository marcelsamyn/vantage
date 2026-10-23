import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import { useSettings, type Units } from "../../app/core/settings";
import { Tag } from "../../app/ui";
import { usePlaceFact } from "./client";
import { FactState, Meta } from "./FactSection";
import type { TreeRecord } from "./types";

const MAX_GROUPS = 5;

function measurements(t: TreeRecord, units: Units): string[] {
  return [
    t.plantedYear ? `planted ${t.plantedYear}` : null,
    t.heightM ? `${fmt.distance(t.heightM, units)} tall` : t.heightClass ? `${t.heightClass} tall` : null,
    t.girthCm ? `${fmt.int(t.girthCm)} cm round` : t.girthClass ? `${t.girthClass} round` : null,
    t.crownM ? `crown ${fmt.distance(t.crownM, units)}` : null,
  ].filter((part): part is string => part !== null);
}

interface Group {
  tree: TreeRecord;
  count: number;
}

/** A kerb often holds a row of one species planted together; trees alike in every detail share a line, led by the nearest. */
function grouped(trees: readonly TreeRecord[]): Group[] {
  const groups = new Map<string, Group>();
  for (const tree of trees) {
    const key = [tree.species, tree.plantedYear, tree.heightM, tree.heightClass, tree.girthCm, tree.girthClass, tree.crownM, tree.remarkable].join("|");
    const hit = groups.get(key);
    if (hit) hit.count++;
    else groups.set(key, { tree, count: 1 });
  }
  return [...groups.values()];
}

/** The nearest registered street trees, from the city registers of Brussels, Ghent, Paris and Bologna. */
export default function TreesFact({ entity }: ProfilerSectionProps<"place">): ReactElement | null {
  const units = useSettings((s) => s.units);
  const poll = usePlaceFact("trees", entity.data);
  return (
    <FactState poll={poll} title="Trees here" source={(t) => t.source}>
      {(data) =>
        data.trees.length === 0 ? null : (
          <ul className="dossier-list">
            {grouped(data.trees)
              .slice(0, MAX_GROUPS)
              .map(({ tree: t, count }) => {
                const name = t.commonName ?? t.species;
                const latin = t.commonName && t.commonName !== t.species ? t.species : null;
                return (
                  <li key={t.id} className="dossier-item">
                    <div className="dossier-item__title">
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noreferrer">
                          {name} <ExternalLink size={11} aria-label="Register page" />
                        </a>
                      ) : (
                        name
                      )}
                      {t.remarkable && <Tag tone="mint">Remarkable</Tag>}
                    </div>
                    <Meta parts={[count > 1 ? `${count} trees` : null, latin, ...measurements(t, units), t.distanceM === 0 ? "here" : `${count > 1 ? "nearest " : ""}${fmt.distance(t.distanceM, units)}`]} />
                  </li>
                );
              })}
          </ul>
        )
      }
    </FactState>
  );
}
