import { BadRequestException } from "@nestjs/common";

export function validateCatalogImage(file?: { buffer: Buffer; mimetype: string; size: number }) {
  if (!file?.buffer?.length) throw new BadRequestException("Choose an image to upload.");
  if (file.size > 5 * 1024 * 1024 || file.buffer.length > 5 * 1024 * 1024) throw new BadRequestException("Images must be 5 MB or smaller.");
  const bytes = file.buffer;
  const valid = (file.mimetype === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    || (file.mimetype === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    || (file.mimetype === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
  if (!valid) throw new BadRequestException("Upload a PNG, JPEG, or WebP image.");
}
