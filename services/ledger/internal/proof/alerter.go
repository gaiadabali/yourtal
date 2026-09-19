package proof

import (
	"context"
	"log/slog"
)

// LoggingAlerter is the PLACEHOLDER pager, until YT-0027 wires Grafana and
// PagerDuty.
//
// Named for what it is. YT-0044's acceptance criterion is that an imbalance
// "pages a human; it does not merely log" — and this merely logs. Calling it
// `DefaultAlerter` or `Alerter` would let it pass for the real thing in a
// wiring diagram, and a placeholder that reads as finished is one nobody
// replaces.
//
// It logs at ERROR with a fixed message so an alerting rule can match on it
// the moment one exists, which is the most a log line can honestly do.
type LoggingAlerter struct {
	Logger *slog.Logger
}

// Page writes the incident and returns nil — it cannot fail, which is itself
// the reason this is not good enough: a pager that cannot fail is a pager
// that cannot tell you it did not reach anyone.
func (a LoggingAlerter) Page(_ context.Context, summary, detail string) error {
	a.Logger.Error("LEDGER INVARIANT VIOLATED — no pager configured (YT-0027)",
		"summary", summary, "detail", detail)
	return nil
}
