// Package ledgerpost drains voucher.capture_outbox into the ledger (4.6.f.2).
// It runs inside this service because the outbox lives in the voucher
// schema, which no other process can read. Each row is posted over signed
// HTTP as the "voucher" caller, keyed on its capture id, and marked posted
// only after a 2xx: a lost reply is re-sent and the ledger replays it.
package ledgerpost

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/serviceauth"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// Caller is the id this service signs ledger calls with.
const Caller = "voucher"

const batchSize = 100

// Poster posts outbox rows to the ledger at baseURL.
type Poster struct {
	pool    *pgxpool.Pool
	baseURL string
	secret  []byte
	client  *http.Client
	logger  *slog.Logger
	now     func() time.Time
}

func New(pool *pgxpool.Pool, baseURL string, secret []byte, logger *slog.Logger) (*Poster, error) {
	if baseURL == "" {
		return nil, errors.New("ledgerpost: no ledger base URL")
	}
	if len(secret) < serviceauth.MinSecretBytes {
		return nil, fmt.Errorf("ledgerpost: the ledger secret must be at least %d bytes", serviceauth.MinSecretBytes)
	}
	return &Poster{
		pool: pool, baseURL: strings.TrimRight(baseURL, "/"), secret: secret,
		client: &http.Client{Timeout: 10 * time.Second}, logger: logger, now: time.Now,
	}, nil
}

// errRefused is a 4xx: this row is wrong, not the ledger down. It stays
// unposted and is logged every pass, without holding up the rows behind it.
var errRefused = errors.New("ledgerpost: the ledger refused the capture")

// DrainOnce posts up to one batch of unposted captures and returns how many
// it marked posted. A down ledger stops the pass at the first failure; the
// rest wait for the next pass.
func (p *Poster) DrainOnce(ctx context.Context) (int, error) {
	queries := sqlcgen.New(p.pool)
	rows, err := queries.ListUnpostedCaptureOutbox(ctx, batchSize)
	if err != nil {
		return 0, fmt.Errorf("reading the capture outbox: %w", err)
	}
	posted := 0
	for _, row := range rows {
		if err := p.post(ctx, row); errors.Is(err, errRefused) {
			p.logger.Error("the ledger refused a capture; it stays in the outbox", "error", err)
			continue
		} else if err != nil {
			return posted, err
		}
		if _, err := queries.MarkCaptureOutboxPosted(ctx, row.CaptureID); err != nil {
			return posted, fmt.Errorf("marking capture %s posted: %w", uuidString(row.CaptureID), err)
		}
		posted++
	}
	return posted, nil
}

// Run drains every interval until ctx ends. Errors are logged, never fatal:
// the outbox keeps every row until the ledger confirms it.
func (p *Poster) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		posted, err := p.DrainOnce(ctx)
		if err != nil {
			p.logger.Error("posting captures to the ledger failed; retrying next pass", "error", err)
		} else if posted > 0 {
			p.logger.Info("posted captures to the ledger", "count", posted)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (p *Poster) post(ctx context.Context, row sqlcgen.ListUnpostedCaptureOutboxRow) error {
	captureID := uuidString(row.CaptureID)
	body, err := json.Marshal(map[string]any{
		"captureId": captureID, "region": row.Region, "merchantId": uuidString(row.MerchantID),
		"amountMinor": row.AmountMinor, "currency": row.Currency,
	})
	if err != nil {
		return err
	}
	status, answer, err := p.signedPost(ctx, "/v1/captures", body)
	if err != nil {
		return fmt.Errorf("posting capture %s: %w", captureID, err)
	}
	if status >= 400 && status < 500 {
		return fmt.Errorf("%w: %s answered %d %s", errRefused, captureID, status, answer)
	}
	if status < 200 || status > 299 {
		return fmt.Errorf("posting capture %s: the ledger answered %d %s", captureID, status, answer)
	}
	return nil
}

func (p *Poster) signedPost(ctx context.Context, path string, body []byte) (int, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(serviceauth.Header, serviceauth.Sign(p.secret, Caller, nonce(), http.MethodPost, path, body, p.now()))
	res, err := p.client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer res.Body.Close()
	answer, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	return res.StatusCode, string(answer), nil
}

func nonce() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func uuidString(id pgtype.UUID) string {
	b := id.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
