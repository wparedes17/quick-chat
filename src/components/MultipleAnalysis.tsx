import { useState, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { randomId, scoreOnce, evaluate, type Location } from "@/lib/chatApi";

interface CsvRow {
  question: string;
  criteria: string;
}

interface RunResult {
  question: string;
  replica: number;
  score: number;
  reason: string;
  responseTimeMs: number;
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cols.push(cur.trim().replace(/^"|"$/g, ""));
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim().replace(/^"|"$/g, ""));
  return cols;
}

function parseCsv(text: string): CsvRow[] | string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return "CSV must have a header row and at least one data row.";
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const qIdx = headers.indexOf("question");
  const cIdx = headers.indexOf("criteria");
  if (qIdx === -1 || cIdx === -1)
    return "CSV must contain 'question' and 'criteria' columns.";
  return lines.slice(1).flatMap((line) => {
    const cols = splitCsvLine(line);
    const question = cols[qIdx]?.trim() ?? "";
    const criteria = cols[cIdx]?.trim() ?? "";
    return question && criteria ? [{ question, criteria }] : [];
  });
}

const SCORE_COLORS = ["", "#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e"];

function buildScoreData(results: RunResult[]) {
  return [1, 2, 3, 4, 5].map((s) => ({
    score: String(s),
    count: results.filter((r) => r.score === s).length,
    fill: SCORE_COLORS[s],
  }));
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function buildTimeHistogram(times: number[], numBuckets = 8) {
  if (times.length === 0) return [];
  const min = Math.min(...times);
  const max = Math.max(...times);
  if (min === max) return [{ label: formatMs(min), count: times.length }];
  const width = (max - min) / numBuckets;
  return Array.from({ length: numBuckets }, (_, i) => {
    const lo = min + i * width;
    const hi = lo + width;
    return {
      label: formatMs(lo),
      count: times.filter((t) =>
        i === numBuckets - 1 ? t <= hi : t >= lo && t < hi,
      ).length,
    };
  });
}

export const MultipleAnalysis = ({ location }: { location: Location }) => {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [replicas, setReplicas] = useState(1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<RunResult[]>([]);
  const [failedCount, setFailedCount] = useState(0);

  const stopRef = useRef(false);
  const userIdRef = useRef(randomId());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setParseError(null);
    setRows([]);
    setResults([]);
    file.text().then((text) => {
      const parsed = parseCsv(text);
      if (typeof parsed === "string") {
        setParseError(parsed);
        setFileName(null);
      } else {
        setRows(parsed);
        setFileName(file.name);
      }
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".csv")) handleFile(file);
  };

  const handleRun = async () => {
    if (rows.length === 0 || running) return;
    setRunning(true);
    setResults([]);
    setFailedCount(0);
    stopRef.current = false;

    const total = rows.length * replicas;
    setProgress({ current: 0, total });

    const accumulated: RunResult[] = [];
    let failed = 0;

    for (const row of rows) {
      for (let rep = 1; rep <= replicas; rep++) {
        if (stopRef.current) break;
        const t0 = performance.now();
        try {
          const { answer } = await scoreOnce({
            id: randomId(),
            question: row.question,
            location,
            sessionid: randomId(),
            userid: userIdRef.current,
          });
          const responseTimeMs = performance.now() - t0;
          const { score, reason } = await evaluate({
            question: row.question,
            answer,
            criteria: row.criteria,
          });
          accumulated.push({ question: row.question, replica: rep, score, reason, responseTimeMs });
          setResults([...accumulated]);
        } catch {
          failed++;
          setFailedCount(failed);
        }
        setProgress((p) => ({ ...p, current: p.current + 1 }));
      }
      if (stopRef.current) break;
    }

    setRunning(false);
  };

  const scoreData = buildScoreData(results);
  const timeData = buildTimeHistogram(results.map((r) => r.responseTimeMs));
  const avgScore =
    results.length > 0
      ? (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(2)
      : "—";
  const avgTime =
    results.length > 0
      ? formatMs(results.reduce((s, r) => s + r.responseTimeMs, 0) / results.length)
      : "—";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Setup card */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        {/* Drop zone */}
        <div
          className={cn(
            "rounded-lg border-2 border-dashed border-border p-6 text-center transition",
            !running && "cursor-pointer hover:border-primary/50 hover:bg-primary/5",
            rows.length > 0 && "border-primary/40 bg-primary/5",
          )}
          onClick={() => !running && fileInputRef.current?.click()}
          onDrop={!running ? handleDrop : undefined}
          onDragOver={(e) => e.preventDefault()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          <Upload className="size-6 mx-auto mb-2 text-muted-foreground" />
          {rows.length > 0 ? (
            <p className="text-sm font-medium text-foreground">
              {fileName} —{" "}
              <span className="text-primary">
                {rows.length} row{rows.length !== 1 ? "s" : ""} loaded
              </span>
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">Drop a CSV file or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">
                Required columns: <code className="bg-muted px-1 rounded">question</code>,{" "}
                <code className="bg-muted px-1 rounded">criteria</code>
              </p>
            </>
          )}
        </div>

        {parseError && <p className="text-sm text-destructive">{parseError}</p>}

        {/* Replicas */}
        <div className="flex items-center gap-3">
          <Label htmlFor="replicas" className="text-sm shrink-0">
            Repetitions per question
          </Label>
          <Input
            id="replicas"
            type="number"
            min={1}
            max={20}
            value={replicas}
            onChange={(e) =>
              setReplicas(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
            }
            className="w-20 h-8 text-center"
            disabled={running}
          />
          {rows.length > 0 && (
            <span className="text-xs text-muted-foreground">
              = {rows.length * replicas} total run{rows.length * replicas !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Run / Stop */}
        <div className="flex gap-2">
          <Button
            onClick={handleRun}
            disabled={rows.length === 0 || running}
            className="flex-1"
          >
            <Play className="size-4 mr-2" />
            Run Analysis
          </Button>
          {running && (
            <Button variant="outline" onClick={() => { stopRef.current = true; }}>
              <Square className="size-4 mr-2" />
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      {progress.total > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{running ? "Running…" : stopRef.current ? "Stopped" : "Completed"}</span>
            <span>
              {progress.current} / {progress.total}
            </span>
          </div>
          <Progress value={(progress.current / progress.total) * 100} />
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Runs completed", value: String(results.length) },
              { label: "Avg score", value: avgScore },
              { label: "Avg response time", value: avgTime },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg border border-border bg-card p-3 text-center"
              >
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          {failedCount > 0 && (
            <p className="text-xs text-destructive">
              {failedCount} run{failedCount !== 1 ? "s" : ""} failed and were skipped.
            </p>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Score Distribution
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={scoreData} barCategoryGap="30%">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="score"
                    tick={{ fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                    contentStyle={{
                      fontSize: 12,
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                    formatter={(v: number) => [v, "count"]}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {scoreData.map((entry) => (
                      <Cell key={entry.score} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Response Time Distribution
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={timeData} barCategoryGap="20%">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                    contentStyle={{
                      fontSize: 12,
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                    formatter={(v: number) => [v, "runs"]}
                  />
                  <Bar
                    dataKey="count"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Results table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs w-[35%]">Question</TableHead>
                  <TableHead className="text-xs text-center w-14">Rep</TableHead>
                  <TableHead className="text-xs text-center w-16">Score</TableHead>
                  <TableHead className="text-xs text-right w-24">Time</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs max-w-0">
                      <span className="block truncate" title={r.question}>
                        {r.question}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-center">{r.replica}</TableCell>
                    <TableCell className="text-xs text-center">
                      <span
                        className={cn(
                          "inline-flex size-6 items-center justify-center rounded-full text-[10px] font-bold",
                          r.score >= 4
                            ? "bg-green-100 text-green-700"
                            : r.score === 3
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700",
                        )}
                      >
                        {r.score}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      {formatMs(r.responseTimeMs)}
                    </TableCell>
                    <TableCell className="text-xs max-w-0">
                      <span className="block truncate" title={r.reason}>
                        {r.reason}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
};
