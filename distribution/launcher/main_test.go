package main

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

func fixture(t *testing.T) (string, string, payload, []byte) {
	t.Helper()
	root := t.TempDir()
	data := filepath.Join(t.TempDir(), "中文 数据")
	if err := os.MkdirAll(filepath.Join(root, "payload"), 0700); err != nil {
		t.Fatal(err)
	}
	raw := bytes.Repeat([]byte("synthetic runtime bytes, no executable code\n"), 100)
	var compressed bytes.Buffer
	z := gzip.NewWriter(&compressed)
	_, _ = z.Write(raw)
	_ = z.Close()
	if err := os.WriteFile(filepath.Join(root, "payload/node.gz"), compressed.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	p := payload{GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, NodeSHA256: digest(raw), NodeBytes: int64(len(raw)), CompressedSHA256: digest(compressed.Bytes())}
	return root, data, p, raw
}

func TestConcurrentMaterializationAndTamperedCachePreservation(t *testing.T) {
	root, data, p, raw := fixture(t)
	var group sync.WaitGroup
	paths := make(chan string, 8)
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			path, err := materializeNode(root, data, p)
			if err != nil {
				t.Error(err)
			} else {
				paths <- path
			}
		}()
	}
	group.Wait()
	close(paths)
	var target string
	for path := range paths {
		if target != "" && target != path {
			t.Fatal("cache identity changed")
		}
		target = path
	}
	if target == "" {
		t.Fatal("no cache produced")
	}
	actual, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(actual, raw) {
		t.Fatal("runtime bytes changed")
	}
	entries, _ := os.ReadDir(filepath.Dir(target))
	if len(entries) != 1 {
		t.Fatalf("temporary files leaked: %d", len(entries))
	}
	if err := os.WriteFile(target, []byte("unknown existing content"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := materializeNode(root, data, p); err == nil {
		t.Fatal("tampered cache accepted")
	}
	actual, _ = os.ReadFile(target)
	if string(actual) != "unknown existing content" {
		t.Fatal("unknown cache overwritten")
	}
}

func TestCorruptAndOverlongPayloadNeverActivates(t *testing.T) {
	for _, mode := range []string{"compressed", "inflated-size", "inflated-hash"} {
		t.Run(mode, func(t *testing.T) {
			root, data, p, _ := fixture(t)
			switch mode {
			case "compressed":
				_ = os.WriteFile(filepath.Join(root, "payload/node.gz"), []byte("damaged"), 0600)
			case "inflated-size":
				p.NodeBytes--
			case "inflated-hash":
				p.NodeSHA256 = digest([]byte("wrong expected binary"))
			}
			if _, err := materializeNode(root, data, p); err == nil {
				t.Fatal("corrupt payload accepted")
			}
			entries, _ := os.ReadDir(filepath.Join(data, "reader-node-cache"))
			if len(entries) != 0 {
				t.Fatalf("invalid cache or temporary bytes activated: %d", len(entries))
			}
		})
	}
}

func TestPathsAndCacheSymlinksAreRejected(t *testing.T) {
	root, data, p, _ := fixture(t)
	for _, name := range []string{"../escape", "payload/../node.gz", "/absolute", "payload\\node.gz"} {
		if _, err := contained(root, name); err == nil {
			t.Fatalf("unsafe path accepted: %s", name)
		}
	}
	if err := os.MkdirAll(data, 0700); err != nil {
		t.Fatal(err)
	}
	other := t.TempDir()
	if err := os.Symlink(other, filepath.Join(data, "reader-node-cache")); err != nil {
		t.Skipf("OS did not grant symlink creation: %v", err)
	}
	if _, err := materializeNode(root, data, p); err == nil {
		t.Fatal("symlink cache accepted")
	}
	entries, _ := os.ReadDir(other)
	if len(entries) != 0 {
		t.Fatal("symlink target modified")
	}
}
