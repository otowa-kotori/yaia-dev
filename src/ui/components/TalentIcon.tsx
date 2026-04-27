// TalentIcon — renders a talent icon in a styled square frame.

import { getTalentIconUrl } from "../talent-icons";

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
  const radius = Math.max(8, Math.round(size * 0.24));
  const imgSize = Math.round(size * 0.72);

  return (
    <div
      className={`grid place-items-center overflow-hidden shrink-0 border border-border bg-surface-dim ${dimmed ? "opacity-50" : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
      }}
    >
      <img
        src={src}
        alt={alt}
        title={alt}
        className="block"
        style={{
          width: imgSize,
          height: imgSize,
          filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.28))",
        }}
      />
    </div>
  );
}
