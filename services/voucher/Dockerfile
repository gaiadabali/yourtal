# The voucher service image. docs/15's Phase 1 deployable #2.
#
# Same shape as services/ledger/Dockerfile and for the same reasons: a
# multi-stage build so the toolchain never reaches the runtime image, and a
# distroless final stage so a compromised process has no shell to pivot
# from. See that file for the longer version of each comment below.
#
# The master keyring is NOT baked into this image — see docker-compose.yml's
# voucher service for how VOUCHER_KEY_DIR is mounted at runtime instead, and
# why internal/keyring refuses to load a key that lives inside a git working
# tree (baking one into a layer would be exactly that, plus distributed to
# every pull).
FROM golang:1.27.1-alpine3.24@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/voucher ./cmd/voucher

# The healthcheck probe. It cannot live inside services/voucher's own tree
# right now — this pass may not touch a .go file under services/voucher,
# another agent owns that tree's HTTP layer — so it is pulled in as a named
# build context instead; see infra/healthcheck's package comment and
# docker-compose.yml's `additional_contexts` for this service.
FROM golang:1.27.1-alpine3.24@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS healthcheck-builder
WORKDIR /hc
COPY --from=healthcheck . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/healthcheck .

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab

COPY --from=builder /out/voucher /usr/local/bin/voucher
COPY --from=healthcheck-builder /out/healthcheck /usr/local/bin/healthcheck

EXPOSE 3011

ENTRYPOINT ["/usr/local/bin/voucher"]
