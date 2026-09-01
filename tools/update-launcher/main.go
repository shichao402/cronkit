// cronkit 的稳定 Windows launcher。
//
// 它只做一件事：读取安装根的 active.json，校验目标仍在安装根内，然后把参数
// 原样转发给当前版本。launcher 随版本包放在根目录，实际 Electron 应用放在
// versions/<version>/，因此升级时不会被运行中的应用锁住。
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type activePointer struct {
	Code       int    `json:"code"`
	Version    string `json:"version"`
	Path       string `json:"path"`
	Executable string `json:"executable"`
}

func main() {
	if err := launch(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		_ = os.WriteFile(errorLogPath(), []byte(err.Error()+"\r\n"), 0o644)
		os.Exit(1)
	}
}

func launch() error {
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve launcher path: %w", err)
	}
	root := filepath.Dir(self)
	raw, err := os.ReadFile(filepath.Join(root, "active.json"))
	if err != nil {
		return fmt.Errorf("read active.json: %w", err)
	}
	var pointer activePointer
	if err := json.Unmarshal(raw, &pointer); err != nil {
		return fmt.Errorf("parse active.json: %w", err)
	}
	if pointer.Code <= 0 || pointer.Version == "" || pointer.Executable == "" {
		return fmt.Errorf("active.json is incomplete")
	}
	target, err := confinedPath(root, pointer.Executable)
	if err != nil {
		return err
	}
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		return fmt.Errorf("active executable is unavailable: %s", target)
	}
	cmd := exec.Command(target, os.Args[1:]...)
	cmd.Dir = filepath.Dir(target)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start active version: %w", err)
	}
	return nil
}

func confinedPath(root, relative string) (string, error) {
	if filepath.IsAbs(relative) {
		return "", fmt.Errorf("active executable must be relative")
	}
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	target, err := filepath.Abs(filepath.Join(cleanRoot, filepath.FromSlash(relative)))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(cleanRoot, target)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("active executable escapes install root")
	}
	return target, nil
}

func errorLogPath() string {
	self, err := os.Executable()
	if err != nil {
		return "launcher-error.log"
	}
	return filepath.Join(filepath.Dir(self), "launcher-error.log")
}
