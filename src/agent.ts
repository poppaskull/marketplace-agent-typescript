import { ActivityTypes } from "@microsoft/agents-activity";
import { AgentApplication, MemoryStorage, TurnContext } from "@microsoft/agents-hosting";
import { AzureOpenAI, OpenAI } from "openai";
import config from "./config";

const client = new AzureOpenAI({
  apiVersion: config.azureOpenAIApiVersion,
  apiKey: config.azureOpenAIKey,
  endpoint: config.azureOpenAIEndpoint,
  deployment: config.azureOpenAIDeploymentName,
});
const systemPrompt = "You are an AI agent that can chat with users.";

// Define storage and application
const storage = new MemoryStorage();
export const agentApp = new AgentApplication({
  storage,
});

agentApp.conversationUpdate("membersAdded", async (context: TurnContext) => {
  await context.sendActivity(`Hi there! I'm an agent to chat with you.`);
});

// Listen for ANY message to be received. MUST BE AFTER ANY OTHER MESSAGE HANDLERS
agentApp.activity(ActivityTypes.Message, async (context: TurnContext) => {
  const text = (context.activity.text || "").trim();

  // Probe multiple API versions to find a working one.
  if (text.toLowerCase().startsWith("/probe")) {
    const parts = text.split(/\s+/).slice(1);
    const candidates = parts.length
      ? parts
      : [
          // Prefer stable first, then recent previews
          "2024-06-01",
          "2024-07-01-preview",
          "2024-02-01",
          "2024-02-15-preview",
          "2023-12-01-preview",
          "2023-05-15",
        ];

    if (!config.azureOpenAIEndpoint || !config.azureOpenAIDeploymentName) {
      await context.sendActivity(
        [
          "Probe aborted: missing configuration.",
          `- Endpoint: ${config.azureOpenAIEndpoint || "<unset>"}`,
          `- Deployment: ${config.azureOpenAIDeploymentName || "<unset>"}`,
        ].join("\n")
      );
      return;
    }

    const results: string[] = [];
    for (const v of candidates) {
      const start = Date.now();
      try {
        const tempClient = new AzureOpenAI({
          apiVersion: v,
          apiKey: config.azureOpenAIKey,
          endpoint: config.azureOpenAIEndpoint,
          deployment: config.azureOpenAIDeploymentName,
        });
        const resp = await tempClient.chat.completions.create({
          messages: [
            { role: "system", content: "You are a diagnostic assistant." },
            { role: "user", content: "probe" },
          ],
          model: config.azureOpenAIDeploymentName,
          temperature: 0,
          max_tokens: 5,
        });
        const ms = Date.now() - start;
        const sample = resp.choices?.[0]?.message?.content || "<empty>";
        results.push(`✔ ${v} (${ms} ms): ${String(sample).slice(0, 80)}`);
      } catch (err: any) {
        const ms = Date.now() - start;
        const status = err?.status ?? err?.response?.status ?? "";
        const code = err?.code ? ` code=${err.code}` : "";
        const msg = err?.message || "error";
        results.push(`✖ ${v} (${ms} ms): ${status}${code} ${msg}`);
      }
    }

    await context.sendActivity(
      [
        "AOAI API version probe results:",
        `- Endpoint: ${config.azureOpenAIEndpoint}`,
        `- Deployment: ${config.azureOpenAIDeploymentName}`,
        `- Current configured version: ${config.azureOpenAIApiVersion}`,
        "",
        ...results,
        "",
        "Set AZURE_OPENAI_API_VERSION to a passing version and restart.",
      ].join("\n")
    );
    return;
  }

  // Lightweight diagnostics to confirm AOAI routing
  if (text.toLowerCase() === "/diag" || text.toLowerCase() === "diag") {
    const start = Date.now();
    try {
      const ping = await client.chat.completions.create({
        messages: [
          { role: "system", content: "You are a diagnostic assistant." },
          { role: "user", content: "ping" },
        ],
        model: config.azureOpenAIDeploymentName || "",
        temperature: 0,
        max_tokens: 10,
      });
      const latencyMs = Date.now() - start;
      const content = ping.choices?.[0]?.message?.content || "<empty>";
      const tokens = (ping as any).usage?.total_tokens ?? "n/a";
    await context.sendActivity(
        [
          "AOAI diagnostics:",
          `- Endpoint: ${config.azureOpenAIEndpoint || "<unset>"}`,
          `- Deployment (model): ${config.azureOpenAIDeploymentName || "<unset>"}`,
      `- API version: ${config.azureOpenAIApiVersion}`,
          `- Latency: ${latencyMs} ms`,
          `- Tokens: ${tokens}`,
          `- Sample: ${String(content).slice(0, 160)}`,
        ].join("\n")
      );
      return;
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      // Avoid leaking secrets in errors
      const msg = err?.message || "Unknown error";
      const status = err?.status ?? err?.response?.status;
      await context.sendActivity(
        [
          "AOAI diagnostics failed:",
          `- Endpoint: ${config.azureOpenAIEndpoint || "<unset>"}`,
          `- Deployment (model): ${config.azureOpenAIDeploymentName || "<unset>"}`,
          status ? `- HTTP status: ${status}` : undefined,
          `- Latency: ${latencyMs} ms`,
          `- Error: ${msg}`,
          `- Hint: Ensure AZURE_OPENAI_API_KEY/ENDPOINT/DEPLOYMENT_NAME are set.`,
        ]
          .filter(Boolean)
          .join("\n")
      );
      return;
    }
  }

  // Normal chat flow
  if (!config.azureOpenAIDeploymentName) {
    await context.sendActivity(
      "Configuration error: AZURE_OPENAI_DEPLOYMENT_NAME is not set."
    );
    return;
  }

  const result = await client.chat.completions.create({
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: text,
      },
    ],
    model: config.azureOpenAIDeploymentName,
  });

  let answer = "";
  for (const choice of result.choices) {
    answer += choice.message.content;
  }
  await context.sendActivity(answer || "<no content>");
});
