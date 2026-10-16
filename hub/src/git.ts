export type GitResult = { code: number; stdout: string; stderr: string };

// input is written to the stdin of the command (pathspec lists); without it the command reads nothing.
export type GitRunner = (cwd: string, args: string[], timeoutMs?: number, input?: string) => Promise<GitResult>;

export const runGit: GitRunner = async (cwd, args, timeoutMs = 60_000, input) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(['git', '-C', cwd, ...args], {
      stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
  } catch (error) {
    return { code: -1, stdout: '', stderr: (error as Error).message };
  }
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

export function gitSync(cwd: string, args: string[]): GitResult {
  try {
    const r = Bun.spawnSync(['git', '-C', cwd, ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  } catch (error) {
    return { code: -1, stdout: '', stderr: (error as Error).message };
  }
}

export class GitQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}
