import { execFile, spawn } from "node:child_process";

export async function runCancellableProcess(command: string, args: string[], options: {
  cwd: string;
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  onLine: (line: string) => void;
}) {
  options.signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let timedOut = false;
    let stopping = false;
    const stop = () => {
      if (stopping || child.exitCode !== null) return;
      stopping = true;
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => {
          if (error && child.exitCode === null) child.kill();
        });
      } else child.kill("SIGKILL");
    };
    const buffers = { stdout: "", stderr: "" };
    const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
      buffers[stream] += chunk.toString("utf8");
      const lines = buffers[stream].split(/\r?\n/);
      buffers[stream] = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) options.onLine(line);
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.stdin.on("error", () => undefined);
    options.signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", stop);
    };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code) => {
      cleanup();
      for (const line of Object.values(buffers)) if (line.trim()) options.onLine(line);
      if (options.signal?.aborted) reject(options.signal.reason ?? new DOMException("Run cancelled.", "AbortError"));
      else if (timedOut) reject(new Error("The process exceeded its time limit and was stopped."));
      else if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code ?? "unknown"}. See the transcript for details.`));
    });
    if (options.signal?.aborted) stop();
    child.stdin.end(options.stdin ?? "");
  });
}
