// Reader's offline runtime launcher uses only the Go standard library.
// It never installs packages, downloads code, edits host configuration or migrates books.
package main

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Injected by the maintainer build after the payload manifest is finalized.
var manifestSHA string

type payload struct {
	Version          string            `json:"version"`
	GOOS             string            `json:"goos"`
	GOARCH           string            `json:"goarch"`
	NodeVersion      string            `json:"nodeVersion"`
	NodeSHA256       string            `json:"nodeSha256"`
	NodeBytes        int64             `json:"nodeBytes"`
	CompressedSHA256 string            `json:"compressedSha256"`
	Files            map[string]string `json:"files"`
}

func digest(bytes []byte) string { h := sha256.Sum256(bytes); return hex.EncodeToString(h[:]) }

func verifyFile(path, expected string, size int64) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || (size >= 0 && info.Size() != size) {
		return fmt.Errorf("unexpected file type or size: %s", path)
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != expected {
		return fmt.Errorf("checksum mismatch: %s", path)
	}
	return nil
}

func contained(root, name string) (string, error) {
	if name == "" || strings.Contains(name, "\\") || filepath.IsAbs(name) {
		return "", errors.New("invalid payload path")
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("unsafe payload path")
		}
	}
	path := root
	for _, part := range strings.Split(name, "/") {
		path = filepath.Join(path, part)
		info, err := os.Lstat(path)
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("payload symlink is not allowed: %s", path)
		}
	}
	return path, nil
}

func readPayload(root string) (payload, error) {
	var p payload
	path, err := contained(root, "runtime-manifest.json")
	if err != nil {
		return p, err
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return p, err
	}
	if len(manifestSHA) != 64 || digest(bytes) != manifestSHA {
		return p, errors.New("package manifest does not match this launcher")
	}
	if err = json.Unmarshal(bytes, &p); err != nil {
		return p, err
	}
	if p.GOOS != runtime.GOOS || p.GOARCH != runtime.GOARCH {
		return p, errors.New("this Reader package targets a different operating system or architecture")
	}
	if p.NodeBytes < 1 || p.NodeBytes > 256*1024*1024 || len(p.NodeSHA256) != 64 {
		return p, errors.New("invalid pinned runtime metadata")
	}
	for name, expected := range p.Files {
		path, err := contained(root, name)
		if err != nil {
			return p, err
		}
		if err = verifyFile(path, expected, -1); err != nil {
			return p, err
		}
	}
	return p, nil
}

func materializeNode(root, data string, p payload) (string, error) {
	if !filepath.IsAbs(data) {
		return "", errors.New("the host must provide an absolute PLUGIN_DATA directory")
	}
	cache := filepath.Join(data, "reader-node-cache")
	if err := os.MkdirAll(cache, 0700); err != nil {
		return "", err
	}
	info, err := os.Lstat(cache)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("runtime cache is not a regular directory")
	}
	name := "node-" + p.NodeSHA256
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(cache, name)
	if _, err := os.Lstat(path); err == nil {
		if err = verifyFile(path, p.NodeSHA256, p.NodeBytes); err != nil {
			return "", fmt.Errorf("existing Reader runtime cache is damaged; it was not overwritten: %w", err)
		}
		return path, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	compressed, err := contained(root, "payload/node.gz")
	if err != nil {
		return "", err
	}
	if err = verifyFile(compressed, p.CompressedSHA256, -1); err != nil {
		return "", err
	}
	source, err := os.Open(compressed)
	if err != nil {
		return "", err
	}
	defer source.Close()
	z, err := gzip.NewReader(source)
	if err != nil {
		return "", err
	}
	defer z.Close()
	temporary, err := os.CreateTemp(cache, ".reader-node-*")
	if err != nil {
		return "", err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	defer temporary.Close()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(temporary, h), io.LimitReader(z, p.NodeBytes+1))
	if err != nil {
		return "", err
	}
	if n != p.NodeBytes || hex.EncodeToString(h.Sum(nil)) != p.NodeSHA256 {
		return "", errors.New("bundled Node bytes do not match the pinned upstream executable")
	}
	if err = z.Close(); err != nil {
		return "", err
	}
	if err = temporary.Sync(); err != nil {
		return "", err
	}
	if err = temporary.Chmod(0700); err != nil {
		return "", err
	}
	if err = temporary.Close(); err != nil {
		return "", err
	}
	// Concurrent first launches may both prepare the same immutable bytes.
	if _, err = os.Lstat(path); err == nil {
		if err = verifyFile(path, p.NodeSHA256, p.NodeBytes); err != nil {
			return "", err
		}
		return path, nil
	}
	if err = os.Rename(temporaryName, path); err != nil {
		if verifyFile(path, p.NodeSHA256, p.NodeBytes) == nil {
			return path, nil
		}
		return "", err
	}
	return path, nil
}

func run() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Dir(executable)
	p, err := readPayload(root)
	if err != nil {
		return err
	}
	node, err := materializeNode(root, os.Getenv("PLUGIN_DATA"), p)
	if err != nil {
		return err
	}
	if len(os.Args) == 2 && os.Args[1] == "--runtime-info" {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"version": p.Version, "nodeVersion": p.NodeVersion, "goos": runtime.GOOS, "goarch": runtime.GOARCH, "node": node, "nodeSha256": p.NodeSHA256})
	}
	if len(os.Args) != 1 {
		return errors.New("unsupported Reader launcher arguments")
	}
	// Preserve the existing Reader data-directory contract. PLUGIN_DATA is only a
	// disposable executable cache, never the library. An explicit READER_DATA_DIR
	// remains supported; otherwise the unchanged server selects the OS data path.
	env := []string{}
	for _, value := range os.Environ() {
		key := strings.ToUpper(strings.SplitN(value, "=", 2)[0])
		if key != "NODE_OPTIONS" && key != "NODE_PATH" {
			env = append(env, value)
		}
	}
	env = append(env, "NODE_OPTIONS=", "NODE_PATH=")
	return execute(node, filepath.Join(root, "app", "dist", "server", "index.js"), env)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Reader cannot start:", err)
		os.Exit(1)
	}
}
