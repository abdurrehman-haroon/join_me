package migrations

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestEventsMigrationPreservesLegacyReferences(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TEST_DATABASE_URL to run PostGIS migration checks")
	}
	ctx := context.Background()
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(ctx)
	transaction, err := connection.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer transaction.Rollback(ctx)

	// The entire legacy upgrade is rolled back, including its isolated schema.
	schema := pgx.Identifier{fmt.Sprintf("events_test_%d", time.Now().UnixNano())}.Sanitize()
	if _, err = transaction.Exec(ctx, "CREATE SCHEMA "+schema+"; SET LOCAL search_path TO "+schema+",public; CREATE TABLE schema_migrations(version text PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	names, err := fs.Glob(files, "*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		if name >= "000007_events.up.sql" {
			break
		}
		contents, err := files.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = transaction.Exec(ctx, string(contents)); err != nil {
			t.Fatalf("apply %s: %v", name, err)
		}
	}
	_, err = transaction.Exec(ctx, `
        INSERT INTO users(id,display_name) VALUES
            ('40000000-0000-4000-8000-000000000001','Legacy host'),
            ('40000000-0000-4000-8000-000000000002','Legacy member');
        INSERT INTO pins(id,host_id,campus_id,sport,ground_name,location,kickoff_at,expires_at,capacity,visibility)
            VALUES ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
                'LUMS','football','Legacy ground',ST_SetSRID(ST_Point(74.41,31.47),4326)::geography,
                now()-interval '2 days',now()-interval '1 day',10,'campus');
        INSERT INTO pin_members(pin_id,user_id) VALUES
            ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002');
        INSERT INTO messages(id,pin_id,user_id,body) VALUES
            ('60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
                '40000000-0000-4000-8000-000000000002','Legacy message');`)
	if err != nil {
		t.Fatal(err)
	}
	contents, err := files.ReadFile("000007_events.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = transaction.Exec(ctx, string(contents)); err != nil {
		t.Fatal(err)
	}

	var preserved bool
	err = transaction.QueryRow(ctx, `SELECT
        events.title='Legacy ground' AND events.type='football' AND status.slug='completed'
        AND places.name='Legacy ground' AND ST_X(places.location)=74.41 AND ST_Y(places.location)=31.47
        AND places.area_id='00000000-0000-4000-8000-000000000001'
        AND (SELECT count(*) FROM event_participants WHERE event_id=events.id)=2
        AND EXISTS (SELECT 1 FROM messages WHERE event_id=events.id AND body='Legacy message')
        FROM events JOIN places ON places.id=events.place_id JOIN status ON status.id=events.status_id
        WHERE events.id='50000000-0000-4000-8000-000000000001'`).Scan(&preserved)
	if err != nil || !preserved {
		t.Fatalf("legacy event references/location not preserved: %v", err)
	}
}
