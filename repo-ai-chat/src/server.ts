import { routeAgentRequest } from "agents";
import { RepoChatAgent } from "./agent";

export { RepoChatAgent };

interface Env {
  RepoChatAgent: DurableObjectNamespace;
  // Cloudflare Artifacts binding (private beta).
  // Uncomment "artifacts" in wrangler.jsonc when you have access.
  ARTIFACTS?: {
    fork(opts: { remote: string; name: string }): Promise<{ id: string; url: string }>;
  };
  ANTHROPIC_API_KEY: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/import" && request.method === "POST") {
      return handleImport(request, env);
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleImport(request: Request, env: Env): Promise<Response> {
  let body: { repoUrl?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { repoUrl } = body;
  if (!repoUrl) {
    return Response.json({ error: "repoUrl is required" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(repoUrl);
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!["github.com", "gitlab.com", "bitbucket.org"].includes(parsedUrl.hostname)) {
    return Response.json({ error: "Only GitHub, GitLab, and Bitbucket URLs are supported" }, { status: 400 });
  }

  // Derive a clean repo name like "owner/repo"
  const pathParts = parsedUrl.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
  if (pathParts.length < 2) {
    return Response.json({ error: "URL must point to a repository (owner/repo)" }, { status: 400 });
  }
  const repoName = pathParts.slice(0, 2).join("/");

  // Normalise to HTTPS .git URL for cloning
  const gitUrl = `https://${parsedUrl.hostname}/${repoName}.git`;

  // Attempt to fork into Cloudflare Artifacts for persistent caching.
  // Falls back to direct GitHub URL if Artifacts is not configured.
  if (env.ARTIFACTS) {
    try {
      const artifactName = repoName.replace("/", "-").toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const artifact = await env.ARTIFACTS.fork({ remote: gitUrl, name: artifactName });
      return Response.json({
        artifactId: artifact.id,
        // artifact.url is a git-compatible URL — agents clone from here instead of GitHub
        gitUrl: artifact.url,
        repoName,
      });
    } catch (err) {
      console.warn("Artifacts fork failed, falling back to direct GitHub URL:", err);
    }
  }

  // Fallback: stable ID derived from the repo URL; agent clones directly from GitHub
  const artifactId = btoa(gitUrl).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
  return Response.json({ artifactId, gitUrl, repoName });
}
