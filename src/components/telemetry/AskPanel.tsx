import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askTelemetryQuestion } from "@/lib/telemetry.functions";

const PROMPTS = [
  "What is driving my spend this window?",
  "Which tool is failing most and why?",
  "Where am I wasting tokens on repeated context?",
];

export function AskPanel({ windowHours }: { windowHours: number }) {
  const ask = useServerFn(askTelemetryQuestion);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (q: string) => ask({ data: { question: q, windowHours } }),
    onSuccess: (result) => setAnswer(result.answer),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="panel space-y-3 p-4">
        <div>
          <p className="label-caps">Ask the trail</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Questions are answered from rollups only — prompt bodies never leave this broker.
          </p>
        </div>
        <Textarea
          rows={4}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Why did last night's runs cost three times as much?"
        />
        <div className="flex flex-wrap gap-2">
          {PROMPTS.map((prompt) => (
            <Button key={prompt} variant="outline" size="sm" onClick={() => setQuestion(prompt)}>
              {prompt}
            </Button>
          ))}
        </div>
        <Button onClick={() => run.mutate(question)} disabled={question.length < 3 || run.isPending}>
          <Sparkles className="size-4" /> {run.isPending ? "Thinking…" : "Analyse"}
        </Button>
      </div>

      <div className="panel p-4">
        <p className="label-caps">Answer</p>
        {answer ? (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No question asked yet.</p>
        )}
      </div>
    </div>
  );
}
