// Package verify is the proof step of a backup rehearsal (2.3.c): does this
// keyring actually open the sealed voucher codes in this database. It reads
// ciphertext and opens it in memory; it never returns a code or a key, only
// counts — the one thing a restore rehearsal is allowed to print.
package verify

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/keyring"
)

// ErrNoSealedCodes — the table this queries has nothing in it. A restore
// rehearsal that "passes" having opened zero codes has proven nothing, so
// this is the caller's decision to make explicit (--allow-empty), not a
// silent default.
var ErrNoSealedCodes = errors.New("verify: no sealed voucher codes to check")

// Result is deliberately count-only.
type Result struct {
	Opened int
	Total  int
}

// Backup opens up to limit sealed voucher codes from voucher.code_custody
// with keys, newest first — the codes most likely to matter to whoever is
// running this rehearsal are the ones the live service minted most
// recently, not whatever happened to be minted first in the table's
// history.
//
// A row that fails to open (wrong keyring generation, a truncated field, a
// purpose/version this keyring does not hold) is counted, not treated as a
// query error — Result.Opened < Result.Total is exactly the signal a
// restore rehearsal exists to surface, and the caller decides what to do
// with it.
func Backup(
	ctx context.Context, pool *pgxpool.Pool, keys *keyring.Keyring, limit int, allowEmpty bool,
) (Result, error) {
	rows, err := pool.Query(ctx, `
		SELECT wrapped_data_key, nonce, ciphertext, key_purpose, key_version
		FROM voucher.code_custody
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return Result{}, fmt.Errorf("verify: querying code_custody: %w", err)
	}
	defer rows.Close()

	var result Result
	for rows.Next() {
		var wrapped, nonce, ciphertext []byte
		var purpose string
		var version int32
		if err := rows.Scan(&wrapped, &nonce, &ciphertext, &purpose, &version); err != nil {
			return Result{}, fmt.Errorf("verify: scanning a row: %w", err)
		}
		result.Total++

		_, openErr := keys.Open(keyring.PurposeVoucherCode, keyring.Sealed{
			WrappedDataKey: wrapped,
			Nonce:          nonce,
			Ciphertext:     ciphertext,
			Purpose:        keyring.Purpose(purpose),
			Version:        int(version),
		})
		if openErr == nil {
			result.Opened++
		}
	}
	if err := rows.Err(); err != nil {
		return Result{}, fmt.Errorf("verify: reading rows: %w", err)
	}

	if err := emptyCheck(result.Total, allowEmpty); err != nil {
		return result, err
	}
	return result, nil
}

// emptyCheck is split out so the empty-table refusal has a test that needs
// no database: a live rehearsal database always holds seed or real data, so
// a DB-backed test can only ever exercise the non-empty path.
func emptyCheck(total int, allowEmpty bool) error {
	if total == 0 && !allowEmpty {
		return ErrNoSealedCodes
	}
	return nil
}
