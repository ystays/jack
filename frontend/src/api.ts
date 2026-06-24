export type MediaType = "album" | "track";

export interface Health {
  ok: boolean;
  qobuzConfigured: boolean;
  streamripConfig: string;
  incomingDir: string;
  musicDir: string;
  libraryFolderExamples?: string[];
}

export interface SearchResult {
  id: string;
  type: MediaType;
  title: string;
  artist: string;
  album?: string;
  year?: string;
  tracksCount?: number;
  duration?: number;
  trackNumber?: number;
  maximumBitDepth?: number;
  maximumSamplingRate?: number;
  hires?: boolean;
  explicit?: boolean;
  cover?: string;
}

export interface DownloadJob {
  id: string;
  source: string;
  mediaType: MediaType;
  mediaId: string;
  title: string;
  artist: string;
  quality: number;
  status: "queued" | "downloading" | "importing" | "complete" | "failed" | string;
  createdAt: string;
  updatedAt: string;
  log: string[];
  error: string;
  outputPaths: string[];
  targetDir: string;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed with ${response.status}`);
  }
  return data as T;
}

export function getHealth() {
  return api<Health>("/api/health");
}

export async function searchQobuz(query: string, type: MediaType, limit = 20) {
  const params = new URLSearchParams({
    q: query,
    type,
    limit: String(limit),
  });
  const data = await api<{ items: SearchResult[] }>(`/api/search?${params}`);
  return data.items;
}

export async function createDownload(
  item: SearchResult,
  quality: number,
  librarySubfolder: string,
) {
  return api<DownloadJob>("/api/downloads", {
    method: "POST",
    body: JSON.stringify({
      mediaType: item.type,
      id: item.id,
      quality,
      title: item.title,
      artist: item.artist,
      librarySubfolder,
    }),
  });
}

export async function listDownloads() {
  const data = await api<{ items: DownloadJob[] }>("/api/downloads");
  return data.items;
}
