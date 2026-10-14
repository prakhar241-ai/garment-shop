import { ImageResponse } from "next/og";

// App icons for the PWA manifest, drawn at build time instead of committing PNGs.
export function generateStaticParams() {
  return [{ size: "192" }, { size: "512" }];
}

export async function GET(_req: Request, { params }: RouteContext<"/icons/[size]">) {
  const { size } = await params;
  const px = size === "512" ? 512 : 192;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f5132",
          color: "#ffffff",
          fontSize: px * 0.55,
          fontWeight: 700,
        }}
      >
        ₹
      </div>
    ),
    { width: px, height: px },
  );
}
