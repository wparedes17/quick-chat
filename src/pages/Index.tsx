import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Send, Loader2, Zap, MessageSquare, Bot, User, Trash2, FlaskConical, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Location,
  randomId,
  scoreOnce,
  scoreStream,
  evaluate,
} from "@/lib/chatApi";
import { MultipleAnalysis } from "@/components/MultipleAnalysis";
import { TopicAnalysis } from "@/components/TopicAnalysis";

type Role = "user" | "assistant";
interface Msg {
  id: string;
  role: Role;
  content: string;
  intents?: string[];
  pending?: boolean;
}

interface AnalysisResult {
  answer: string;
  score: number;
  reason: string;
}

const Index = () => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [location, setLocation] = useState<Location>("eu");
  const [loading, setLoading] = useState(false);

  const sessionIdRef = useRef(randomId());
  const userIdRef = useRef(randomId());
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Single analysis state
  const [analysisQuestion, setAnalysisQuestion] = useState("");
  const [analysisCriteria, setAnalysisCriteria] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const userMsg: Msg = { id: randomId(), role: "user", content: question };
    const assistantId = randomId();
    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: "assistant", content: "", pending: true },
    ]);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const body = {
      id: randomId(),
      question,
      location,
      sessionid: sessionIdRef.current,
      userid: userIdRef.current,
    };

    try {
      if (streaming) {
        await scoreStream(
          body,
          {
            onChunk: (chunk) => {
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, content: msg.content + chunk, pending: false }
                    : msg,
                ),
              );
            },
            onIntents: (intents) => {
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === assistantId ? { ...msg, intents } : msg,
                ),
              );
            },
          },
          controller.signal,
        );
        setMessages((m) =>
          m.map((msg) => (msg.id === assistantId ? { ...msg, pending: false } : msg)),
        );
      } else {
        const { answer, intents } = await scoreOnce(body, controller.signal);
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: answer, intents, pending: false }
              : msg,
          ),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: `⚠️ ${message}`, pending: false }
            : msg,
        ),
      );
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    sessionIdRef.current = randomId();
  };

  const runAnalysis = async () => {
    const question = analysisQuestion.trim();
    const criteria = analysisCriteria.trim();
    if (!question || !criteria || analysisLoading) return;

    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
      const chatBody = {
        id: randomId(),
        question,
        location,
        sessionid: randomId(),
        userid: userIdRef.current,
      };
      const { answer } = await scoreOnce(chatBody);
      const { score, reason } = await evaluate({ question, answer, criteria });
      setAnalysisResult({ answer, score, reason });
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="size-9 rounded-lg bg-primary text-primary-foreground grid place-items-center">
            <Bot className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold leading-tight">Chatbot</h1>
            <p className="text-xs text-muted-foreground truncate">
              session: {sessionIdRef.current.slice(0, 8)}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Select value={location} onValueChange={(v) => setLocation(v as Location)}>
              <SelectTrigger className="h-8 w-[80px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eu">EU</SelectItem>
                <SelectItem value="us">US</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 pl-2 border-l border-border ml-1">
            {streaming ? (
              <Zap className="size-4 text-primary" />
            ) : (
              <MessageSquare className="size-4 text-muted-foreground" />
            )}
            <Label htmlFor="stream" className="text-xs cursor-pointer select-none">
              {streaming ? "Stream" : "Normal"}
            </Label>
            <Switch
              id="stream"
              checked={streaming}
              onCheckedChange={setStreaming}
              disabled={loading}
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={clearChat}
            disabled={messages.length === 0}
            title="Clear chat"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>

      <Tabs defaultValue="chat" className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-border bg-card/40">
          <div className="max-w-3xl mx-auto px-4">
            <TabsList className="h-10 bg-transparent rounded-none gap-1 p-0">
              <TabsTrigger
                value="chat"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-10 text-sm"
              >
                Chat
              </TabsTrigger>
              <TabsTrigger
                value="analysis"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-10 text-sm flex items-center gap-1.5"
              >
                <FlaskConical className="size-3.5" />
                Single Analysis
              </TabsTrigger>
              <TabsTrigger
                value="multi"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-10 text-sm flex items-center gap-1.5"
              >
                <BarChart2 className="size-3.5" />
                Multiple Analysis
              </TabsTrigger>
              <TabsTrigger
                value="topic"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-10 text-sm flex items-center gap-1.5"
              >
                <BarChart2 className="size-3.5" />
                Topic Analysis
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* Chat tab */}
        <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-6">
              {messages.length === 0 ? (
                <div className="text-center mt-24 text-muted-foreground">
                  <div className="size-14 mx-auto rounded-2xl bg-secondary grid place-items-center mb-4">
                    <Bot className="size-7 text-primary" />
                  </div>
                  <h2 className="text-lg font-medium text-foreground mb-1">
                    Ask me anything
                  </h2>
                  <p className="text-sm">
                    Toggle streaming on or off and pick a region to get started.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  {messages.map((m) => (
                    <MessageBubble key={m.id} msg={m} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border bg-card/60 backdrop-blur-sm">
            <div className="max-w-3xl mx-auto px-4 py-3">
              <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-primary/30 transition">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Type your question…"
                  rows={1}
                  className="flex-1 resize-none border-0 shadow-none focus-visible:ring-0 bg-transparent min-h-[40px] max-h-40 py-2"
                />
                <Button
                  onClick={send}
                  disabled={!input.trim() || loading}
                  size="icon"
                  className="rounded-xl shrink-0"
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 text-center">
                History is not stored — refreshing clears the conversation.
              </p>
            </div>
          </div>
        </TabsContent>

        {/* Single Analysis tab */}
        <TabsContent value="analysis" className="flex-1 overflow-y-auto mt-0">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="analysis-question" className="text-sm font-medium">
                  Question
                </Label>
                <Textarea
                  id="analysis-question"
                  value={analysisQuestion}
                  onChange={(e) => setAnalysisQuestion(e.target.value)}
                  placeholder="Enter the question to send to the chatbot…"
                  rows={3}
                  className="resize-none"
                  disabled={analysisLoading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="analysis-criteria" className="text-sm font-medium">
                  Criteria
                </Label>
                <Textarea
                  id="analysis-criteria"
                  value={analysisCriteria}
                  onChange={(e) => setAnalysisCriteria(e.target.value)}
                  placeholder="Describe the criteria the answer should meet…"
                  rows={3}
                  className="resize-none"
                  disabled={analysisLoading}
                />
              </div>

              <Button
                onClick={runAnalysis}
                disabled={!analysisQuestion.trim() || !analysisCriteria.trim() || analysisLoading}
                className="w-full"
              >
                {analysisLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <FlaskConical className="size-4 mr-2" />
                    Run Analysis
                  </>
                )}
              </Button>
            </div>

            {analysisError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {analysisError}
              </div>
            )}

            {analysisResult && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Answer
                  </p>
                  <div className="text-sm leading-relaxed">
                    <Markdown content={analysisResult.answer} />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Evaluation
                  </p>
                  <div className="flex items-center gap-3">
                    <ScoreBadge score={analysisResult.score} />
                    <p className="text-sm leading-relaxed text-foreground flex-1">
                      {analysisResult.reason}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Multiple Analysis tab */}
        <TabsContent value="multi" className="flex-1 overflow-y-auto mt-0">
          <MultipleAnalysis location={location} />
        </TabsContent>

        {/* Topic Analysis tab */}
        <TabsContent value="topic" className="flex-1 overflow-y-auto mt-0">
          <TopicAnalysis location={location} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

const ScoreBadge = ({ score }: { score: number }) => {
  const color =
    score >= 4
      ? "bg-green-100 text-green-700 border-green-200"
      : score === 3
        ? "bg-yellow-100 text-yellow-700 border-yellow-200"
        : "bg-red-100 text-red-700 border-red-200";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center size-10 rounded-full border text-base font-bold shrink-0",
        color,
      )}
    >
      {score}
    </span>
  );
};

const MessageBubble = ({ msg }: { msg: Msg }) => {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "size-8 rounded-lg grid place-items-center shrink-0",
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "bg-primary text-primary-foreground",
        )}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className={cn("max-w-[80%] flex flex-col gap-1.5", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-secondary text-secondary-foreground rounded-tl-sm",
          )}
        >
          {msg.pending && !msg.content ? (
            <span className="inline-flex gap-1">
              <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
              <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
              <span className="size-1.5 rounded-full bg-current animate-bounce" />
            </span>
          ) : isUser ? (
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          ) : (
            <Markdown content={msg.content} />
          )}
        </div>
        {!isUser && msg.intents && msg.intents.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {msg.intents.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
