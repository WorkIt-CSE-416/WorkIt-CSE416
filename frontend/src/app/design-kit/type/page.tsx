import { LightningRoundedIcon } from "@/components/custom-icons";
import {
  BellIcon,
  BookmarkIcon,
  GearIcon,
  RoleIcon,
  SearchIcon,
  SignOutIcon,
  SparkleIcon,
} from "@/components/icons";

import { SECTIONS, SHADCN_SIZES, TYPE_SCALE, TYPEFACES, WEIGHTS } from "../data";
import { Group, KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.type.title };

export default function TypePage() {
  return (
    <KitPage {...SECTIONS.type}>
      <Group title="Typefaces">
        {TYPEFACES.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <span className={`${cls} text-body text-ink`}>Software Engineer, New Grad</span>
          </Row>
        ))}
      </Group>

      <Group title="Scale">
        {TYPE_SCALE.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <span className={`${cls} text-ink`}>Software Engineer, New Grad</span>
          </Row>
        ))}
      </Group>

      <Group
        title="Weights"
        note="Each weight has one job. A size whose token carries no weight (body, note) takes the one its job asks for, so a menu row at --text-body is still medium."
      >
        {WEIGHTS.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <span className={`${cls} text-body text-ink`}>Software Engineer, New Grad</span>
          </Row>
        ))}
      </Group>

      <Group
        title="Icons"
        note="Phosphor at its regular weight, thickened by one rule in globals.css to about a 2px line at size-4, so a glyph weighs what medium text beside it weighs (KAN-365). Glyphs Phosphor lacks are drawn in custom-icons.tsx at the same line. A chosen state takes weight='fill'."
      >
        <Row name="Phosphor, regular" role="Every glyph, through components/icons.tsx">
          <span className="text-body text-ink flex items-center gap-4 font-medium">
            <span className="flex items-center gap-1.5">
              <GearIcon className="text-ink-meta size-4" /> Settings
            </span>
            <span className="flex items-center gap-1.5">
              <SignOutIcon className="text-ink-meta size-4" /> Sign Out
            </span>
            <SearchIcon className="size-4" />
            <BellIcon className="size-4" />
          </span>
        </Row>
        <Row name="Phosphor, fill" role="A chosen state: a saved job's bookmark">
          <span className="text-ink flex items-center gap-4">
            <BookmarkIcon className="size-4" />
            <BookmarkIcon filled className="text-brand size-4" />
          </span>
        </Row>
        <Row
          name="Custom"
          role="custom-icons.tsx: the Role filter's person in a tie, Auto Apply's bolt"
        >
          <span className="text-body text-ink flex items-center gap-4 font-medium">
            <span className="flex items-center gap-1.5">
              <RoleIcon className="text-ink-meta size-4" /> Role
            </span>
            <span className="flex items-center gap-1.5">
              <LightningRoundedIcon aria-hidden className="text-ink-meta size-4" /> Auto Apply
            </span>
          </span>
        </Row>
        <Row name="SparkleIcon" role="Scout and AI only (KAN-257)">
          <SparkleIcon className="text-brand size-4" />
        </Row>
      </Group>

      <Group
        title="shadcn Sizes"
        note="What a vendored component's stock size resolves to. Bound in globals.css rather than restyled per component, the same way its colour roles are, so a menu row moves with --text-body. Its rows are medium, set there too by data-slot. A vendored title is 16px medium, a pairing the scale has no token for, so each call site passes text-subtitle font-semibold, the size and weight of an empty state's heading."
      >
        {SHADCN_SIZES.map(({ token, cls, role }) => (
          <Row key={token} name={token} role={role}>
            <span className={`${cls} text-ink`}>Software Engineer, New Grad</span>
          </Row>
        ))}
      </Group>
    </KitPage>
  );
}
