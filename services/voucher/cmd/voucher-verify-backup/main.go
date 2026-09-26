// Command voucher-verify-backup is the proof step of a restore rehearsal
// (2.3.c, old YT-0531): does the keyring in THIS backup actually open the
// voucher codes in THIS restored database. Row-count and checksum checks
// (infra/helios/restore-rehearsal.sh) prove the backup is intact; this
// proves it is USABLE.
//
// It never prints a code or a key — only counts, on purpose: a rehearsal
// script's stdout tends to end up in a log somewhere, and a decrypted
// voucher code in a log is the exact leak the envelope encryption in
// internal/keyring exists to prevent.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/verify"
)

// How many sealed codes to sample. A rehearsal proves the keyring generation
// pairs with the dump generation; it does not need to open every row to do
// that, and a production database can hold far more than is worth reading
// on every nightly run.
const sampleLimit = 20

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "voucher-verify-backup:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	flags := flag.NewFlagSet("voucher-verify-backup", flag.ContinueOnError)
	allowEmpty := flags.Bool("allow-empty", false,
		"pass even if there are zero sealed voucher codes to check (e.g. staging before the first voucher)")
	if err := flags.Parse(args); err != nil {
		return err
	}

	dbURL := os.Getenv("VERIFY_DATABASE_URL")
	if dbURL == "" {
		return fmt.Errorf("no VERIFY_DATABASE_URL (the restored database's owner connection string)")
	}
	keyDir := os.Getenv("VERIFY_KEY_DIR")
	if keyDir == "" {
		return fmt.Errorf("no VERIFY_KEY_DIR (the extracted backup keyring's directory)")
	}

	// Same purposes cmd/voucher requires at boot (main.go's loadKeys): a
	// keyring backup missing the merchant-HMAC or QR key is exactly as
	// incomplete as one missing the voucher-code key, even though only the
	// voucher-code key is exercised below.
	keys, err := keyring.FromDirectory(keyDir)
	if err != nil {
		return err
	}
	if err := keys.RequirePurposes(
		keyring.PurposeVoucherCode, keyring.PurposeMerchantHMAC, keyring.PurposeVoucherQR,
	); err != nil {
		return err
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return fmt.Errorf("connecting: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("database unreachable: %w", err)
	}

	result, err := verify.Backup(ctx, pool, keys, sampleLimit, *allowEmpty)
	if err != nil {
		return err
	}

	fmt.Printf("opened %d/%d\n", result.Opened, result.Total)
	if result.Opened != result.Total {
		return fmt.Errorf("%d of %d sealed codes failed to open — the backup and the keyring do not pair",
			result.Total-result.Opened, result.Total)
	}
	return nil
}
