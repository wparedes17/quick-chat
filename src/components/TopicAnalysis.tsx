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
  topic: string;
}

interface RunResult {
  question: string;
  topic: string;
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
  const tIdx = headers.indexOf("topic");
  if (qIdx === -1 || cIdx === -1)
    return "CSV must contain 'question' and 'criteria' columns.";
  if (tIdx === -1) return "CSV must contain a 'topic' column.";
  return lines.slice(1).flatMap((line) => {
    const cols = splitCsvLine(line);
    const question = cols[qIdx]?.trim() ?? "";
    const criteria = cols[cIdx]?.trim() ?? "";
    const topic = cols[tIdx]?.trim() ?? "";
    return question && criteria && topic ? [{ question, criteria, topic }] : [];
  });
}

const SCORE_COLORS = ["", "#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e"];

const TOPIC_PALETTE = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#8b5cf6", "#f97316", "#06b6d4", "#ec4899", "#14b8a6",
];

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function buildScoreData(results: RunResult[]) {
  return [1, 2, 3, 4, 5].map((s) => ({
    score: String(s),
    count: results.filter((r) => r.score === s).length,
    fill: SCORE_COLORS[s],
  }));
}

function avg(nums: number[]) {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

interface TopicStat {
  topic: string;
  color: string;
  count: number;
  avgScore: number;
  avgTime: number;
  scoreData: { score: string; count: number; fill: string }[];
}

function buildTopicStats(results: RunResult[], topics: string[]): TopicStat[] {
  return topics.map((topic, i) => {
    const tr = results.filter((r) => r.topic === topic);
    return {
      topic,
      color: TOPIC_PALETTE[i % TOPIC_PALETTE.length],
      count: tr.length,
      avgScore: avg(tr.map((r) => r.score)),
      avgTime: avg(tr.map((r) => r.responseTimeMs)),
      scoreData: buildScoreData(tr),
    };
  });
}

export const TopicAnalysis = ({ location }: { location: Location }) => {
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
          accumulated.push({
            question: row.question,
            topic: row.topic,
            replica: rep,
            score,
            reason,
            responseTimeMs,
          });
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

  const topics = [...new Set(results.map((r) => r.topic))].sort();
  const topicStats = buildTopicStats(results, topics);

  const overallAvgScore =
    results.length > 0 ? avg(results.map((r) => r.score)).toFixed(2) : "—";
  const overallAvgTime =
    results.length > 0 ? formatMs(avg(results.map((r) => r.responseTimeMs))) : "—";

  // Comparison data for side-by-side horizontal bar charts
  const comparisonData = topicStats.map((ts) => ({
    topic: ts.topic.length > 18 ? ts.topic.slice(0, 16) + "…" : ts.topic,
    fullTopic: ts.topic,
    avgScore: parseFloat(ts.avgScore.toFixed(2)),
    avgTimeMs: parseFloat(ts.avgTime.toFixed(0)),
    fill: ts.color,
  }));

  const yAxisWidth = Math.min(
    120,
    Math.max(60, Math.max(...(comparisonData.map((d) => d.topic.length) ?? [0])) * 7),
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Setup card */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
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
              {topics.length === 0 && rows.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  ({[...new Set(rows.map((r) => r.topic))].length} topic
                  {[...new Set(rows.map((r) => r.topic))].length !== 1 ? "s" : ""})
                </span>
              )}
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">Drop a CSV file or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">
                Required columns:{" "}
                <code className="bg-muted px-1 rounded">question</code>,{" "}
                <code className="bg-muted px-1 rounded">criteria</code>,{" "}
                <code className="bg-muted px-1 rounded">topic</code>
              </p>
            </>
          )}
        </div>

        {parseError && <p className="text-sm text-destructive">{parseError}</p>}

        <div className="flex items-center gap-3">
          <Label htmlFor="ta-replicas" className="text-sm shrink-0">
            Repetitions per question
          </Label>
          <Input
            id="ta-replicas"
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
          {/* Overall summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Runs completed", value: String(results.length) },
              { label: "Avg score", value: overallAvgScore },
              { label: "Avg response time", value: overallAvgTime },
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

          {/* Comparison charts */}
          {topicStats.length > 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Avg score by topic */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Avg Score by Topic
                </p>
                <ResponsiveContainer width="100%" height={Math.max(160, topics.length * 36)}>
                  <BarChart
                    layout="vertical"
                    data={comparisonData}
                    margin={{ left: 4, right: 24 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      type="number"
                      domain={[0, 5]}
                      ticks={[0, 1, 2, 3, 4, 5]}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="topic"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={yAxisWidth}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                      contentStyle={{
                        fontSize: 12,
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                      }}
                      formatter={(v: number, _: string, props: { payload?: { fullTopic?: string } }) => [
                        v,
                        props.payload?.fullTopic ?? "avg score",
                      ]}
                    />
                    <Bar dataKey="avgScore" radius={[0, 4, 4, 0]}>
                      {comparisonData.map((entry) => (
                        <Cell key={entry.topic} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Avg response time by topic */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Avg Response Time by Topic
                </p>
                <ResponsiveContainer width="100%" height={Math.max(160, topics.length * 36)}>
                  <BarChart
                    layout="vertical"
                    data={comparisonData}
                    margin={{ left: 4, right: 24 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => formatMs(v)}
                    />
                    <YAxis
                      type="category"
                      dataKey="topic"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={yAxisWidth}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                      contentStyle={{
                        fontSize: 12,
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                      }}
                      formatter={(v: number, _: string, props: { payload?: { fullTopic?: string } }) => [
                        formatMs(v),
                        props.payload?.fullTopic ?? "avg time",
                      ]}
                    />
                    <Bar dataKey="avgTimeMs" radius={[0, 4, 4, 0]}>
                      {comparisonData.map((entry) => (
                        <Cell key={entry.topic} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Per-topic score histograms */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {topicStats.map((ts) => (
              <div
                key={ts.topic}
                className="rounded-xl border border-border bg-card p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: ts.color }}
                    />
                    <p
                      className="text-sm font-medium truncate"
                      title={ts.topic}
                    >
                      {ts.topic}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0 space-y-0.5">
                    <p>{ts.count} run{ts.count !== 1 ? "s" : ""}</p>
                    <p>avg {formatMs(ts.avgTime)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Avg score:{" "}
                  <span
                    className={cn(
                      "font-semibold",
                      ts.avgScore >= 4
                        ? "text-green-600"
                        : ts.avgScore >= 3
                          ? "text-yellow-600"
                          : "text-red-600",
                    )}
                  >
                    {ts.avgScore.toFixed(2)}
                  </span>
                </p>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={ts.scoreData} barCategoryGap="30%">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="score"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={24}
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
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {ts.scoreData.map((entry) => (
                        <Cell key={entry.score} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>

          {/* Results table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs w-[25%]">Question</TableHead>
                  <TableHead className="text-xs w-[20%]">Topic</TableHead>
                  <TableHead className="text-xs text-center w-12">Rep</TableHead>
                  <TableHead className="text-xs text-center w-16">Score</TableHead>
                  <TableHead className="text-xs text-right w-20">Time</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => {
                  const topicColor =
                    TOPIC_PALETTE[topics.indexOf(r.topic) % TOPIC_PALETTE.length];
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs max-w-0">
                        <span className="block truncate" title={r.question}>
                          {r.question}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs max-w-0">
                        <span className="flex items-center gap-1.5 truncate" title={r.topic}>
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{ backgroundColor: topicColor }}
                          />
                          {r.topic}
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
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
};
