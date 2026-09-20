// Command healthcheck is a dependency-free HTTP probe for Docker
// HEALTHCHECK, built for services whose final image is distroless and has
// no shell, curl or wget to run one with.
//
// It lives here, under infra/, rather than inside either Go service's own
// module, for a reason specific to this pass: services/ledger and
// services/voucher each need one, but services/voucher's .go files are
// owned by another change in flight right now, so a healthcheck binary that
// lived inside services/voucher/cmd could not be added there without
// touching files this change must not touch. One shared, service-agnostic
// probe under infra/ needs adding in exactly one place, and both
// Dockerfiles pull it in as a named build context (see
// docker-compose.yml's `additional_contexts`) rather than duplicating it.
//
// It does the least a healthcheck can do: GET a URL, and exit 0 only on
// HTTP 200. Nothing here is service-specific — the URL, including which
// path counts as "healthy", is the caller's decision, passed on the command
// line.
package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: healthcheck <url>")
		os.Exit(2)
	}

	// A healthcheck that can hang is worse than one that fails fast: Docker
	// already bounds it with the compose `timeout`, but a probe with no
	// timeout of its own depends entirely on that external bound being
	// right, and a probe that names its own budget stays correct even if
	// compose's does not.
	client := &http.Client{Timeout: 2 * time.Second}

	resp, err := client.Get(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck: request failed:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: unhealthy status", resp.StatusCode)
		os.Exit(1)
	}
}
