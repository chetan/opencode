FROM ubuntu:noble AS build

COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git

WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile
RUN OPENCODE_CHANNEL=latest OPENCODE_VERSION="$(bun -p 'require("./package.json").version')" \
    bun run packages/cli/script/build.ts --single --skip-install \
    && cp packages/cli/dist/cli-linux-*/bin/opencode /opencode

FROM ubuntu:noble

COPY --from=build /opencode /usr/local/bin/opencode
ENTRYPOINT ["opencode"]
