import type { Icon, IconProps, IconWeight } from "@phosphor-icons/react";
import { forwardRef, useId, type ReactNode } from "react";

/**
 * Glyphs Phosphor does not have, drawn for WorkIt (KAN-350).
 *
 * Each one is a drop-in Phosphor icon: it takes Phosphor's props (`weight`,
 * `size`, `color`, `mirrored`, `alt`) and types as its `Icon`, so a list of
 * icons can mix these with Phosphor's own. They keep Lucide's rounded 24-unit
 * drawings, the ones the app wore before the switch, at Phosphor's stroke:
 * 16 on its 256 grid is 1.5 here, and thin, light and bold scale the same way
 * (8, 12 and 24). Duotone fills the body at 20% under the strokes, as
 * Phosphor's do; fill paints the body solid and cuts the inner details out of
 * it, with a gap round any detail that sits outside the body.
 *
 * Draw a new one here only when Phosphor has nothing close. A glyph used by
 * more than one route still gets its wrapper in ./icons.tsx.
 */

type Glyph = {
  /** The outline every stroked weight draws. */
  outline: ReactNode;
  /** Details inside the body: stroked, and cut out of the fill weight. */
  holes?: ReactNode;
  /** Details outside the body: stroked, with a gap cut round them in fill. */
  marks?: ReactNode;
  /** The area duotone tints at 20%. */
  tint: ReactNode;
  /** The shape the fill weight paints solid. */
  body: ReactNode;
  /** Painted solid in fill on top of the gaps, such as a clipboard's clip. */
  bodyExtra?: ReactNode;
};

const STROKE: Record<Exclude<IconWeight, "fill" | "duotone">, number> = {
  thin: 0.75,
  light: 1.125,
  regular: 1.5,
  bold: 2.25,
};

function customIcon(name: string, glyph: Glyph): Icon {
  const CustomIcon = forwardRef<SVGSVGElement, IconProps>(function CustomIcon(
    {
      alt,
      color = "currentColor",
      size = "1em",
      weight = "regular",
      mirrored = false,
      children,
      ...rest
    },
    ref,
  ) {
    // The fill weight's mask needs an id unique on the page.
    const mask = `${name}-${useId().replace(/[^\w-]/g, "")}`;
    const strokes = (
      <>
        {glyph.outline}
        {glyph.holes}
        {glyph.marks}
      </>
    );
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={weight === "fill" || weight === "duotone" ? 1.5 : STROKE[weight]}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={mirrored ? "scale(-1, 1)" : undefined}
        {...rest}
      >
        {alt ? <title>{alt}</title> : null}
        {children}
        {weight === "fill" ? (
          <>
            <defs>
              <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                <rect width="24" height="24" fill="#fff" stroke="none" />
                <g fill="none" stroke="#000">
                  <g strokeWidth={1.5}>{glyph.holes}</g>
                  <g strokeWidth={4.5}>{glyph.marks}</g>
                </g>
              </mask>
            </defs>
            <g mask={`url(#${mask})`} fill={color}>
              {glyph.body}
            </g>
            {glyph.marks}
            <g fill={color}>{glyph.bodyExtra}</g>
          </>
        ) : weight === "duotone" ? (
          <>
            <g fill={color} stroke="none" opacity={0.2}>
              {glyph.tint}
            </g>
            {strokes}
          </>
        ) : (
          strokes
        )}
      </svg>
    );
  });
  CustomIcon.displayName = `${name}Icon`;
  return CustomIcon;
}

const BOLT =
  "M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z";

/** Auto Apply's mark: Phosphor's Lightning has sharp tips, and this bolt keeps
 *  the rounded corners the mark has always had. */
export const LightningRoundedIcon = customIcon("LightningRounded", {
  outline: <path d={BOLT} />,
  tint: <path d={BOLT} />,
  body: <path d={BOLT} />,
});

/** Scan corners round a magnifying glass: Phosphor's Scan has no magnifier. */
export const ScanMagnifyingGlassIcon = customIcon("ScanMagnifyingGlass", {
  outline: (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    </>
  ),
  holes: (
    <>
      <circle cx="11.25" cy="11.25" r="3.5" />
      <path d="m16 16-2.25-2.25" />
    </>
  ),
  tint: <circle cx="11.25" cy="11.25" r="3.5" />,
  body: <rect x="3" y="3" width="18" height="18" rx="3" />,
});

/** A page with its corner folded and a check at its foot: Phosphor has no
 *  file with a check. */
export const FileCheckIcon = customIcon("FileCheck", {
  outline: (
    <path d="M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6" />
  ),
  holes: <path d="M14 2v5a1 1 0 0 0 1 1h5" />,
  marks: <path d="m14 20 2 2 4-4" />,
  tint: <path d="M14 2v5a1 1 0 0 0 1 1h5z" />,
  body: (
    <path d="M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6z" />
  ),
});

const BUBBLE =
  "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z";

/** A square chat bubble with a plus inside: Phosphor has no chat with a plus. */
export const ChatPlusIcon = customIcon("ChatPlus", {
  outline: <path d={BUBBLE} />,
  holes: (
    <>
      <path d="M12 8v6" />
      <path d="M9 11h6" />
    </>
  ),
  tint: <path d={BUBBLE} />,
  body: <path d={BUBBLE} />,
});

const BOARD = "M6 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z";
const CLIP = <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />;

/** A clipboard with a check: Phosphor's clipboard has lines of text instead. */
export const ClipboardCheckIcon = customIcon("ClipboardCheck", {
  outline: <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />,
  holes: <path d="m9 14 2 2 4-4" />,
  marks: CLIP,
  tint: <path d={BOARD} />,
  body: <path d={BOARD} />,
  bodyExtra: CLIP,
});

/** A folder with a branch, the landing page's Projects section: Phosphor has
 *  no folder with a branch. */
export const FolderGitBranchIcon = customIcon("FolderGitBranch", {
  outline: (
    <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
  ),
  marks: (
    <>
      <path d="M18 19a5 5 0 0 1-5-5v8" />
      <circle cx="13" cy="12" r="2" />
      <circle cx="20" cy="19" r="2" />
    </>
  ),
  tint: (
    <path d="M4 3h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.5l-6.5 3.5L9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
  ),
  body: (
    <path d="M4 3h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
  ),
});

/** A person in a suit and tie, the Role filter's (KAN-252): wide shoulders,
 *  a collar and a knotted tie. Phosphor has no person in a suit. */
export const UserTieIcon = customIcon("UserTie", {
  outline: (
    <>
      <circle cx="12" cy="6" r="3.5" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </>
  ),
  holes: (
    <>
      <path d="m10.5 14 1.5 2 1.5-2" />
      <path d="m12 16-1 3 1 2 1-2z" />
    </>
  ),
  tint: <circle cx="12" cy="6" r="3.5" />,
  body: (
    <>
      <circle cx="12" cy="6" r="3.5" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1z" />
    </>
  ),
});
