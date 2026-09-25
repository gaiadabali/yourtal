# The ledger service image. YT-0517/YT-0516.
#
# Multi-stage: the build toolchain (compiler, module cache, git for `go
# mod download`) never reaches the image that actually runs. A stolen
# runtime image then hands an attacker a static binary and nothing else —
# no shell, no package manager, no source.
#
# Pinned by tag (matches this repo's docker-compose.yml convention:
# postgres:17-alpine, cerbos:0.55.0 — never :latest, per the Atlas lesson
# recorded against docker-compose.yml's minio entry).
FROM golang:1.26.8-alpine3.24 AS builder

WORKDIR /src

# Dependencies before source, so an edit to a .go file does not invalidate
# the module download layer.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0: a static binary that needs nothing from the final image's
# (nonexistent) libc. -trimpath removes the builder's absolute paths from
# the binary; -s -w drops the symbol table and DWARF info, neither of which
# a running service needs and both of which make a stolen binary easier to
# reverse.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/ledger ./cmd/ledger

# The healthcheck probe. Pulled in as a named build context (see
# docker-compose.yml's `additional_contexts: healthcheck: ../../infra/healthcheck`)
# rather than copied into this service's own tree — see infra/healthcheck's
# package comment for why it lives there instead of here.
FROM golang:1.26.8-alpine3.24 AS healthcheck-builder
WORKDIR /hc
COPY --from=healthcheck . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/healthcheck .

# distroless/static: no shell, no package manager, no libc — there is
# nothing in this image for a compromised process to do besides be the
# ledger binary and the healthcheck probe. Pinned by digest rather than the
# "nonroot" tag alone, because a tag can move under a name that looks fixed.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab

# The distroless "nonroot" variant already runs as uid/gid 65532 with no
# root account to fall back to — nothing to add here.
COPY --from=builder /out/ledger /usr/local/bin/ledger
COPY --from=healthcheck-builder /out/healthcheck /usr/local/bin/healthcheck

EXPOSE 3010

ENTRYPOINT ["/usr/local/bin/ledger"]
