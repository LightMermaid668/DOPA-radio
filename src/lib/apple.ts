export type ExternalTrack = {
  externalId: string;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  deepLink: string | null;
  previewUrl: string | null;
};

type ITunesResult = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  trackViewUrl?: string;
  previewUrl?: string;
  wrapperType?: string;
};

function mapITunesResult(result: ITunesResult): ExternalTrack {
  return {
    externalId: String(result.trackId ?? ""),
    title: result.trackName ?? "不明な曲",
    artist: result.artistName ?? "",
    album: result.collectionName ?? null,
    artworkUrl: result.artworkUrl100
      ? result.artworkUrl100.replace("100x100", "600x600")
      : null,
    durationMs: result.trackTimeMillis ?? null,
    deepLink: result.trackViewUrl ?? null,
    previewUrl: result.previewUrl ?? null,
  };
}

export async function searchAppleTracks(term: string, limit = 12): Promise<ExternalTrack[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("entity", "song");
  url.searchParams.set("country", "jp");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`iTunes Search failed: ${res.status}`);
  const data = (await res.json()) as { results?: ITunesResult[] };
  return (data.results ?? [])
    .filter((result) => result.wrapperType === "track" && result.trackId)
    .map(mapITunesResult);
}

export async function lookupAppleTrack(trackId: string): Promise<ExternalTrack | null> {
  const url = new URL("https://itunes.apple.com/lookup");
  url.searchParams.set("id", trackId);
  url.searchParams.set("country", "jp");
  url.searchParams.set("entity", "song");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`iTunes Lookup failed: ${res.status}`);
  const data = (await res.json()) as { results?: ITunesResult[] };
  const result = (data.results ?? []).find((item) => item.wrapperType === "track");
  return result ? mapITunesResult(result) : null;
}
