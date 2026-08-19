import { useState } from "react";
import { Cloud, Download, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adoptAwsFederation, awsBootstrapScript } from "@/lib/integrations.functions";

export function AwsBootstrapCard({ configured, onChanged }: { configured: boolean; onChanged: () => void }) {
  const script = useServerFn(awsBootstrapScript);
  const adopt = useServerFn(adoptAwsFederation);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const download = async () => {
    setBusy("download");
    try {
      const rendered = await script({ data: { region: "us-east-1" } });
      const url = URL.createObjectURL(new Blob([rendered.body], { type: "text/x-shellscript" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = rendered.filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Open AWS CloudShell, upload the script, and run: sh aegis-aws-bootstrap.sh");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the bootstrap script");
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("connect");
    try {
      await adopt({ data: { receipt: receipt.trim() } });
      setReceipt("");
      toast.success("AWS connected with short-lived federation. No access key was stored.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AWS federation failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        {configured ? <ShieldCheck className="size-4 text-success" /> : <Cloud className="size-4 text-primary" />}
        <h4 className="text-sm font-semibold">Keyless AWS connection</h4>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {configured
          ? "Connected through AWS federation. Aegis receives a scoped 15-minute session for each operation."
          : "Run one script in AWS CloudShell, then paste its non-secret receipt here. No IAM user or long-lived access key is created."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={download}>
          {busy === "download" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          Download CloudShell script
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          className="max-w-2xl font-mono text-xs"
          value={receipt}
          placeholder='Paste the JSON after AEGIS_AWS= (it is not a secret)'
          onChange={(event) => setReceipt(event.target.value)}
        />
        <Button size="sm" disabled={!receipt.trim() || !!busy} onClick={connect}>
          {busy === "connect" ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
          Connect AWS
        </Button>
      </div>
    </div>
  );
}