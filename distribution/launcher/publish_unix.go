//go:build !windows

package main

import "os"

// Both names are in the same cache directory. Link atomically refuses an
// existing destination; the caller removes its own temporary name afterward.
func publishNode(temporary, target string) error {
	return os.Link(temporary, target)
}

func openForVerification(path string) (*os.File, error) { return os.Open(path) }
