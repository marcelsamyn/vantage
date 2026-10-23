import { AnimatePresence } from "motion/react";
import { Suspense, type ReactElement, type ReactNode } from "react";
import { useHotkey } from "../core/hooks";
import { lazyView, profilerFor, profilerSectionsFor, type Entity } from "../core/plugin";
import { ProfilerSectionsContext, useProfile } from "../core/profile";
import { Boundary, PHONE, Sheet, useMediaQuery, type SnapPoint } from "../ui";

/** A profile opens at half height over what it describes, and drags up to read the rest. */
const PROFILE_SNAPS: readonly SnapPoint[] = ["half", "full"];

/**
 * Renders the Profiler for whatever entity is open, using the renderer its plugin contributed, and hands it the
 * sections other plugins contribute for that kind of entity.
 */
export function ProfileSlot(): ReactElement {
  const entity = useProfile((s) => s.entity);
  const close = useProfile((s) => s.close);
  useHotkey(
    (e) => e.key === "Escape" && entity !== null,
    () => close(),
    [entity],
  );

  const phone = useMediaQuery(PHONE);
  const loader = entity ? profilerFor(entity.kind) : undefined;
  const View = loader ? lazyView(loader) : null;

  const card = (
    <AnimatePresence mode="wait">
      {entity && View && (
        <Boundary key={`${entity.kind}:${entity.id}`} name="Profiler">
          <ProfilerSectionsContext.Provider value={sections(entity)}>
            <Suspense fallback={null}>
              <View entity={entity} onClose={close} />
            </Suspense>
          </ProfilerSectionsContext.Provider>
        </Boundary>
      )}
    </AnimatePresence>
  );

  // On a phone the card has no room beside the screen, so it rises from the bottom over it. One sheet stays open
  // while the profile moves from one thing to the next.
  if (phone) {
    return (
      <AnimatePresence>
        {entity && View && (
          <Sheet key="profile" label="Profile" className="profile-sheet" snaps={PROFILE_SNAPS} onClose={close}>
            {card}
          </Sheet>
        )}
      </AnimatePresence>
    );
  }
  return <div className="profile-slot">{card}</div>;
}

/** Each section loads on its own and fails on its own, so one broken register never blanks the profile. */
function sections(entity: Entity): ReactNode {
  const list = profilerSectionsFor(entity.kind);
  if (list.length === 0) return null;
  return list.map((section) => {
    const Section = lazyView(section.view);
    return (
      <Boundary key={section.id} name={section.id}>
        <Suspense fallback={null}>
          <Section entity={entity} />
        </Suspense>
      </Boundary>
    );
  });
}
