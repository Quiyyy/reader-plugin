//go:build !windows

package main

import "syscall"

func execute(node, script string, env []string) error {
	return syscall.Exec(node, []string{node, script}, env)
}
