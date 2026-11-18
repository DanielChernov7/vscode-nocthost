# NoctHost for VS Code

See and manage your [NoctHost](https://nocthost.com) cloud servers without leaving the editor. NoctHost sells hourly servers from Hetzner, Vultr, DigitalOcean, Linode and OVHcloud, plus bare metal from Cherry Servers, through one account and one prepaid balance (crypto or card).

## Features

- **Servers view** in the activity bar: every server with its IP, status, cloud, region and price.
- **Balance** and current hourly spend at the top of the list.
- **SSH in one click**: opens a terminal with `ssh root@<ip>`.
- **Copy IP**, **open in dashboard**.
- **Reboot, power off, power on.**
- **Destroy** with a typed confirmation (you type the server name).
- Auto-refresh every 30 seconds while the view is open.

## Getting started

1. Create an API key in the NoctHost dashboard: **Profile, API keys** ([nocthost.com/dashboard/profile](https://nocthost.com/dashboard/profile)).
2. In VS Code open the NoctHost view and click **Set API key**, or run `NoctHost: Set API Key` from the command palette.
3. The key is checked once and stored in the VS Code secret storage, never in settings.

New servers are deployed from the dashboard (the **+** button opens it). Prices and what can be ordered right now: [nocthost.com/deploy-now](https://nocthost.com/deploy-now).

## Settings

| Setting | Default | |
|---|---|---|
| `nocthost.apiUrl` | `https://api.nocthost.com` | API base URL |
| `nocthost.sshUser` | `root` | User for the SSH command |
| `nocthost.autoRefreshSeconds` | `30` | Refresh interval, `0` turns it off |

## Other ways to use the same API

- REST API, OpenAPI 3.1: [nocthost.com/openapi.json](https://nocthost.com/openapi.json)
- Remote MCP server for AI agents: [nocthost.com/docs/mcp](https://nocthost.com/docs/mcp)
- Terraform and OpenTofu provider: [registry.terraform.io/providers/DanielChernov7/nocthost](https://registry.terraform.io/providers/DanielChernov7/nocthost)

## Privacy

The extension talks only to the NoctHost API with your key. It sends no telemetry.

## License

MIT. Made by Nocthost OÜ, Estonia.
