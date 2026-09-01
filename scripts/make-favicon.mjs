// Builds src/app/favicon.ico from public/workit-icon.png.
//
// The mark is dark navy on transparency, which disappears into a dark tab
// strip. So the favicon -- and only the favicon; the top-bar logo still sits
// on our own background -- gets a white disc behind it, the same trick
// Google's "G" uses. Run `npm run favicon` after the logo changes.
//
// Plain Node so it behaves identically in bash, zsh, PowerShell and cmd.exe.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "public", "workit-icon.png");
const output = join(root, "src", "app", "favicon.ico");

/** Frame sizes to pack into the .ico, matching what browsers and Windows ask for. */
const SIZES = [16, 32, 48, 256];

/**
 * Mark width as a fraction of the disc's diameter. A rectangle inscribed in a
 * circle at this aspect ratio tops out near 0.73, and the mark reads as
 * crowded well before that -- 0.82 spills over the edge, 0.76 touches it.
 */
const MARK_RATIO = 0.7;

/**
 * How far to lift the mark above the disc's centre, as a fraction of the
 * diameter. Centred on its bounding box the mark reads bottom-heavy -- its ink
 * clears the disc by 26% of the radius at the top but only 12% at the bottom,
 * because the thin handle stretches the box upward without filling it. Lifting
 * evens that out. Clearance is arithmetically equal around 7%, but by then the
 * handle crowds the top edge and white pools underneath, so trust the eye here.
 */
const MARK_LIFT = 0.05;

/** Supersample factor. Rendering a 16px disc directly gives a ragged edge. */
const SUPERSAMPLE = 4;

/** Trim to the mark's true bounding box so MARK_RATIO measures ink, not padding. */
const { data: mark, info } = await sharp(source)
  .trim({ threshold: 0 })
  .toBuffer({ resolveWithObject: true });

async function frame(size) {
  const big = size * SUPERSAMPLE;
  const width = Math.round(big * MARK_RATIO);
  const height = Math.round((width * info.height) / info.width);

  const glyph = await sharp(mark)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .toBuffer();

  const disc = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${big}" height="${big}">` +
      `<circle cx="${big / 2}" cy="${big / 2}" r="${big / 2}" fill="#ffffff"/></svg>`,
  );

  // sharp resizes before it composites regardless of call order, so shrinking
  // the supersampled canvas has to be a second pass over the finished buffer.
  const composed = await sharp(disc)
    .composite([
      {
        input: glyph,
        left: Math.round((big - width) / 2),
        top: Math.round((big - height) / 2 - big * MARK_LIFT),
      },
    ])
    .png()
    .toBuffer();

  // Two flat colours and their antialiasing blends quantise for free: against
  // truecolor this is a third of the bytes and under 1/255 mean error on every
  // pixel you can actually see.
  return sharp(composed)
    .resize(size, size, { kernel: "lanczos3" })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
}

/**
 * Pack PNG frames into an .ico container: a 6-byte header, one 16-byte
 * directory entry per frame, then the frames themselves. sharp cannot write
 * .ico, and the format is small enough to assemble by hand.
 */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(frames.length, 4);

  const directory = Buffer.alloc(frames.length * 16);
  let offset = header.length + directory.length;

  frames.forEach(({ size, png }, i) => {
    const at = i * 16;
    directory.writeUInt8(size === 256 ? 0 : size, at); // 0 means 256
    directory.writeUInt8(size === 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size, 0 for truecolor
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...frames.map((f) => f.png)]);
}

const frames = [];
for (const size of SIZES) {
  frames.push({ size, png: await frame(size) });
}

const bytes = ico(frames);
writeFileSync(output, bytes);
console.log(`wrote src/app/favicon.ico -- ${SIZES.join(", ")}px, ${bytes.length} bytes`);
