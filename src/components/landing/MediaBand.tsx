import Image, { type StaticImageData } from "next/image";

/** Banda fotográfica ancha entre secciones (slots de media del v29). */
export default function MediaBand({
  src,
  caption,
  alt,
}: {
  src: StaticImageData;
  caption: string;
  alt: string;
}) {
  return (
    <figure className="md-band">
      <Image
        src={src}
        alt={alt}
        fill
        placeholder="blur"
        sizes="(max-width: 1240px) 100vw, 1176px"
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
