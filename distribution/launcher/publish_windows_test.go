package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func exclusiveHandle(t *testing.T, path string) syscall.Handle {
	t.Helper()
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := syscall.CreateFile(name, syscall.GENERIC_READ, 0, nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	return handle
}

func TestVerificationWaitsForTransientSharingLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runtime.exe")
	raw := []byte("verified bytes")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	handle := exclusiveHandle(t, path)
	result := make(chan error, 1)
	go func() { result <- verifyFile(path, digest(raw), int64(len(raw))) }()
	select {
	case err := <-result:
		syscall.CloseHandle(handle)
		t.Fatalf("verification returned before the sharing lock was released: %v", err)
	case <-time.After(60 * time.Millisecond):
	}
	if err := syscall.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if err := verifyFile(path, digest([]byte("different bytes")), int64(len(raw))); err == nil {
		t.Fatal("hash mismatch accepted")
	}
}

func TestVerificationSharingWaitIsBounded(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runtime.exe")
	if err := os.WriteFile(path, []byte("bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	handle := exclusiveHandle(t, path)
	defer syscall.CloseHandle(handle)
	started := time.Now()
	if _, err := openForVerification(path); err == nil {
		t.Fatal("exclusive lock ignored")
	}
	if elapsed := time.Since(started); elapsed < time.Second || elapsed > 3*time.Second {
		t.Fatalf("sharing deadline not enforced: %v", elapsed)
	}
}
