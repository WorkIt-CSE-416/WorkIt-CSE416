// Builds src/app/favicon.ico from public/workit-icon.svg.
//
// The icon is the logo's figure in white on a violet rounded square, so it
// carries its own background and reads on a light or a dark tab strip alike.
// (The old navy mark needed a white disc drawn behind it for that.) Run
// `npm run favicon` after the icon changes.
//
// Plain Node so it behaves identically in bash, zsh, PowerShell and cmd.exe.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "public", "workit-icon.svg");
const output = join(root, "src", "app", "favicon.ico");

/** Frame sizes to pack into the .ico, matching what browsers and Windows ask for. */
const SIZES = [16, 32, 48, 256];

/**
 * The SVG declares itself 512px, so sharp rasterises it at 512 and every frame
 * is a downscale of that: drawing a 16px frame directly gives a ragged edge.
 *
 * One violet, white and their antialiasing blends quantise for free: against
 * truecolor a palette is a third of the bytes and under 1/255 mean error on
 * every pixel you can actually see.
 */
async function frame(size) {
  return sharp(source)
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
