package main

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// The existing concurrency test exercises real filesystem publication. Inject
// exact Windows errors here so retry coverage does not depend on whether a CI
// filesystem/driver enforces an in-process CreateFile sharing-lock fixture.
func TestVerificationRetriesOnlySharingViolations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runtime.exe")
	raw := []byte("verified bytes")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	file, err := openWithSharingRetry(func() (*os.File, error) {
		calls++
		if calls <= 2 {
			return nil, &os.PathError{Op: "open", Path: path, Err: syscall.Errno(31 + calls)}
		}
		return os.Open(path)
	}, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if file == nil {
		t.Fatal("no verified file handle")
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("sharing errors not retried: %d", calls)
	}
	if err := verifyFile(path, digest([]byte("different bytes")), int64(len(raw))); err == nil {
		t.Fatal("hash mismatch accepted")
	}
	for _, terminal := range []error{os.ErrPermission, os.ErrNotExist, syscall.Errno(5)} {
		calls = 0
		_, err := openWithSharingRetry(func() (*os.File, error) { calls++; return nil, terminal }, time.Second)
		if !errors.Is(err, terminal) || calls != 1 {
			t.Fatalf("non-sharing error retried or hidden: %v, %d", err, calls)
		}
	}
}

func TestVerificationSharingWaitIsBounded(t *testing.T) {
	calls := 0
	started := time.Now()
	_, err := openWithSharingRetry(func() (*os.File, error) { calls++; return nil, syscall.Errno(32) }, 30*time.Millisecond)
	if !errors.Is(err, syscall.Errno(32)) || calls < 2 {
		t.Fatalf("sharing failure not preserved: %v, %d", err, calls)
	}
	if elapsed := time.Since(started); elapsed < 30*time.Millisecond || elapsed > time.Second {
		t.Fatalf("sharing deadline not enforced: %v", elapsed)
	}
}
