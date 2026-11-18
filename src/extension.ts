import * as vscode from "vscode";
import { ApiError, Billing, NoctHostClient, Server, contextValueFor, priceLabel, sshCommand } from "./api";

const SECRET_KEY = "nocthost.apiKey";
const DASHBOARD = "https://nocthost.com/dashboard";

type Node = ServerNode | InfoNode;

class ServerNode extends vscode.TreeItem {
  constructor(readonly server: Server) {
    super(server.label || server.id, vscode.TreeItemCollapsibleState.None);
    const parts = [server.ipv4 ?? "", server.status === "ACTIVE" ? "" : server.status.toLowerCase(), priceLabel(server)];
    this.description = parts.filter(Boolean).join(" · ");
    this.tooltip = new vscode.MarkdownString(
      [
        `**${server.label}**`,
        `Status: ${server.status}`,
        `Cloud: ${server.provider}, region ${server.region}`,
        `Plan: ${server.plan}${server.image ? `, ${server.image}` : ""}`,
        server.ipv4 ? `IPv4: \`${server.ipv4}\`` : "",
        priceLabel(server) ? `Price: ${priceLabel(server)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    this.contextValue = contextValueFor(server);
    this.iconPath = new vscode.ThemeIcon(
      server.status === "ACTIVE" ? "vm-running" : server.status === "STOPPED" ? "vm-outline" : server.status === "ERROR" ? "error" : "loading~spin",
    );
  }
}

class InfoNode extends vscode.TreeItem {
  constructor(label: string, description?: string, icon?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "info";
  }
}

class ServersProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly getClient: () => Promise<NoctHostClient | undefined>) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element) return [];
    const client = await this.getClient();
    if (!client) return [];
    try {
      const [servers, billing] = await Promise.all([client.listServers(), client.billing().catch(() => undefined as Billing | undefined)]);
      const nodes: Node[] = [];
      if (billing) {
        nodes.push(new InfoNode(`Balance $${Number(billing.balance).toFixed(2)}`, `spending $${Number(billing.hourlySpend).toFixed(3)}/h`, "credit-card"));
      }
      if (servers.length === 0) {
        nodes.push(new InfoNode("No servers yet", "use + to deploy one", "info"));
      }
      for (const s of servers) nodes.push(new ServerNode(s));
      return nodes;
    } catch (e) {
      return [new InfoNode(e instanceof Error ? e.message : String(e), undefined, "warning")];
    }
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const secrets = context.secrets;

  const setHasKey = async () => {
    const key = await secrets.get(SECRET_KEY);
    await vscode.commands.executeCommand("setContext", "nocthost.hasKey", Boolean(key));
  };

  const getClient = async (): Promise<NoctHostClient | undefined> => {
    const key = await secrets.get(SECRET_KEY);
    if (!key) return undefined;
    const apiUrl = vscode.workspace.getConfiguration("nocthost").get<string>("apiUrl") || "https://api.nocthost.com";
    return new NoctHostClient(apiUrl, key);
  };

  const provider = new ServersProvider(getClient);
  const view = vscode.window.createTreeView("nocthost.servers", { treeDataProvider: provider });
  context.subscriptions.push(view);

  let timer: NodeJS.Timeout | undefined;
  const scheduleRefresh = () => {
    if (timer) clearInterval(timer);
    const sec = vscode.workspace.getConfiguration("nocthost").get<number>("autoRefreshSeconds") ?? 30;
    if (sec > 0) {
      timer = setInterval(() => {
        if (view.visible) provider.refresh();
      }, sec * 1000);
    }
  };
  scheduleRefresh();
  context.subscriptions.push({ dispose: () => timer && clearInterval(timer) });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("nocthost")) {
        scheduleRefresh();
        provider.refresh();
      }
    }),
  );

  const withClient = async (fn: (c: NoctHostClient) => Promise<void>) => {
    const client = await getClient();
    if (!client) {
      void vscode.window.showWarningMessage("Set your NoctHost API key first.", "Set API Key").then((a) => {
        if (a) void vscode.commands.executeCommand("nocthost.setApiKey");
      });
      return;
    }
    try {
      await fn(client);
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`NoctHost: ${msg}`);
    } finally {
      provider.refresh();
    }
  };

  const register = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register("nocthost.setApiKey", async () => {
    const key = await vscode.window.showInputBox({
      title: "NoctHost API key",
      prompt: "Create a key in the dashboard under Profile, API keys. It is stored in the VS Code secret storage.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "nh_...",
      validateInput: (v) => (v.trim().length < 8 ? "This does not look like an API key." : undefined),
    });
    if (!key) return;
    const apiUrl = vscode.workspace.getConfiguration("nocthost").get<string>("apiUrl") || "https://api.nocthost.com";
    try {
      await new NoctHostClient(apiUrl, key.trim()).billing();
    } catch (e) {
      void vscode.window.showErrorMessage(`NoctHost: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    await secrets.store(SECRET_KEY, key.trim());
    await setHasKey();
    provider.refresh();
    void vscode.window.showInformationMessage("NoctHost: connected.");
  });

  register("nocthost.clearApiKey", async () => {
    await secrets.delete(SECRET_KEY);
    await setHasKey();
    provider.refresh();
  });

  register("nocthost.refresh", () => provider.refresh());

  register("nocthost.deploy", () => vscode.env.openExternal(vscode.Uri.parse(`${DASHBOARD}/servers`)));

  register("nocthost.openInDashboard", (node?: ServerNode) => {
    const url = node?.server ? `${DASHBOARD}/servers/${encodeURIComponent(node.server.id)}` : `${DASHBOARD}/servers`;
    return vscode.env.openExternal(vscode.Uri.parse(url));
  });

  register("nocthost.copyIp", async (node?: ServerNode) => {
    if (!node?.server.ipv4) return void vscode.window.showWarningMessage("This server has no IP address yet.");
    await vscode.env.clipboard.writeText(node.server.ipv4);
    void vscode.window.showInformationMessage(`Copied ${node.server.ipv4}`);
  });

  register("nocthost.ssh", (node?: ServerNode) => {
    if (!node?.server.ipv4) return void vscode.window.showWarningMessage("This server has no IP address yet.");
    const user = vscode.workspace.getConfiguration("nocthost").get<string>("sshUser") || "root";
    const term = vscode.window.createTerminal({ name: `ssh ${node.server.label}` });
    term.show();
    term.sendText(sshCommand(user, node.server.ipv4));
  });

  const power = (verb: "reboot" | "stop" | "start", title: string) =>
    register(`nocthost.${verb}`, async (node?: ServerNode) => {
      if (!node) return;
      if (verb !== "start") {
        const ok = await vscode.window.showWarningMessage(`${title} ${node.server.label}?`, { modal: true }, title);
        if (ok !== title) return;
      }
      await withClient(async (c) => {
        await c[verb](node.server.id);
        void vscode.window.showInformationMessage(`NoctHost: ${title.toLowerCase()} requested for ${node.server.label}.`);
      });
    });
  power("reboot", "Reboot");
  power("stop", "Power Off");
  power("start", "Power On");

  register("nocthost.destroy", async (node?: ServerNode) => {
    if (!node) return;
    const name = node.server.label || node.server.id;
    const typed = await vscode.window.showInputBox({
      title: `Destroy ${name}`,
      prompt: `This deletes the server and its disk. Billing stops. Type the server name (${name}) to confirm.`,
      ignoreFocusOut: true,
      validateInput: (v) => (v === name ? undefined : "The name does not match."),
    });
    if (typed !== name) return;
    await withClient(async (c) => {
      await c.destroy(node.server.id);
      void vscode.window.showInformationMessage(`NoctHost: ${name} is being destroyed.`);
    });
  });

  await setHasKey();
}

export function deactivate(): void {}
