import { getTalentIconUrl } from "./talent-icons";

export function TalentIcon({
  talentId,
  alt,
  size = 32,
  dimmed = false,
}: {
  talentId: string;
  alt: string;
  size?: number;
  dimmed?: boolean;
}) {
  const src = getTalentIconUrl(talentId);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, Math.round(size * 0.24)),
        border: "1px solid #334",
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), #151a24",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
        flex: "0 0 auto",
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <img
        src={src}
        alt={alt}
        title={alt}
        style={{
          width: Math.round(size * 0.72),
          height: Math.round(size * 0.72),
          display: "block",
          filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.28))",
        }}
      />
    </div>
  );
}
