package proof

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// RootStore is 10.3.a's "append-only store outside the database": the
// day's root is written a SECOND place, so a tamper that also rewrites
// ledger.daily_proof (e.g. a superuser editing the one place the app itself
// cannot) still leaves an outside copy VerifyExternalStore can catch. A
// no-op store (nil) is valid — the database's own INSERT-only grant is
// still the primary defence — but wiring one is what 10.3.a asks for.
type RootStore interface {
	// Append writes one day's root. ErrRootAlreadyStored if that day is
	// already there — like the database, a day's root may be written once.
	Append(ctx context.Context, day time.Time, root string) error
	// Read answers a day's previously-stored root, or ErrRootNotStored.
	Read(ctx context.Context, day time.Time) (string, error)
}

// ErrRootAlreadyStored — the store already has a root for this day.
var ErrRootAlreadyStored = errors.New("proof: a root is already stored for this day")

// ErrRootNotStored — no root has been stored for this day.
var ErrRootNotStored = errors.New("proof: no root is stored for this day")

// FileRootStore is the simulated driver (CLAUDE.md: "everything external is
// a simulated driver"): a real filesystem, but not the database, and
// append-only by construction — O_EXCL refuses to open a file that already
// exists, so writing a day twice is a write error, never a silent
// overwrite. A durable object store (S3/MinIO) is a drop-in replacement
// behind the same two methods; nothing above this file would change.
type FileRootStore struct {
	Dir string
}

func NewFileRootStore(dir string) FileRootStore {
	return FileRootStore{Dir: dir}
}

type rootRecord struct {
	Date string `json:"date"`
	Root string `json:"root"`
}

func (s FileRootStore) path(day time.Time) string {
	return filepath.Join(s.Dir, startOfDay(day).Format(time.DateOnly)+".json")
}

func (s FileRootStore) Append(_ context.Context, day time.Time, root string) error {
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return fmt.Errorf("proof: creating the root store directory: %w", err)
	}
	file, err := os.OpenFile(s.path(day), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return fmt.Errorf("%w: %s", ErrRootAlreadyStored, startOfDay(day).Format(time.DateOnly))
		}
		return fmt.Errorf("proof: opening the root store file: %w", err)
	}
	defer file.Close()
	return json.NewEncoder(file).Encode(rootRecord{Date: startOfDay(day).Format(time.DateOnly), Root: root})
}

func (s FileRootStore) Read(_ context.Context, day time.Time) (string, error) {
	data, err := os.ReadFile(s.path(day))
	if errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("%w: %s", ErrRootNotStored, startOfDay(day).Format(time.DateOnly))
	}
	if err != nil {
		return "", fmt.Errorf("proof: reading the root store file: %w", err)
	}
	var record rootRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return "", fmt.Errorf("proof: the root store file is corrupt: %w", err)
	}
	return record.Root, nil
}
