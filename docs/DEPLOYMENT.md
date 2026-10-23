# Run VANTAGE on a server

The server mode is the default. Network, Wire, Control, phone setup and the drone receiver are absent from the interface and their APIs are not mounted. The server does not look up or expose its internet address, use its location as the viewer's location, or inspect Tailscale. Viewer GPS, camera, microphone and compass features still run in the viewer's browser. If GPS is unavailable, open the command palette and choose **Set my location to…**.

To restore the Mac and LAN features on a local installation, run `VANTAGE_LOCAL=1 bun run start`. Local mode binds to loopback and supports the existing Tailscale Serve setup. It cannot be combined with a hosted origin. A plugin with a `local-only` file requires this flag. Restart the app after changing the flag so the browser bundle and API selection agree.

## Try Docker Compose

```sh
docker compose up --build -d
```

Open <http://localhost:4747>. To use another address, set `VANTAGE_ORIGIN` to the exact URL you open in the browser, including its port if needed. For example:

```sh
VANTAGE_ORIGIN=https://vantage.example.com docker compose up --build -d
```

A hosted origin enables the `0.0.0.0:4747` listener. Requests must use its host, and browser Origin checks still apply. A reverse proxy must preserve `Host` or set `X-Forwarded-Host` to the configured host. TLS normally ends at the proxy. Camera, microphone, GPS and orientation permissions require HTTPS outside localhost.

The image runs as the `bun` user. It includes production dependencies and builds the split browser bundle at startup, as the local production app does. It has no host filesystem, Docker socket or host-network mount. The `private/` tree, secrets and local state are excluded from the image.

## Deploy with Portainer on one Swarm node

1. Choose an image tag from the repository's **Container image** workflow. `ghcr.io/marcelsamyn/vantage:latest` follows `main`; use a `sha-...` tag to pin a release. The workflow builds Linux amd64 and arm64 images. The first GHCR package can be private: set its visibility to **Public** in GitHub's package settings for anonymous pulls, or add GHCR credentials in Portainer.
2. In Portainer, open **Stacks → Add stack**. Name it `vantage` and paste `docker-stack.yml` into the web editor, or select that file from this Git repository.
3. Add the environment variable `VANTAGE_ORIGIN`, for example `https://vantage.example.com` or `http://YOUR_SERVER_IP:4747`. Optionally set `VANTAGE_IMAGE` to a pinned tag.
4. Deploy the stack. It runs one replica on the manager and publishes TCP port 4747. Point your reverse proxy at this port when you use a domain. Keep the port behind your existing access controls if the dashboard should be private; VANTAGE does not provide a sign-in screen.
5. Open the configured URL and confirm the public screens work. `/healthz` returns `{"ok":true}` without calling upstream feeds. Network, Wire, Control, Phone and Drones must be absent. Their API paths and `/api/core/iploc` must return 404.

The stack uses named volumes at `/app/.cache` and `/app/.data`. These keep cached feeds and API quota counters across task replacements. Keep one replica: in-memory feed state and quota accounting are designed for one process. Updates stop the old task before starting the new one and roll back on failure.

Swarm deploys a prebuilt image; it does not build the Dockerfile. For a manual build on the node, run:

```sh
docker build -t vantage:local .
VANTAGE_IMAGE=vantage:local VANTAGE_ORIGIN=http://YOUR_SERVER_IP:4747 \
  docker stack deploy --resolve-image never -c docker-stack.yml vantage
```

Portainer can also use the image already built on the single node. Keep the tag consistent with `VANTAGE_IMAGE`.

## Optional API keys

The keys listed in the root README remain optional. Add only the keys you need to the service's `environment` map in the stack file, then set their values in Portainer. Do not commit keys or add a `.env` file to the image. The stack deliberately starts without host or LAN features and without API keys.

## Build and check

```sh
bun install --frozen-lockfile
VANTAGE_LOCAL=0 bun run check
VANTAGE_LOCAL=1 bun run check
docker build -t vantage:local .
docker compose config
VANTAGE_ORIGIN=https://vantage.example.com docker stack config -c docker-stack.yml
```

`bun run check` checks types, architecture and tests. The architecture script also checks CSS naming and motion rules. There is no separate formatter or coverage gate. The private tests run only when both `VANTAGE_LOCAL=1` and `VANTAGE_PRIVATE=1` are set in a checkout that contains that tree.

Docker reference: [deploy a stack](https://docs.docker.com/reference/cli/docker/stack/deploy/). Bun reference: [containerize a Bun application](https://bun.sh/guides/ecosystem/docker).
