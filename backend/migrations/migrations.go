package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.up.sql
var files embed.FS

// Apply serializes migration runners and commits each version exactly once.
func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	connection, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer connection.Release()
	if _, err = connection.Exec(ctx, "SELECT pg_advisory_lock(734105821)"); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	defer connection.Exec(context.Background(), "SELECT pg_advisory_unlock(734105821)")

	_, err = connection.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
    )`)
	if err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	names, err := fs.Glob(files, "*.up.sql")
	if err != nil {
		return err
	}
	for _, name := range names {
		contents, err := files.ReadFile(name)
		if err != nil {
			return err
		}
		checksum := fmt.Sprintf("%x", sha256.Sum256(contents))
		var savedChecksum string
		var applied bool
		err = connection.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1),
            COALESCE((SELECT checksum FROM schema_migrations WHERE version = $1), '')`, name).Scan(&applied, &savedChecksum)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		if applied {
			if savedChecksum != checksum {
				return fmt.Errorf("applied migration %s was modified", name)
			}
			continue
		}
		transaction, err := connection.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}
		if _, err = transaction.Exec(ctx, string(contents)); err == nil {
			_, err = transaction.Exec(ctx, "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", name, checksum)
		}
		if err != nil {
			transaction.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if err = transaction.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}
	return nil
}
