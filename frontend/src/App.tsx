import { useEffect, useState, useTransition } from "react";
import {
  Activity,
  AlertCircle,
  Folder,
  Download,
  Loader2,
  Music2,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  createDownload,
  getHealth,
  listDownloads,
  searchQobuz,
  type DownloadJob,
  type Health,
  type MediaType,
  type SearchResult,
} from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatDuration(seconds?: number) {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  const remaining = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function qualityLabel(item: SearchResult) {
  if (!item.maximumBitDepth || !item.maximumSamplingRate) return "";
  return `${item.maximumBitDepth}bit / ${item.maximumSamplingRate}kHz`;
}

function statusVariant(status: DownloadJob["status"]) {
  if (status === "complete") return "success";
  if (status === "failed") return "destructive";
  if (status === "downloading" || status === "importing") return "default";
  return "secondary";
}

function ResultCard({
  item,
  onDownload,
  disabled,
}: {
  item: SearchResult;
  onDownload: (item: SearchResult) => void;
  disabled: boolean;
}) {
  const meta =
    item.type === "album"
      ? [item.artist, item.year, item.tracksCount ? `${item.tracksCount} tracks` : ""]
      : [item.artist, item.album, formatDuration(item.duration)];

  return (
    <TableRow>
      <TableCell className="w-[72px]">
        <div className="overflow-hidden rounded-md border bg-muted">
          {item.cover ? (
            <img
              src={item.cover}
              alt=""
              className="aspect-square h-14 w-14 object-cover"
            />
          ) : (
            <div className="grid h-14 w-14 place-items-center">
              <Music2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="min-w-[260px]">
        <div className="font-medium">{item.title}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {meta.filter(Boolean).join(" / ")}
        </p>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          {item.hires ? <Badge variant="success">Hi-Res</Badge> : null}
          {item.explicit ? <Badge variant="warning">Explicit</Badge> : null}
          {qualityLabel(item) ? (
            <Badge variant="secondary">{qualityLabel(item)}</Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => onDownload(item)}
        >
          {disabled ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Import
        </Button>
      </TableCell>
    </TableRow>
  );
}

function JobCard({ job }: { job: DownloadJob }) {
  const title = job.title || `${job.mediaType} ${job.mediaId}`;
  const meta = [job.artist, `Q${job.quality}`, job.targetDir, job.error]
    .filter(Boolean)
    .join(" · ");
  const log = job.log?.slice(-8).join("\n");

  return (
    <Card>
      <CardHeader className="space-y-0 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
          </div>
          <Badge variant={statusVariant(job.status)} className="capitalize">
            {job.status}
          </Badge>
        </div>
      </CardHeader>
      {log ? (
        <CardContent className="px-4 pb-4 pt-0">
          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
            {log}
          </pre>
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [query, setQuery] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("album");
  const [quality, setQuality] = useState(3);
  const [librarySubfolder, setLibrarySubfolder] = useState(() =>
    window.localStorage.getItem("jack.librarySubfolder") ?? "",
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [error, setError] = useState("");
  const [queueError, setQueueError] = useState("");
  const [isSearching, startSearchTransition] = useTransition();
  const [downloadingId, setDownloadingId] = useState("");

  async function refreshQueue() {
    try {
      setQueueError("");
      setJobs(await listDownloads());
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Failed to load queue");
    }
  }

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to check backend"),
      );
    void refreshQueue();
  }, []);

  useEffect(() => {
    const active = jobs.some((job) =>
      ["queued", "downloading", "importing"].includes(job.status),
    );
    if (!active) return;
    const timer = window.setInterval(() => {
      void refreshQueue();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  useEffect(() => {
    window.localStorage.setItem("jack.librarySubfolder", librarySubfolder);
  }, [librarySubfolder]);

  function runSearch() {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    startSearchTransition(async () => {
      try {
        setError("");
        setResults(await searchQobuz(trimmed, mediaType));
      } catch (err) {
        setResults([]);
        setError(err instanceof Error ? err.message : "Search failed");
      }
    });
  }

  async function enqueueDownload(item: SearchResult) {
    try {
      setDownloadingId(item.id);
      setError("");
      await createDownload(item, quality, librarySubfolder);
      await refreshQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloadingId("");
    }
  }

  const healthText = health?.qobuzConfigured
    ? `Ready. Imports to ${health.musicDir}`
    : "Checking backend...";

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-3xl">Jack</CardTitle>
                <CardDescription className="mt-2 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  {healthText}
                </CardDescription>
              </div>
              <Badge variant={health?.qobuzConfigured ? "default" : "secondary"}>
                {health?.qobuzConfigured ? "Backend ready" : "Connecting"}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_140px_120px_auto]">
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runSearch();
                }}
                placeholder="Search songs or albums"
                className="h-10"
              />
              <Select
                value={mediaType}
                onChange={(event) => setMediaType(event.target.value as MediaType)}
                className="h-10"
                aria-label="Search type"
              >
                <option value="album">Albums</option>
                <option value="track">Tracks</option>
              </Select>
              <Select
                value={quality}
                onChange={(event) => setQuality(Number(event.target.value))}
                className="h-10"
                aria-label="Quality"
              >
                <option value={2}>CD</option>
                <option value={3}>Hi-Res</option>
                <option value={4}>Max</option>
                <option value={1}>320</option>
              </Select>
              <Button onClick={runSearch} disabled={isSearching || query.trim().length < 2}>
                {isSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Search
              </Button>
            </div>
            <div className="flex flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
                <Folder className="h-4 w-4 shrink-0" />
                <span className="shrink-0 font-medium text-foreground">Download to</span>
                <span className="truncate">{health?.musicDir ?? "Music library"}</span>
                <span className="shrink-0">/</span>
              </div>
              <Input
                value={librarySubfolder}
                onChange={(event) => setLibrarySubfolder(event.target.value)}
                placeholder="your library subfolder name, e.g., jackslibrary"
                className="h-9 sm:max-w-xs"
                aria-label="Download folder"
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Request failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.75fr)] lg:items-start">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Results</CardTitle>
                <CardDescription>
                  {results.length ? `${results.length} found` : "Search Qobuz to import music."}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {isSearching ? (
                <div className="grid min-h-72 place-items-center rounded-md border border-dashed text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching Qobuz...
                  </div>
                </div>
              ) : results.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[72px]">Cover</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Quality</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((item) => (
                      <ResultCard
                        key={`${item.type}-${item.id}`}
                        item={item}
                        disabled={downloadingId === item.id}
                        onDownload={enqueueDownload}
                      />
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="grid min-h-72 place-items-center rounded-md border border-dashed p-8 text-center text-muted-foreground">
                  Type at least two characters and search for albums or tracks.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:sticky lg:top-6">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Queue</CardTitle>
                <CardDescription>
                  {jobs.length ? `${jobs.length} download${jobs.length === 1 ? "" : "s"}` : "No downloads queued."}
                </CardDescription>
              </div>
              <Button variant="secondary" size="sm" onClick={refreshQueue}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {queueError ? (
                <Alert variant="destructive" className="mb-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Queue unavailable</AlertTitle>
                  <AlertDescription>{queueError}</AlertDescription>
                </Alert>
              ) : null}
              {jobs.length ? (
                <div className="grid gap-3">
                  {jobs.map((job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>
              ) : (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed p-8 text-center text-muted-foreground">
                  Imported music will appear here while Streamrip works.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
