package catalog

import (
	"context"
	"testing"
	"time"
)

func TestDiary(t *testing.T) {
	p := newTestPlatform(t, nil)
	ctx := context.Background()
	a, b := testMovie(1), testMovie(2)
	addLocal(t, p, a, "COMPLETED", 1)
	p.db.SetCache(liteKey(b.ID), b, time.Hour)

	mine, added, err := p.AddDiary(ctx, DiaryEntry{MediaID: a.ID, WatchedDate: "2020-10-01", Rating: 90, Liked: true})
	if err != nil || !added || mine.ID == 0 || mine.Source != DiaryKumoBox || mine.Media == nil || mine.Media.ID != a.ID {
		t.Fatalf("logged: %+v %v %v", mine, added, err)
	}
	imported := DiaryEntry{MediaID: b.ID, WatchedDate: "2020-09-12", Rating: 70, Rewatch: true, Review: "Again!", Tags: "cinema",
		Source: DiaryLetterboxd, LetterboxdID: "letterboxd-review-123"}
	got, added, err := p.AddDiary(ctx, imported)
	if err != nil || !added {
		t.Fatalf("imported: %v %v", added, err)
	}
	// Imported again (the next sync): kept once.
	again, added, err := p.AddDiary(ctx, imported)
	if err != nil || added || again.ID != got.ID || again.Review != "Again!" || again.Media == nil {
		t.Fatalf("imported again: %+v %v %v", again, added, err)
	}
	today, _, err := p.AddDiary(ctx, DiaryEntry{MediaID: a.ID, Rewatch: true})
	if err != nil || today.WatchedDate != time.Now().Format(time.DateOnly) {
		t.Fatalf("today: %+v %v", today, err)
	}
	if _, _, err := p.AddDiary(ctx, DiaryEntry{}); err == nil {
		t.Fatal("logged a viewing of nothing")
	}

	all, err := p.Diary(ctx, 0, 0)
	if err != nil || len(all) != 3 || all[0].ID != today.ID || all[1].ID != mine.ID || all[2].ID != got.ID {
		t.Fatalf("diary: %+v %v", all, err)
	}
	if all[2].Media == nil || all[2].Media.ID != b.ID || !all[2].Rewatch || all[2].Tags != "cinema" || all[2].Rating != 70 {
		t.Errorf("imported entry: %+v", all[2])
	}
	if ofA, _ := p.Diary(ctx, a.ID, 1); len(ofA) != 1 || ofA[0].ID != today.ID {
		t.Errorf("latest of a: %+v", ofA)
	}

	pending, err := p.PendingDiary(ctx)
	if err != nil || len(pending) != 2 || pending[0].ID != mine.ID || pending[1].ID != today.ID {
		t.Fatalf("pending: %+v %v", pending, err)
	}
	if err := p.MarkDiaryExported(ctx, []int64{mine.ID}, 1_800_000_000); err != nil {
		t.Fatal(err)
	}
	if pending, _ := p.PendingDiary(ctx); len(pending) != 1 || pending[0].ID != today.ID {
		t.Fatalf("pending after exporting: %+v", pending)
	}
	if err := p.RateDiary(ctx, today.ID, 150, true); err != nil {
		t.Fatal(err)
	}
	if ofA, _ := p.Diary(ctx, a.ID, 1); len(ofA) != 1 || ofA[0].Rating != 100 || !ofA[0].Liked || !ofA[0].Rewatch {
		t.Errorf("rated: %+v", ofA)
	}
	if err := p.DeleteDiary(ctx, today.ID); err != nil {
		t.Fatal(err)
	}
	if err := p.DeleteDiary(ctx, today.ID); err != nil {
		t.Fatalf("deleting twice: %v", err)
	}
	if all, _ := p.Diary(ctx, 0, 0); len(all) != 2 || all[0].ExportedAt != 1_800_000_000 {
		t.Fatalf("after deleting: %+v", all)
	}
}
