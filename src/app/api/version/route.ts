import { APP_VERSION, BUILD_ID } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { version: APP_VERSION, build: BUILD_ID },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
