import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "node:fs/promises";
const svg = await readFile("assets/dogdog.svg", "utf8");
const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map((size) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng(),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((data, i) => {
  const n = 6 + i * 16;
  header[n] = sizes[i] === 256 ? 0 : sizes[i];
  header[n + 1] = header[n];
  header.writeUInt16LE(1, n + 4);
  header.writeUInt16LE(32, n + 6);
  header.writeUInt32LE(data.length, n + 8);
  header.writeUInt32LE(offset, n + 12);
  offset += data.length;
});
await writeFile("assets/dogdog.ico", Buffer.concat([header, ...images]));
