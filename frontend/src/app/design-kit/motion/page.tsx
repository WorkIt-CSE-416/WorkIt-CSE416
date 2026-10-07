import { ANIMATIONS, EASINGS, SECTIONS, VIEW_TRANSITIONS } from "../data";
import { TokenValue } from "../palette";
import { Group, KitPage, Row } from "../specimen";
import { AnimationDemo, CountDemo, EasingDemo, ReflowDemo, StepDemo } from "./demos";

export const metadata = { title: SECTIONS.motion.title };

/**
 * Motion: the curves, the animations built on them, the view-transition
 * classes and the one component that moves a value. The rules for which to
 * reach for are frontend/CLAUDE.md's "Motion"; this page shows each one
 * moving. The sidebar's gliding highlight and the segmented control's thumb
 * are their own specimens, in the shells and under Form Controls.
 */
export default function MotionPage() {
  return (
    <KitPage {...SECTIONS.motion}>
      <Group title="Curves">
        {EASINGS.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <EasingDemo cls={cls} />
            <TokenValue token={token} />
          </Row>
        ))}
      </Group>

      <Group
        title="Animations"
        note="Each runs once as its element appears. A list staggers them with an animation-delay per item, capped so a long list never keeps its last items waiting."
      >
        {ANIMATIONS.map(({ token, cls, demo, role }) => (
          <Row key={token} name={token} role={role}>
            <AnimationDemo cls={cls} demo={demo} />
          </Row>
        ))}
      </Group>

      <Group
        title="View Transitions"
        note="Classes React's <ViewTransition> names and globals.css draws. Pages and views change through them on navigation; the two specimens run theirs in a transition, the way a navigation does."
      >
        {VIEW_TRANSITIONS.map(({ name, role }) => (
          <Row key={name} name={name} role={role}>
            {name.startsWith("step") ? (
              <StepDemo />
            ) : name === "reflow" ? (
              <ReflowDemo />
            ) : (
              <span className="text-note text-ink-meta">Seen on navigation</span>
            )}
          </Row>
        ))}
      </Group>

      <Group title="Components">
        <Row
          name="<AnimatedNumber>"
          role="A figure counting to its new value: both Dashboards' headline numbers, Activity's total"
        >
          <CountDemo />
        </Row>
      </Group>
    </KitPage>
  );
}
