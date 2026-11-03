package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

// reward.ReleaseDue was written, tested and never called, so staging's pending
// points never unlocked. The service must start the loop that calls it.
func TestMainStartsTheHoldbackReleaser(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	started := false
	ast.Inspect(file, func(n ast.Node) bool {
		if g, ok := n.(*ast.GoStmt); ok {
			if id, ok := g.Call.Fun.(*ast.Ident); ok && id.Name == "runHoldbackReleaser" {
				started = true
			}
		}
		return true
	})
	if !started {
		t.Fatal("run() never starts runHoldbackReleaser: grants past their holdback would stay pending")
	}
}
