import { Think } from "@cloudflare/think";
import { callable } from "agents";
import { createGit } from "@cloudflare/shell/git";
import { WorkspaceFileSystem } from "@cloudflare/shell";
import { createWorkersAI } from "workers-ai-provider";

interface Env {
  AI: Ai;
  RepoChatAgent: DurableObjectNamespace;
  // Optional: set AI_GATEWAY_ID in wrangler.jsonc vars to route via AI Gateway
  AI_GATEWAY_ID?: string;
}

export interface RepoConfig {
  gitUrl: string;
  repoName: string;
  cloned: boolean;
}

export class RepoChatAgent extends Think<Env, RepoConfig> {
  getModel() {
    const gatewayId = this.env.AI_GATEWAY_ID;
    const workersai = createWorkersAI({
      binding: this.env.AI,
      ...(gatewayId ? { gateway: { id: gatewayId } } : {}),
    });
    // kimi-k2.5: 256k ctx, multi-turn tool calling, vision — best Workers AI model for code Q&A
    return workersai("@cf/moonshotai/kimi-k2.5");
  }

  getSystemPrompt() {
    const config = this.getConfig();
    if (!config?.repoName) {
      return (
        "You are a helpful assistant. " +
        "The user needs to import a GitHub repository to get started. " +
        "Tell them to use the import form to load a repository."
      );
    }
    return [
      `You are an expert software engineer helping users understand the **${config.repoName}** repository.`,
      "The repository has been cloned into your workspace at /repo. Use your built-in workspace tools to explore the code.",
      "",
      "When answering questions:",
      "- Use `read_file` to read specific files, starting with /repo/README.md for overviews",
      "- Use `find_files` or `list_dir` to discover the project structure under /repo",
      "- Use `grep` to search for symbols, patterns, or specific code",
      "- Cite file paths and line numbers when referencing code",
      "- Be concise but precise — this is a code Q&A, not a lecture",
    ].join("\n");
  }

  @callable()
  async setup(gitUrl: string, repoName: string): Promise<{ ok: boolean; error?: string }> {
    const existing = this.getConfig();
    if (existing?.cloned) return { ok: true };

    try {
      const git = createGit(new WorkspaceFileSystem(this.workspace));
      // Shallow clone (depth 1) keeps storage manageable for large repos.
      // Artifacts git URL is used when available; falls back to direct GitHub URL.
      await git.clone({ url: gitUrl, dir: "/repo", depth: 1 });
      this.configure({ gitUrl, repoName, cloned: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
