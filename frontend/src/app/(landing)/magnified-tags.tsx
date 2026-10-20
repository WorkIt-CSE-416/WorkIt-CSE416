"use client";
import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  MotionConfig,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { cn } from "@/lib/cn";

export interface MagnifiedTag {
  id: string;
  icon: LucideIcon;
  label: string;
}

interface MagnifiedTagsProps {
  /** Rows of tags that scroll past in alternating directions. */
  rows: MagnifiedTag[][];
  lensSize?: number;
  className?: string;
}

/**
 * Scrolling rows of tags with a magnifying lens that reveals an enlarged,
 * highlighted copy of the tags beneath it. With a mouse or trackpad the lens
 * becomes the cursor over the tags; on touch screens (no hover) it can be
 * dragged instead. Adapted from a bento card: this is just the visual, sized
 * by its container (give it a height). Motion drives the rows and the lens,
 * so it needs to render inside a hydrated island.
 */

// The lens glass sits 10px up-left of the SVG's center; offset by this much
// so the glass, not the handle, is under the pointer.
const GLASS_OFFSET = 10;
// Radius of the lens glass (matches the MagnifyingLens SVG at its default size).
const GLASS_RADIUS = 30;
// How much the lens magnifies what's under it.
const ZOOM = 1.5;
const MagnifiedTags = ({ rows, lensSize = 92, className }: MagnifiedTagsProps) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const lensX = useMotionValue(0);
  const lensY = useMotionValue(0);
  const reduceMotion = useReducedMotion();

  // True on devices with a real hover pointer (mouse/trackpad). Decided after
  // mount, so the server render and first paint match.
  const [followCursor, setFollowCursor] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setFollowCursor(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!followCursor || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    // jump() also cancels a return-to-center animation that's still running.
    lensX.jump(event.clientX - rect.left - rect.width / 2 + GLASS_OFFSET);
    lensY.jump(event.clientY - rect.top - rect.height / 2 + GLASS_OFFSET);
  };

  const handlePointerLeave = () => {
    if (!followCursor) return;
    if (reduceMotion) {
      lensX.jump(0);
      lensY.jump(0);
      return;
    }
    const spring = { type: "spring", stiffness: 300, damping: 30 } as const;
    animate(lensX, 0, spring);
    animate(lensY, 0, spring);
  };

  // Center of the lens glass, in the tag area's coordinates.
  const lensCenter = useMotionTemplate`calc(50% + ${lensX}px - ${GLASS_OFFSET}px) calc(50% + ${lensY}px - ${GLASS_OFFSET}px)`;
  const clipPath = useMotionTemplate`circle(${GLASS_RADIUS}px at ${lensCenter})`;
  const inverseMask = useMotionTemplate`radial-gradient(circle ${GLASS_RADIUS}px at ${lensCenter}, transparent 100%, black 100%)`;

  const rowMotion = (rowIndex: number) => ({
    animate: { x: rowIndex % 2 === 0 ? ["0%", "-33.333%"] : ["-33.333%", "0%"] },
    transition: { duration: 25, ease: "linear" as const, repeat: Infinity },
  });

  return (
    // reducedMotion="user": the rows stay still for visitors who prefer reduced motion.
    <MotionConfig reducedMotion="user">
      {/* Decorative visual: the tags repeat, so it's hidden from assistive tech. */}
      <div
        ref={containerRef}
        aria-hidden="true"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className={cn(
          "relative w-full overflow-hidden",
          // The lens is the cursor here, so hide the system one.
          followCursor && "cursor-none",
          className,
        )}
      >
        {/* Fade the rows out at both edges (a mask, so it works over glass). */}
        <div className="absolute inset-0 [mask-image:linear-gradient(to_right,transparent,black_22%,black_78%,transparent)]">
          {/* base layer */}
          <motion.div
            style={{ WebkitMaskImage: inverseMask, maskImage: inverseMask }}
            className="flex h-full w-full flex-col justify-center gap-4"
          >
            {rows.map((row, rowIndex) => (
              <motion.div
                key={`row-${rowIndex}`}
                className="flex w-max gap-4"
                {...rowMotion(rowIndex)}
              >
                {[...row, ...row, ...row].map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={`${item.id}-${idx}`}
                      className="border-border/60 text-muted-foreground flex w-fit items-center gap-2 rounded-full border bg-white/60 p-2 px-3 text-xs whitespace-nowrap"
                    >
                      <Icon size={14} />
                      <span>{item.label}</span>
                    </div>
                  );
                })}
              </motion.div>
            ))}
          </motion.div>

          {/* reveal layer: the same rows, magnified around the lens center and
                clipped to the glass. The clip sits on the outer (unscaled) layer so the
                visible circle stays the lens size. Chips must keep the same box metrics as
                the base layer (padding, border, font) so positions line up exactly. */}
          <motion.div
            className="pointer-events-none absolute inset-0 z-10 select-none"
            style={{ clipPath }}
          >
            <motion.div
              className="flex h-full w-full flex-col justify-center gap-4"
              style={{ scale: ZOOM, transformOrigin: lensCenter }}
            >
              {rows.map((row, rowIndex) => (
                <motion.div
                  key={`row-reveal-${rowIndex}`}
                  className="flex w-max gap-4"
                  {...rowMotion(rowIndex)}
                >
                  {[...row, ...row, ...row].map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={`${item.id}-${idx}-reveal`}
                        className="border-landing-brand-300 text-landing-brand-900 flex w-fit items-center gap-2 rounded-full border p-2 px-3 text-xs whitespace-nowrap [box-shadow:var(--brand-glass-edge)] [background:var(--brand-glass-fill)]"
                      >
                        <Icon size={14} className="text-landing-brand-700" />
                        <span>{item.label}</span>
                      </div>
                    );
                  })}
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </div>

        {/* lens: follows the cursor (mouse/trackpad) or is dragged (touch) */}
        <motion.div
          className={cn(
            "absolute top-1/2 left-1/2 z-40 -translate-x-1/2 -translate-y-1/2 drop-shadow-xl",
            followCursor ? "pointer-events-none" : "cursor-grab active:cursor-grabbing",
          )}
          drag={!followCursor}
          dragMomentum={false}
          dragConstraints={containerRef}
          style={{ x: lensX, y: lensY }}
        >
          <div className="relative">
            <MagnifyingLens size={lensSize} />
            <div className="pointer-events-none absolute top-[6px] left-[6px] h-[60px] w-[60px] rounded-full bg-white/10" />
          </div>
        </motion.div>
      </div>
    </MotionConfig>
  );
};

export default MagnifiedTags;

const MagnifyingLens = ({ size = 92 }: { size?: number }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M365.424 335.392L342.24 312.192L311.68 342.736L334.88 365.936L365.424 335.392Z"
        fill="#B0BDC6"
      />
      <path
        d="M358.08 342.736L334.88 319.552L319.04 335.392L342.24 358.584L358.08 342.736Z"
        fill="#DFE9EF"
      />
      <path
        d="M352.368 321.808L342.752 312.192L312.208 342.752L321.824 352.36L352.368 321.808Z"
        fill="#B0BDC6"
      />
      <path
        d="M332 332C260 404 142.4 404 69.6001 332C-2.3999 260 -2.3999 142.4 69.6001 69.6C141.6 -3.20003 259.2 -2.40002 332 69.6C404.8 142.4 404.8 260 332 332ZM315.2 87.2C252 24 150.4 24 88.0001 87.2C24.8001 150.4 24.8001 252 88.0001 314.4C151.2 377.6 252.8 377.6 315.2 314.4C377.6 252 377.6 150.4 315.2 87.2Z"
        fill="#DFE9EF"
      />
      <path
        d="M319.2 319.2C254.4 384 148.8 384 83.2001 319.2C18.4001 254.4 18.4001 148.8 83.2001 83.2C148 18.4 253.6 18.4 319.2 83.2C384 148.8 384 254.4 319.2 319.2ZM310.4 92C250.4 32 152 32 92.0001 92C32.0001 152 32.0001 250.4 92.0001 310.4C152 370.4 250.4 370.4 310.4 310.4C370.4 250.4 370.4 152 310.4 92Z"
        fill="#7A858C"
      />
      <path
        d="M484.104 428.784L373.8 318.472L318.36 373.912L428.672 484.216L484.104 428.784Z"
        fill="#333333"
      />
      <path
        d="M471.664 441.224L361.344 330.928L330.8 361.48L441.12 471.76L471.664 441.224Z"
        fill="#575B5E"
      />
      <path
        d="M495.2 423.2C504 432 432.8 504 423.2 495.2L417.6 489.6C408.8 480.8 480 408.8 489.6 417.6L495.2 423.2Z"
        fill="#B0BDC6"
      />
      <path
        d="M483.2 435.2C492 444 444.8 492 435.2 483.2L429.6 477.6C420.8 468.8 468 420.8 477.6 429.6L483.2 435.2Z"
        fill="#DFE9EF"
      />
    </svg>
  );
};
