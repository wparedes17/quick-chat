import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Copy, Check, Play, Square, Loader2, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { randomId, scoreOnce, evaluate, follow, type Location } from "@/lib/chatApi";

interface Turn {
  userMessage: string;
  systemResponse: string;
}

const DEFAULT_CRITERIA =
  "The conversation feels natural and coherent. The SYSTEM maintains context across all turns, provides relevant and helpful responses, and does not break the conversation flow.";

function formatTranscript(conversation: Turn[]): string {
  return conversation
    .flatMap((t) => [`USER: ${t.userMessage}`, `SYSTEM: ${t.systemResponse}`])
    .join("\n\n");
}

const ScoreBadge = ({ score }: { score: number }) => (
  <span
    className={cn(
      "inline-flex size-10 items-center justify-center rounded-full border text-base font-bold shrink-0",
      score >= 4
        ? "bg-green-100 text-green-700 border-green-200"
        : score === 3
          ? "bg-yellow-100 text-yellow-700 border-yellow-200"
          : "bg-red-100 text-red-700 border-red-200",
    )}
  >
    {score}
  </span>
);

export const ConversationEvaluation = ({ location }: { location: Location }) => {
  const [initialQuestion, setInitialQuestion] = useState("");
  const [turns, setTurns] = useState(2);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [conversation, setConversation] = useState<Turn[]>([]);
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<{ score: number; reason: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userIdRef = useRef(randomId());
  const stopRef = useRef(false);

  const runConversation = async () => {
    if (!initialQuestion.trim() || running) return;
    setRunning(true);
    setConversation([]);
    setEvalResult(null);
    setError(null);
    stopRef.current = false;

    const sessionId = randomId();
    let lastUserMsg = initialQuestion.trim();
    const acc: Turn[] = [];

    try {
      for (let t = 0; t < turns; t++) {
        if (stopRef.current) break;

        setStatus(`Turn ${t + 1} of ${turns}: waiting for chatbot…`);
        const { answer } = await scoreOnce({
          id: randomId(),
          question: lastUserMsg,
          location,
          sessionid: sessionId,
          userid: userIdRef.current,
        });

        acc.push({ userMessage: lastUserMsg, systemResponse: answer });
        setConversation([...acc]);

        if (t < turns - 1 && !stopRef.current) {
          setStatus(`Turn ${t + 1} of ${turns}: generating follow-up…`);
          lastUserMsg = await follow(lastUserMsg, answer);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }

    setRunning(false);
    setStatus("");
  };

  const runEvaluation = async () => {
    if (conversation.length === 0 || evaluating) return;
    setEvaluating(true);
    setEvalResult(null);
    try {
      const result = await evaluate({
        question: formatTranscript(conversation),
        answer: conversation[conversation.length - 1].systemResponse,
        criteria,
      });
      setEvalResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    }
    setEvaluating(false);
  };

  const copyTranscript = () => {
    navigator.clipboard.writeText(formatTranscript(conversation));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const completedTurns = conversation.length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Setup */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="conv-question" className="text-sm font-medium">
            Initial Question
          </Label>
          <Textarea
            id="conv-question"
            value={initialQuestion}
            onChange={(e) => setInitialQuestion(e.target.value)}
            placeholder="Ask the chatbot something to start the conversation…"
            rows={3}
            className="resize-none"
            disabled={running}
          />
        </div>

        <div className="flex items-center gap-3">
          <Label htmlFor="conv-turns" className="text-sm shrink-0">
            Conversation turns
          </Label>
          <Input
            id="conv-turns"
            type="number"
            min={1}
            max={10}
            value={turns}
            onChange={(e) =>
              setTurns(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
            }
            className="w-20 h-8 text-center"
            disabled={running}
          />
          <span className="text-xs text-muted-foreground">
            1 initial + {Math.max(0, turns - 1)} follow-up{turns > 2 ? "s" : ""}
          </span>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={runConversation}
            disabled={!initialQuestion.trim() || running}
            className="flex-1"
          >
            <Play className="size-4 mr-2" />
            Start Conversation
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
      {running && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{status}</span>
            <span>{completedTurns} / {turns}</span>
          </div>
          <Progress value={(completedTurns / turns) * 100} />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Transcript */}
      {conversation.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
            {conversation.flatMap((turn, i) => [
              <div key={`u-${i}`} className="px-4 py-3 bg-muted/40">
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary block mb-1.5">
                  User
                </span>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{turn.userMessage}</p>
              </div>,
              <div key={`s-${i}`} className="px-4 py-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
                  System
                </span>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{turn.systemResponse}</p>
              </div>,
            ])}
          </div>

          {/* Actions — shown when conversation is complete */}
          {!running && (
            <div className="space-y-3">
              {/* Copy */}
              <Button variant="outline" onClick={copyTranscript} className="w-full">
                {copied ? (
                  <>
                    <Check className="size-4 mr-2 text-green-600" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="size-4 mr-2" />
                    Copy as Script
                  </>
                )}
              </Button>

              {/* Evaluate */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Evaluate Conversation
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="conv-criteria" className="text-xs">
                    Criteria
                  </Label>
                  <Textarea
                    id="conv-criteria"
                    value={criteria}
                    onChange={(e) => setCriteria(e.target.value)}
                    rows={3}
                    className="resize-none text-sm"
                    disabled={evaluating}
                  />
                </div>

                <Button
                  onClick={runEvaluation}
                  disabled={evaluating || !criteria.trim()}
                  className="w-full"
                >
                  {evaluating ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      Evaluating…
                    </>
                  ) : (
                    <>
                      <FlaskConical className="size-4 mr-2" />
                      Evaluate
                    </>
                  )}
                </Button>

                {evalResult && (
                  <div className="flex items-start gap-3 pt-3 border-t border-border">
                    <ScoreBadge score={evalResult.score} />
                    <p className="text-sm leading-relaxed text-foreground flex-1">
                      {evalResult.reason}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
