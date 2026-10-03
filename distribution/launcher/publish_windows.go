package main

import (
	"errors"
	"os"
	"syscall"
	"time"
)

// MoveFileW fails if the destination already exists. Unlike os.Rename's
// replacement semantics, it never swaps a cache file another process opened.
func publishNode(temporary, target string) error {
	from, err := syscall.UTF16PtrFromString(temporary)
	if err != nil {
		return err
	}
	to, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return syscall.MoveFile(from, to)
}

// A rename can expose the destination name before Windows releases its
// temporary sharing lock. Retry only sharing/lock violations, for at most one
// second. A permission error, missing file or failed hash remains a hard error.
func openForVerification(path string) (*os.File, error) {
	deadline := time.Now().Add(time.Second)
	for {
		file, err := os.Open(path)
		if err == nil || (!errors.Is(err, syscall.Errno(32)) && !errors.Is(err, syscall.Errno(33))) || !time.Now().Before(deadline) {
			return file, err
		}
		time.Sleep(10 * time.Millisecond)
	}
}
